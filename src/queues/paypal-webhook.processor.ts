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
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        this.logger.log(`[${correlationId}] Subscription ACTIVATED: ${resource.id}`);
        await this.subscriptionService.updateStatus(resource.id, 'ACTIVE', resource);
        await this.subscriptionService.tryActivateFeatures(resource.id);
        // Sync billing data from activation resource if present (PayPal may include it)
        const activatedNextBillingTime = resource.billing_info?.next_billing_time as string | undefined;
        const activatedLastPaymentAmount = parseFloat(
          resource.billing_info?.last_payment?.amount?.value ?? '0',
        );
        const activatedLastPaymentCurrency = resource.billing_info?.last_payment?.amount?.currency_code as string | undefined;
        if (activatedNextBillingTime || activatedLastPaymentAmount > 0) {
          await this.subscriptionService.syncBillingData(
            resource.id,
            activatedLastPaymentAmount > 0 ? activatedLastPaymentAmount : undefined,
            activatedLastPaymentCurrency,
            activatedNextBillingTime,
          );
        }
        break;
      }

      // ── Actualización: associate user via custom_id + sincronizar plan ────────
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
        // Sincronizar plan_id si cambió (resultado de una revisión upgrade/downgrade)
        if (resource.plan_id && resource.plan_id !== sub.plan_id) {
          this.logger.log(
            `[${correlationId}] Plan changed on ${resource.id}: ${sub.plan_id} → ${resource.plan_id}`,
          );

          const oldPlan = await this.subscriptionService.getPlanByPlanId(sub.plan_id);
          const newPlan = await this.subscriptionService.getPlanByPlanId(resource.plan_id);
          const TIERS: Record<string, number> = { free: 0, pro: 1, ultra: 2 };
          const oldRank = TIERS[oldPlan?.name?.toLowerCase() ?? ''] ?? 0;
          const newRank = TIERS[newPlan?.name?.toLowerCase() ?? ''] ?? 0;

          if (newRank >= oldRank) {
            // ── UPGRADE: apply immediately
            await this.subscriptionService.updateSubscription(
              resource.id,
              { plan_id: resource.plan_id, features_applied: false },
            );
            // Clear any pending downgrade — this upgrade supersedes it
            if ((sub as any).scheduled_plan_id) {
              await this.subscriptionService.clearScheduledDowngrade(resource.id);
            }
            if (sub.status === 'ACTIVE') {
              await this.subscriptionService.tryActivateFeatures(resource.id);
            }
            if (sub.user_id) {
              await this.telegramService
                .notifyPlanUpgraded(Number(sub.user_id), {
                  fromPlan: oldPlan?.name ?? 'free',
                  toPlan: newPlan?.name ?? 'premium',
                  amount: newPlan?.price ?? null,
                  currency: 'USD',
                })
                .catch((err) =>
                  this.logger.error(`[${correlationId}] Upgrade notify failed: ${err.message}`),
                );
            }
          } else {
            // ── DOWNGRADE: schedule for end of current billing period
            // Keep current plan features active until next_billing_date.
            // ReconciliationService cron will apply the change when the period ends.
            await this.subscriptionService.updateSubscription(
              resource.id,
              { scheduled_plan_id: resource.plan_id },
              // IMPORTANT: do NOT change plan_id or reset features_applied here
            );
            if (sub.user_id) {
              await this.telegramService
                .notifyDowngradeScheduled(Number(sub.user_id), {
                  fromPlan: oldPlan?.name ?? 'premium',
                  toPlan: newPlan?.name ?? 'free',
                  effectiveDate: (sub as any).next_billing_date ?? null,
                })
                .catch((err) =>
                  this.logger.error(`[${correlationId}] Downgrade-scheduled notify failed: ${err.message}`),
                );
            }
            this.logger.log(
              `[${correlationId}] Downgrade scheduled on ${resource.id}: ${sub.plan_id} → ${resource.plan_id} (effective at period end)`,
            );
          }
        } else if (
          resource.plan_id &&
          resource.plan_id === sub.plan_id &&
          (sub as any).scheduled_plan_id
        ) {
          // ── UNDO DOWNGRADE confirmed by PayPal: plan stayed the same but pending
          // downgrade was cancelled. Clear scheduled_plan_id from DB.
          this.logger.log(
            `[${correlationId}] Downgrade revert confirmed on ${resource.id}: stays on ${sub.plan_id}`,
          );
          await this.subscriptionService.clearScheduledDowngrade(resource.id);
        }

        // ── Always sync fresh billing data from PayPal resource ─────────────────
        // next_billing_date and amount may have changed after any revision or renewal.
        // Without this, the displayed next billing date goes stale after the first renewal.
        const nextBillingTime = resource.billing_info?.next_billing_time as string | undefined;
        const lastPaymentAmount = parseFloat(
          resource.billing_info?.last_payment?.amount?.value ?? '0',
        );
        const lastPaymentCurrency = resource.billing_info?.last_payment?.amount?.currency_code as string | undefined;
        await this.subscriptionService.syncBillingData(
          resource.id,
          lastPaymentAmount > 0 ? lastPaymentAmount : undefined,
          lastPaymentCurrency,
          nextBillingTime,
        );
        break;
      }

      // ── Cancelación ─────────────────────────────────────────────────────────
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        this.logger.log(`[${correlationId}] Subscription CANCELLED: ${resource.id}`);
        // cancelSubscription sends the notification with full context internally
        await this.subscriptionService.cancelSubscription(resource.id);
        break;

      // ── Suspensión ──────────────────────────────────────────────────────────────────
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        this.logger.log(`[${correlationId}] Subscription SUSPENDED: ${resource.id}`);
        // suspendSubscription sends the notification internally
        await this.subscriptionService.suspendSubscription(resource.id);
        break;

      // ── Reactivación ────────────────────────────────────────────────────────
      case 'BILLING.SUBSCRIPTION.RE_ACTIVATED':
        this.logger.log(`[${correlationId}] Subscription RE_ACTIVATED: ${resource.id}`);
        // resumeSubscription sends the notification internally
        await this.subscriptionService.resumeSubscription(resource.id);
        break;

      // ── Expiración ──────────────────────────────────────────────────────────
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        this.logger.log(`[${correlationId}] Subscription EXPIRED: ${resource.id}`);
        // Fetch before status update so we have plan + user info for notification
        const expiredSub = await this.subscriptionService.getSubscriptionByPaypalId(resource.id);
        await this.subscriptionService.updateStatus(resource.id, 'EXPIRED', resource);
        if (expiredSub?.user_id) {
          const expiredPlan = await this.subscriptionService.getPlanByPlanId(expiredSub.plan_id);
          await this.telegramService
            .notifySubscriptionExpired(Number(expiredSub.user_id), {
              planName: expiredPlan?.name ?? 'premium',
            })
            .catch((err) =>
              this.logger.error(`[${correlationId}] Expired notify failed: ${err.message}`),
            );
        }
        // Immediate downgrade (natural expiry, not deferred cancel)
        await this.subscriptionService.expireSubscriptionAccess(resource.id);
        break;
      }

      // ── Fallo de pago ────────────────────────────────────────────────────────
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        this.logger.warn(`[${correlationId}] Payment FAILED: ${resource.id}`);
        const failedSub = await this.subscriptionService.getSubscriptionByPaypalId(resource.id);
        if (failedSub?.user_id) {
          const failedPlan = await this.subscriptionService.getPlanByPlanId(failedSub.plan_id);
          await this.telegramService
            .notifyPaymentFailed(Number(failedSub.user_id), {
              planName: failedPlan?.name ?? 'premium',
              amount: failedSub.amount ?? null,
              currency: failedSub.currency ?? 'USD',
            })
            .catch((err) =>
              this.logger.error(`[${correlationId}] Payment-failed notify failed: ${err.message}`),
            );
        }
        break;
      }

      // ── Pago exitoso (renovación mensual) ────────────────────────────────────
      case 'PAYMENT.SALE.COMPLETED': {
        this.logger.log(`[${correlationId}] Payment COMPLETED: ${resource.id}`);
        const billingId = resource?.billing_agreement_id;
        if (billingId) {
          const updatedSub = await this.subscriptionService.updateStatus(billingId, 'ACTIVE', {
            billing_info: {
              last_payment: {
                amount: {
                  value: resource?.amount?.total,
                  currency_code: resource?.amount?.currency,
                },
              },
            },
          });

          // ── NEW: Apply scheduled downgrade if one is pending ───────────────────
          // The new billing cycle just started — this is the correct moment to
          // apply the downgrade the user requested (webhook-driven, deterministic).
          // The reconciliation cron is a fallback safety net only.
          const downgradeApplied = await this.subscriptionService.applyScheduledDowngradeOnRenewal(billingId);

          // Notify renewal — skip if downgrade was applied (that notification is already sent)
          if (!downgradeApplied && updatedSub?.user_id) {
            const renewPlan = await this.subscriptionService.getPlanByPlanId(updatedSub.plan_id);
            const paidAmount = parseFloat(resource?.amount?.total ?? '0');

            await this.telegramService
              .notifyPaymentRenewal(Number(updatedSub.user_id), {
                planName: renewPlan?.name ?? 'premium',
                amount: paidAmount || updatedSub.amount || 0,
                currency: resource?.amount?.currency ?? updatedSub.currency ?? 'USD',
                nextBillingDate: updatedSub.next_billing_date ?? null,
              })
              .catch((err) =>
                this.logger.error(`[${correlationId}] Renewal notify failed: ${err.message}`),
              );
          }
        }
        break;
      }

      // ── Renovación automática (equivalente a PAYMENT.SALE.COMPLETED para subs) ───
      case 'BILLING.SUBSCRIPTION.RENEWED': {
        this.logger.log(`[${correlationId}] Subscription RENEWED: ${resource.id}`);
        // Same logic as PAYMENT.SALE.COMPLETED: apply scheduled downgrade if pending
        const renewedDowngrade = await this.subscriptionService.applyScheduledDowngradeOnRenewal(resource.id);
        if (!renewedDowngrade) {
          // Standard renewal — update status and notify
          const renewedSub = await this.subscriptionService.updateStatus(resource.id, 'ACTIVE', resource);
          if (renewedSub?.user_id) {
            const renewedPlan = await this.subscriptionService.getPlanByPlanId(renewedSub.plan_id);
            await this.telegramService
              .notifyPaymentRenewal(Number(renewedSub.user_id), {
                planName: renewedPlan?.name ?? 'premium',
                amount: renewedSub.amount ?? 0,
                currency: renewedSub.currency ?? 'USD',
                nextBillingDate: renewedSub.next_billing_date ?? null,
              })
              .catch((err) =>
                this.logger.error(`[${correlationId}] RENEWED notify failed: ${err.message}`),
              );
          }
        }
        break;
      }

      // ── Reembolso ────────────────────────────────────────────────────────────
      case 'PAYMENT.SALE.REFUNDED': {
        this.logger.warn(`[${correlationId}] Refund DETECTED: ${resource.id}`);
        const billingId = resource?.billing_agreement_id;
        if (billingId) {
          // Immediate revocation for refunds — user should not keep access
          await this.subscriptionService.cancelSubscription(billingId, { immediate: true });
          this.logger.warn(`[${correlationId}] Subscription immediately cancelled due to refund: ${billingId}`);
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
