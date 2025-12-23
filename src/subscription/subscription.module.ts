import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubscriptionService } from './subscription.service';
import { User, UserSchema, Subscription, SubscriptionSchema } from '../database/schemas';
import { PaypalModule } from '../paypal/paypal.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
    ], 'mbot'),
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
    ], 'payments'),
    TelegramModule,
    forwardRef(() => PaypalModule),
  ],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
