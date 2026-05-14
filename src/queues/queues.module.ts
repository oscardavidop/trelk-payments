import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PAYPAL_WEBHOOK_QUEUE, PAYPAL_WEBHOOK_DLQ } from './paypal-webhook.types';
import { PaypalWebhookProducer } from './paypal-webhook.producer';

/**
 * QueuesModule (API-side)
 *
 * Solo registra colas y exporta el Producer.
 * NO registra Processors — eso es exclusivo del worker.
 *
 * Importado por: AppModule (via PaypalModule)
 * NO importado por: WorkerModule directamente
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: PAYPAL_WEBHOOK_QUEUE },
      { name: PAYPAL_WEBHOOK_DLQ },
    ),
  ],
  providers: [PaypalWebhookProducer],
  exports: [PaypalWebhookProducer],
})
export class QueuesModule {}
