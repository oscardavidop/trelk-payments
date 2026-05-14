import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  PAYPAL_WEBHOOK_QUEUE,
  WebhookJobData,
  DlqJobData,
  WEBHOOK_DONE_PREFIX,
} from './paypal-webhook.types';
import { PaypalWebhookProducer } from './paypal-webhook.producer';
import { SubscriptionService } from '../subscription/subscription.service';
import { TelegramService } from '../telegram/telegram.service';
import { PayPalEvent } from '../database/schemas/paypal-event.schema';
import { RedisService } from '../redis/redis.service';

/**
 * PaypalWebhookProcessor
 *
 * Proceso WORKER-ONLY: consume jobs de la cola paypal:webhooks.
 * NUNCA corre en el proceso API.
 *
 * Garantías de este processor:
 * 1. Idempotencia doble capa: Redis prefix + MongoDB flag
 * 2. Exactamente-una-vez via atomic MongoDB update (features_applied flag)
 * 3. Retry automático con exponential backoff (5 intentos)
 * 4. DLQ tras agotar reintentos (cero pérdida de eventos)
 * 5. Correlation ID en todos los logs para trazabilidad completa
 *
 * concurrency: 5 — hasta 5 webhooks procesándose en paralelo
 * Los MongoDB upserts/findOneAndUpdate son seguros para concurrencia
 */
