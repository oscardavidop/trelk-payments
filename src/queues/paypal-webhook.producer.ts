import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  PAYPAL_WEBHOOK_QUEUE,
  PAYPAL_WEBHOOK_DLQ,
  WebhookJobData,
  DlqJobData,
  getEventPriority,
} from './paypal-webhook.types';

/**
 * PaypalWebhookProducer
 *
 * Responsabilidad única: enqueue de webhooks PayPal a BullMQ.
 * Usado exclusivamente por el proceso API (HTTP layer).
 *
 * Riesgo actual sin queues:
 * - Si el procesamiento es lento (PayPal espera max 5s), se produce timeout
 * - PayPal reintenta el webhook → posibles duplicados y race conditions
 * - Un pico de 500 webhooks/min bloquea el event loop del API
 *
 * Con BullMQ:
 * - La API responde en <50ms (solo valida firma y encola)
 * - El Worker procesa de forma controlada con concurrency y rate limiting
 * - Si el Worker falla, BullMQ reintenta con exponential backoff
 * - Los jobs persisten en Redis → no se pierden si el proceso muere
 */
@Injectable()
export class PaypalWebhookProducer {
  private readonly logger = new Logger(PaypalWebhookProducer.name);

  constructor(
    @InjectQueue(PAYPAL_WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
    @InjectQueue(PAYPAL_WEBHOOK_DLQ) private readonly dlqQueue: Queue,
  ) {}

  /**
   * Encola un webhook verificado para procesamiento asíncrono.
   *
   * Idempotencia BullMQ: si ya existe un job con el mismo jobId
   * (durante el período de retención), BullMQ lo rechaza silenciosamente.
   * Esto complementa la idempotencia Redis del controller.
   *
   * @returns jobId asignado
   */
  async enqueueWebhook(data: WebhookJobData): Promise<string> {
    const job = await this.webhookQueue.add('process-webhook', data, {
      // Clave de deduplicación: BullMQ rechaza jobs con mismo jobId
      // hasta que el job sea limpiado (removeOnComplete.age)
      jobId: data.eventId,

      // Reintentos con exponential backoff (2s → 4s → 8s → 16s → 32s)
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 2_000,
      },

      // Retención: mantener jobs completados 24h, máximo 10k
      // Mantener jobs fallidos indefinidamente (van a DLQ en onFailed)
      removeOnComplete: { age: 86_400, count: 10_000 },
      removeOnFail: false,

      // Prioridad: eventos críticos (disputa, chargeback) se procesan primero
      priority: getEventPriority(data.eventType),
    });

    this.logger.log(
      `Webhook enqueued [jobId=${job.id}, type=${data.eventType}, correlationId=${data.correlationId}]`,
    );
    return job.id as string;
  }

  /**
   * Mueve un webhook fallido al Dead Letter Queue.
   * Llamado desde el processor cuando se agotan todos los reintentos.
   *
   * El DLQ es la red de seguridad financiera:
   * - Un webhook en DLQ = dinero potencialmente en riesgo
   * - Requiere revisión manual o replay
   */
  async moveToDlq(data: DlqJobData): Promise<void> {
    await this.dlqQueue.add('dlq-webhook', data, {
      jobId: `dlq:${data.eventId}`,
      // DLQ no hace retry automático — revisión manual requerida
      attempts: 1,
      removeOnFail: false,
      removeOnComplete: false,
    });

    this.logger.error(
      `[DLQ] Webhook moved to Dead Letter Queue — MANUAL REVIEW REQUIRED | ` +
        `eventId=${data.eventId}, type=${data.eventType}, ` +
        `correlationId=${data.correlationId}, retries=${data.retryCount}, ` +
        `reason="${data.failureReason}"`,
    );
  }

  /**
   * Obtiene métricas de la cola principal para monitoring.
   * Útil para exponer en /metrics o health endpoints.
   */
  async getQueueMetrics(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    dlqSize: number;
  }> {
    const [waiting, active, completed, failed, delayed, dlqWaiting] = await Promise.all([
      this.webhookQueue.getWaitingCount(),
      this.webhookQueue.getActiveCount(),
      this.webhookQueue.getCompletedCount(),
      this.webhookQueue.getFailedCount(),
      this.webhookQueue.getDelayedCount(),
      this.dlqQueue.getWaitingCount(),
    ]);

    return { waiting, active, completed, failed, delayed, dlqSize: dlqWaiting };
  }
}
