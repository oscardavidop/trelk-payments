import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaypalController } from './paypal.controller';
import { PaypalModule } from './paypal/paypal.module';
import { TelegramModule } from './telegram/telegram.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { User, Subscription } from './database/entities';
import { AppController } from './app.controller';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.DATABASE_URL || 'data/app.db',
      entities: [User, Subscription],
      synchronize: true,
      logging: process.env.NODE_ENV === 'development',
    }),
    TypeOrmModule.forFeature([User, Subscription]),
    PaypalModule,
    TelegramModule,
    SubscriptionModule,
  ],
  controllers: [PaypalController, AppController],
})
export class AppModule {}
