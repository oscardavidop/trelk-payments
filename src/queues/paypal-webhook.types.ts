/**
 * paypal-webhook.types.ts
 *
 * Tipos compartidos entre el producer (API) y el processor (Worker).
 * Mantener en un solo lugar para evitar inconsistencias de schema entre procesos.
 */

/** Nombre de la cola principal de webhooks PayPal */
export const PAYPAL_WEBHOOK_QUEUE = 'payments_paypal_webhooks' as const;

/** Nombre de la Dead Letter Queue */
export const PAYPAL_WEBHOOK_DLQ = 'payments_paypal_webhooks_dlq' as const;

/** Prefijo Redis para idempotencia a nivel de API (check rápido pre-enqueue) */
export const WEBHOOK_DONE_PREFIX = 'payments_webhook_done:' as const;

/**
 * Payload de un job de webhook en la queue principal.
 * Solo se almacena lo necesario para el procesamiento.
 * El rawBody NO se guarda (ya se validó la firma en la API).
 */
export interface WebhookJobData {
  /** PayPal event ID (PAYPAL-TRANSMISSION-ID) — usado como jobId para deduplicación */
  eventId: string;
  /** Tipo de evento PayPal (ej: BILLING.SUBSCRIPTION.ACTIVATED) */
  eventType: string;
  /** Objeto resource del webhook */
  resource: Record<string, any>;
  /** ID de correlación para trazabilidad (= PAYPAL-TRANSMISSION-ID) */
  correlationId: string;
  /** ISO timestamp de cuando el webhook llegó a la API */
  receivedAt: string;
}

/**
 * Payload de un job en la Dead Letter Queue.
 * Extiende WebhookJobData con metadatos de fallo.
 */
export interface DlqJobData extends WebhookJobData {
  /** Razón del fallo (mensaje de error de la última excepción) */
  failureReason: string;
  /** ISO timestamp del fallo definitivo */
  failedAt: string;
  /** Número de reintentos realizados antes de pasar al DLQ */
  retryCount: number;
  /** ID del job original en la cola principal */
  originalJobId: string;
  /** Stack trace de la excepción (solo en non-prod o nivel DEBUG) */
  stackTrace?: string;
}

/** Eventos financieros de alta prioridad que deben procesarse primero */
export const HIGH_PRIORITY_EVENTS = new Set([
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'CUSTOMER.DISPUTE.CREATED',
  'RISK.DISPUTE.CREATED',
  'PAYMENT.SALE.REFUNDED',
]);

/** Mapeo evento → prioridad BullMQ (menor número = más urgente) */
export function getEventPriority(eventType: string): number {
  const priorities: Record<string, number> = {
    'CUSTOMER.DISPUTE.CREATED':               1,
    'RISK.DISPUTE.CREATED':                   1,
    'BILLING.SUBSCRIPTION.PAYMENT.FAILED':    2,
    'PAYMENT.SALE.REFUNDED':                  3,
    'BILLING.SUBSCRIPTION.CANCELLED':         4,
    'BILLING.SUBSCRIPTION.ACTIVATED':         5,
    'BILLING.SUBSCRIPTION.SUSPENDED':         6,
    'BILLING.SUBSCRIPTION.RE_ACTIVATED':      7,
    'BILLING.SUBSCRIPTION.EXPIRED':           8,
    'PAYMENT.SALE.COMPLETED':                 9,
    'BILLING.SUBSCRIPTION.CREATED':           10,
    'BILLING.SUBSCRIPTION.UPDATED':           11,
  };
  return priorities[eventType] ?? 20;
}
