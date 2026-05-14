import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PAYPAL_WEBHOOK_DLQ, DlqJobData } from './paypal-webhook.types';

/**
 * DlqProcessor
 *
 * Consume jobs del Dead Letter Queue (paypal:webhooks:dlq).
 * Un job en el DLQ = webhook que falló después de 5 reintentos.
 *
 * Este processor NO reintenta la lógica de negocio automáticamente.
 * Su responsabilidad es:
 * 1. Registrar el evento como un incidente crítico
 * 2. Emitir alertas al equipo de operaciones
 * 3. Proveer metadata para replay manual
 *
 * Para hacer replay manual de un job del DLQ:
 *   1. Consultar la colección 'events' en MongoDB donde processed=false y retryCount>=5
 *   2. O usar Bull Board / BullMQ admin UI para reencolar
 *   3. O usar el endpoint interno /admin/dlq/replay/:jobId (a implementar si se necesita)
 *
 * concurrency: 1 — el DLQ procesa de a uno para análisis seguro y sin sobrecarga
 */
@Processor(PAYPAL_WEBHOOK_DLQ, { concurrency: 1 })
export class DlqProcessor extends WorkerHost {
  private readonly logger = new Logger(DlqProcessor.name);

  async process(job: Job<DlqJobData>): Promise<void> {
    const {
      eventId,
      eventType,
      correlationId,
      failureReason,
      retryCount,
      failedAt,
      originalJobId,
      resource,
    } = job.data;

    // ── Log CRÍTICO ─────────────────────────────────────────────────────────
    // Todo lo que llega al DLQ representa un webhook financiero no procesado.
    // Cada línea aquí = potencialmente dinero en riesgo.
    this.logger.error(
      `[DLQ] ⛔ WEBHOOK FALLIDO PERMANENTE — REVISIÓN MANUAL URGENTE:\n` +
        JSON.stringify(
          {
            eventId,
            eventType,
            correlationId,
            originalJobId,
            retryCount,
            failedAt,
            failureReason,
            subscriptionId: resource?.id,
            dlqJobId: job.id,
          },
          null,
          2,
        ),
    );

    // ── Alertas externas (TODO: integrar con sistema de alertas) ────────────
    // await this.alertService.sendCriticalAlert({
    //   title: `⛔ Webhook DLQ: ${eventType}`,
    //   body: `eventId=${eventId}, reason=${failureReason}`,
    //   channel: 'payments-critical',
    //   severity: 'critical',
    // });

    // El job se completa sin reintentar lógica financiera.
    // El status 'completed' en DLQ significa "registrado como incidente".
    // Para replay: reencolar manualmente a la cola principal si se corrige el error.
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<DlqJobData> | undefined, error: Error): void {
    // Si el DLQ processor mismo falla (ej: DB down para auditoría)
    this.logger.error(
      `[DLQ] DLQ processor itself failed for job ${job?.id}: ${error.message}`,
    );
  }
}
