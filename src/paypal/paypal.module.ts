import { Module, forwardRef } from '@nestjs/common';
import { PaypalService } from './paypal.service';
import { PaypalController } from './paypal.controller';
import { TelegramModule } from '../telegram/telegram.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Subscription, SubscriptionSchema, User, UserSchema } from '../database/schemas';
import { PayPalEvent, PayPalEventSchema } from '../database/schemas/paypal-event.schema';
import { LoggerService } from '../common/logger.service';

@Module({
  imports: [
    forwardRef(() => SubscriptionModule),
    TelegramModule,
    MongooseModule.forFeature(
      [{ name: Subscription.name, schema: SubscriptionSchema },
      { name: PayPalEvent.name, schema: PayPalEventSchema }],
      'payments',
    ),
    MongooseModule.forFeature(
      [{ name: User.name, schema: UserSchema }],
      'mbot',
    ),
  ],
  controllers: [PaypalController],
  providers: [PaypalService, LoggerService],
  exports: [PaypalService],
})
export class PaypalModule { }
