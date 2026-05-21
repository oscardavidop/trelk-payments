import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TelegramPaymentController } from './telegram-payment.controller';
import { TelegramPaymentService } from './telegram-payment.service';
import { TelegramModule } from '../telegram/telegram.module';
import { LoggerService } from '../common/logger.service';
import {
  Subscription,
  SubscriptionSchema,
} from '../database/schemas/subscription.schema';
import { Plan, PlanSchema } from '../database/schemas/plan.schema';
import { User, UserSchema } from '../database/schemas/user.schema';

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
    TelegramModule,
  ],
  controllers: [TelegramPaymentController],
  providers: [TelegramPaymentService, LoggerService],
  exports: [TelegramPaymentService],
})
export class TelegramPaymentModule {}
