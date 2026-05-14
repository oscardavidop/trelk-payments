import { Module, forwardRef } from '@nestjs/common';
import { PaypalService } from './paypal.service';
import { PaypalController } from './paypal.controller';
import { SubscriptionModule } from '../subscription/subscription.module';
import { LoggerService } from '../common/logger.service';
import { QueuesModule } from '../queues/queues.module';

/**
 * PaypalModule — proceso API solamente.
 *
 * El controller ahora es delgado: verifica firma y encola en BullMQ.
 * Todo el procesamiento de eventos ocurre en el Worker (WebhookProcessorModule).
 *
 * Dependencias eliminadas vs versión anterior:
 * - MongooseModule (controller ya no hace operaciones DB directas)
 * - TelegramModule (solo necesario en el processor del Worker)
 * - Schemas de User y PayPalEvent (idem)
 */
@Module({
  imports: [
    forwardRef(() => SubscriptionModule),
    QueuesModule,
  ],
  controllers: [PaypalController],
  providers: [PaypalService, LoggerService],
  exports: [PaypalService],
})
export class PaypalModule {}
