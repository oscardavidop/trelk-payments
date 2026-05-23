import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReconciliationService } from './reconciliation.service';
import { Subscription, SubscriptionSchema } from '../database/schemas/subscription.schema';
import { User, UserSchema } from '../database/schemas/user.schema';
import { Plan, PlanSchema } from '../database/schemas/plan.schema';
import { PaypalModule } from '../paypal/paypal.module';
import { TelegramModule } from '../telegram/telegram.module';
import { TelegramPaymentModule } from '../telegram-payment/telegram-payment.module';

/**
 * ReconciliationModule — WORKER-ONLY
 *
 * Contiene los cron jobs de reconciliación financiera.
 * Solo debe importarse en WorkerModule, no en AppModule.
 */
@Module({
  imports: [
    MongooseModule.forFeature(
      [
        { name: Subscription.name, schema: SubscriptionSchema },
        { name: Plan.name, schema: PlanSchema },
      ],
      'payments',
    ),
    MongooseModule.forFeature(
      [{ name: User.name, schema: UserSchema }],
      'mbot',
    ),
    PaypalModule,
    TelegramModule,
    TelegramPaymentModule,
  ],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