@Processor(PAYPAL_WEBHOOK_QUEUE, {
  concurrency: 5,
  // Rate limiter interno: máximo 200 jobs/segundo para proteger MongoDB
  limiter: {
    max: 200,
    duration: 1_000,
  },
})
export class PaypalWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(PaypalWebhookProcessor.name);
  private readonly MAX_ATTEMPTS = 5;

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly telegramService: TelegramService,
    private readonly producer: PaypalWebhookProducer,
    private readonly redisService: RedisService,
    @InjectModel(PayPalEvent.name, 'payments')
    private readonly paypalEventModel: Model<PayPalEvent>,
  ) {
    super();
  }

  /**
   * Punto de entrada principal para cada job.
   * BullMQ llama este método por cada webhook a procesar.
   */
  async process(job: Job<WebhookJobData>): Promise<void> {
    const { eventId, eventType, resource, correlationId, receivedAt } = job.data;

    this.logger.log(
      `[${correlationId}] Processing job [id=${job.id}, type=${eventType}, attempt=${job.attemptsMade + 1}/${this.MAX_ATTEMPTS}]`,
    );

    // ── 1. Idempotencia rápida: Redis (cross-instance) ────────────────────────
    // Esta clave fue seteada cuando el procesamiento fue exitoso
    const redisDone = await this.redisService.get(`${WEBHOOK_DONE_PREFIX}${eventId}`);
    if (redisDone) {
      this.logger.log(`[${correlationId}] Skipped — already processed (Redis cache)`);
      return;
    }

    // ── 2. Idempotencia autoritativa: MongoDB ─────────────────────────────────
    const existingEvent = await this.paypalEventModel
      .findOne({ event_id: eventId, processed: true })
      .lean();
    if (existingEvent) {
      this.logger.log(`[${correlationId}] Skipped — already processed (MongoDB)`);
      // Sincronizar Redis para futuros checks
      await this.redisService.set(`${WEBHOOK_DONE_PREFIX}${eventId}`, '1', 86_400);
      return;
    }

    // ── 3. Upsert del evento en MongoDB (idempotente) ─────────────────────────
    try {
      await this.paypalEventModel.findOneAndUpdate(
        { event_id: eventId },
        {
          $setOnInsert: {
            event_id: eventId,
            eventType,
            eventBody: resource,
            subscriptionId: resource?.id,
            processed: false,
            invalid_signature: false,
            retryCount: 0,
          },
        },
        { upsert: true, new: false },
      );
    } catch (err: any) {
      // Duplicate key = race condition entre workers → otro worker ganó, OK
      if (err?.code !== 11000) throw err;
    }

    // ── 4. Dispatch al handler de negocio ─────────────────────────────────────
    await this.dispatchEvent(eventType, resource, correlationId);

    // ── 5. Marcar como procesado (MongoDB + Redis) ────────────────────────────
    await this.paypalEventModel.updateOne(
      { event_id: eventId },
      {
        $set: {
          processed: true,
          processedAt: new Date(),
          processingError: null,
        },
      },
    );

    // TTL 24h en Redis — ventana de protección ante duplicate deliveries
    await this.redisService.set(`${WEBHOOK_DONE_PREFIX}${eventId}`, '1', 86_400);

    this.logger.log(`[${correlationId}] Job completed successfully [type=${eventType}]`);
  }

  // ── Handlers de eventos BullMQ ──────────────────────────────────────────────

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<WebhookJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) {
      this.logger.error(`Unknown job failed (data not parseable): ${error.message}`);
      return;
    }

    const { eventId, eventType, correlationId } = job.data;
    const attemptsUsed = job.attemptsMade;

    this.logger.error(
      `[${correlationId}] Job FAILED [id=${job.id}, type=${eventType}, attempt=${attemptsUsed}, error="${error.message}"]`,
    );

    // Actualizar contador de reintentos en MongoDB
    await this.paypalEventModel
      .updateOne(
        { event_id: eventId },
        {
          $set: {
            processingError: error.message,
            lastAttemptAt: new Date(),
          },
          $inc: { retryCount: 1 },
        },
      )
      .catch(() => null);

    // Si se agotaron TODOS los reintentos → DLQ
    if (attemptsUsed >= this.MAX_ATTEMPTS) {
      const dlqData: DlqJobData = {
        ...job.data,
        failureReason: error.message,
        failedAt: new Date().toISOString(),
        retryCount: attemptsUsed,
        originalJobId: job.id as string,
        stackTrace:
          process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      };

      await this.producer.moveToDlq(dlqData).catch((dlqErr) =>
        this.logger.error(
          `[${correlationId}] CRITICAL: Failed to move to DLQ: ${dlqErr.message}`,
        ),
      );
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.debug(`[Worker] Job completed [id=${job.id}]`);
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    // Un job stalled fue reclamado por otro worker (proceso murió a mitad)
    // BullMQ lo reintenta automáticamente
    this.logger.warn(`[Worker] Job stalled and re-queued [id=${jobId}]`);
  }

  // ── Dispatcher de eventos PayPal ────────────────────────────────────────────

  private async dispatchEvent(
    eventType: string,
    resource: any,
    correlationId: string,
  ): Promise<void> {
    switch (eventType) {
      // ── Suscripción creada (aún en aprobación) ──────────────────────────────
      case 'BILLING.SUBSCRIPTION.CREATED':
        this.logger.log(`[${correlationId}] Subscription CREATED: ${resource.id}`);
        await this.subscriptionService.updateFromWebhook(resource);
        break;

      // ── Suscripción activa (primer pago procesado) ──────────────────────────
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        this.logger.log(`[${correlationId}] Subscription ACTIVATED: ${resource.id}`);
        await this.subscriptionService.updateStatus(resource.id, 'ACTIVE', resource);
        await this.subscriptionService.tryActivateFeatures(resource.id);
        break;

      // ── Actualización: associate user via custom_id ─────────────────────────
      case 'BILLING.SUBSCRIPTION.UPDATED': {
        this.logger.log(`[${correlationId}] Subscription UPDATED: ${resource.id}`);
        const sub = await this.subscriptionService.getSubscriptionByPaypalId(resource.id);
        if (!sub) {
          this.logger.warn(`[${correlationId}] Subscription not found: ${resource.id}`);
          break;
        }
        const customId: string | undefined = resource.custom_id;
        if (customId && sub.status === 'PENDING_ASSOCIATION' && !sub.user_id) {
          await this.subscriptionService.updateSubscription(
            resource.id,
            { user_id: customId },
            { user_id: { $exists: false } },
          );
          this.logger.log(`[${correlationId}] User ${customId} attached to ${resource.id}`);
        }
        break;
      }

      // ── Cancelación ─────────────────────────────────────────────────────────
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        this.logger.log(`[${correlationId}] Subscription CANCELLED: ${resource.id}`);
        await this.subscriptionService.cancelSubscription(resource.id);
        break;

      // ── Suspensión ──────────────────────────────────────────────────────────
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        this.logger.log(`[${correlationId}] Subscription SUSPENDED: ${resource.id}`);
        await this.subscriptionService.suspendSubscription(resource.id);
        break;

      // ── Reactivación ────────────────────────────────────────────────────────
      case 'BILLING.SUBSCRIPTION.RE_ACTIVATED':
        this.logger.log(`[${correlationId}] Subscription RE_ACTIVATED: ${resource.id}`);
        await this.subscriptionService.resumeSubscription(resource.id);
        break;

      // ── Expiración ──────────────────────────────────────────────────────────
      case 'BILLING.SUBSCRIPTION.EXPIRED':
        this.logger.log(`[${correlationId}] Subscription EXPIRED: ${resource.id}`);
        await this.subscriptionService.updateStatus(resource.id, 'EXPIRED', resource);
        await this.subscriptionService.cancelSubscription(resource.id);
        break;

      // ── Fallo de pago ────────────────────────────────────────────────────────
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        this.logger.warn(`[${correlationId}] Payment FAILED: ${resource.id}`);
        const failedSub = await this.subscriptionService.getSubscriptionByPaypalId(resource.id);
        if (failedSub?.user_id) {
          await this.telegramService
            .notifyPaymentFailed(Number(failedSub.user_id))
            .catch((err) =>
              this.logger.error(`[${correlationId}] Telegram notify failed: ${err.message}`),
            );
        }
        break;
      }

      // ── Pago exitoso (renovación mensual) ────────────────────────────────────
      case 'PAYMENT.SALE.COMPLETED': {
        this.logger.log(`[${correlationId}] Payment COMPLETED: ${resource.id}`);
        const billingId = resource?.billing_agreement_id;
        if (billingId) {
          await this.subscriptionService.updateStatus(billingId, 'ACTIVE', {
            billing_info: {
              last_payment: {
                amount: {
                  value: resource?.amount?.total,
                  currency_code: resource?.amount?.currency,
                },
              },
            },
          });
        }
        break;
      }

      // ── Reembolso ────────────────────────────────────────────────────────────
      case 'PAYMENT.SALE.REFUNDED': {
        this.logger.warn(`[${correlationId}] Refund DETECTED: ${resource.id}`);
        const billingId = resource?.billing_agreement_id;
        if (billingId) {
          await this.subscriptionService.cancelSubscription(billingId);
          this.logger.warn(`[${correlationId}] Subscription cancelled due to refund: ${billingId}`);
        }
        break;
      }

      // ── Disputa / chargeback — ALERTA CRÍTICA ────────────────────────────────
      case 'CUSTOMER.DISPUTE.CREATED':
      case 'RISK.DISPUTE.CREATED': {
        // Log de MÁXIMA PRIORIDAD — requiere acción manual inmediata
        this.logger.error(
          `[${correlationId}] ⚠️  DISPUTE CREATED — ACCIÓN MANUAL REQUERIDA: ` +
            JSON.stringify({
              disputeId: resource?.dispute_id,
              reason: resource?.reason,
              amount: resource?.dispute_amount,
              status: resource?.status,
            }),
        );
        // TODO: enviar alerta a canal de Slack/PagerDuty/email del equipo de soporte
        break;
      }

      case 'CUSTOMER.DISPUTE.RESOLVED':
        this.logger.log(`[${correlationId}] Dispute RESOLVED: ${resource?.dispute_id}`);
        break;

      default:
        this.logger.log(`[${correlationId}] Unhandled event type: ${eventType}`);
    }
  }
}
