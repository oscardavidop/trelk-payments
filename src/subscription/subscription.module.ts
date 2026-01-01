import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionService } from './subscription.service';
import { User, UserSchema, Subscription, SubscriptionSchema } from '../database/schemas';
import { PaypalModule } from '../paypal/paypal.module';
import { TelegramModule } from '../telegram/telegram.module';
import { Plan, PlanSchema } from '../database/schemas/plan.schema';
import { LoggerService } from '../common/logger.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
    ], 'mbot'),
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Plan.name, schema: PlanSchema }
    ], 'payments'),
    TelegramModule,
    forwardRef(() => PaypalModule),
  ],
  providers: [SubscriptionService, LoggerService],
  exports: [SubscriptionService],
})
export class SubscriptionModule { }
