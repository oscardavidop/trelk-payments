import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReconciliationService } from './reconciliation.service';
import { Subscription, SubscriptionSchema } from '../database/schemas/subscription.schema';
import { User, UserSchema } from '../database/schemas/user.schema';
import { PaypalModule } from '../paypal/paypal.module';

/**
 * ReconciliationModule — WORKER-ONLY
 *
 * Contiene los cron jobs de reconciliación financiera.
 * Solo debe importarse en WorkerModule, no en AppModule.
 */
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: Subscription.name, schema: SubscriptionSchema }],
      'payments',
    ),
    MongooseModule.forFeature(
      [{ name: User.name, schema: UserSchema }],
      'mbot',
    ),
    PaypalModule,
  ],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
