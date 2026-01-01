import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaypalModule } from './paypal/paypal.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { TelegramModule } from './telegram/telegram.module';
import { AppController } from './app.controller';
import * as dotenv from 'dotenv';

dotenv.config();

@Module({
  imports: [
    // DB payments: subscriptions, paypal events
    MongooseModule.forRoot(
      process.env.MONGODB_URI_PAYMENTS!,
      {
        dbName: 'payments',
        connectionName: 'payments',
      }
    ),
    // DB mbot: users
    MongooseModule.forRoot(
      process.env.MONGODB_URI_MBOTS!,
      {
        dbName: 'mbot',
        connectionName: 'mbot',
      }
    ),
    TelegramModule,
    PaypalModule,
    SubscriptionModule,
  ],
  controllers: [AppController],
})
export class AppModule { }
