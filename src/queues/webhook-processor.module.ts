import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';

import { PAYPAL_WEBHOOK_QUEUE, PAYPAL_WEBHOOK_DLQ } from './paypal-webhook.types';
import { PaypalWebhookProducer } from './paypal-webhook.producer';
import { PaypalWebhookProcessor } from './paypal-webhook.processor';
import { DlqProcessor } from './dlq.processor';

import { SubscriptionModule } from '../subscription/subscription.module';
import { TelegramModule } from '../telegram/telegram.module';
import { PaypalModule } from '../paypal/paypal.module';
import { PayPalEvent, PayPalEventSchema } from '../database/schemas/paypal-event.schema';

/**
 * WebhookProcessorModule — WORKER-ONLY
 *
 * Registra los processors de BullMQ junto con todos los servicios
 * de dominio que necesitan para procesar webhooks PayPal.
 *
 * Solo debe ser importado por WorkerModule.
 * Si se importa en AppModule, el proceso API comenzará a consumir jobs
 * de la cola (comportamiento NO deseado).
 */
@Module({
  imports: [
    // Registrar las mismas colas que el producer (misma conexión Redis)
    BullModule.registerQueue(
      { name: PAYPAL_WEBHOOK_QUEUE },
      { name: PAYPAL_WEBHOOK_DLQ },
    ),

    // Modelo PayPalEvent para persistencia de eventos
    MongooseModule.forFeature(
      [{ name: PayPalEvent.name, schema: PayPalEventSchema }],
      'payments',
    ),

    // Módulos de dominio necesarios para la lógica de negocio
    SubscriptionModule,
    TelegramModule,
    PaypalModule,
  ],
  providers: [
    PaypalWebhookProducer, // El processor usa el producer para mover a DLQ
    PaypalWebhookProcessor,
    DlqProcessor,
  ],
})
export class WebhookProcessorModule {}
