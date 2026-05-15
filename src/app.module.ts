import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { PaypalModule } from './paypal/paypal.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { TelegramModule } from './telegram/telegram.module';
import { AppController } from './app.controller';
import { HealthController } from './common/health.controller';
import { PayPalIpMiddleware } from './common/middleware/paypal-ip.middleware';
import { BullBoardMiddleware } from './common/bull-board.middleware';
import { RedisModule } from './redis/redis.module';
import { PAYPAL_WEBHOOK_QUEUE, PAYPAL_WEBHOOK_DLQ } from './queues/paypal-webhook.types';
import { Queue } from 'bullmq';
import * as dotenv from 'dotenv';

dotenv.config();

function parseBullMQConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    db: parseInt(url.pathname.slice(1) || '0', 10) || 0,
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(times * 200, 3000),
  };
}

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI_PAYMENTS!, {
      dbName: 'payments',
      connectionName: 'payments',
    }),
    MongooseModule.forRoot(process.env.MONGODB_URI_MBOTS!, {
      dbName: 'mbot',
      connectionName: 'mbot',
    }),

    RedisModule,

    BullModule.forRootAsync({
      useFactory: () => ({
        connection: parseBullMQConnection(process.env.REDIS_URL!),
      }),
    }),
    BullModule.registerQueue(
      { name: PAYPAL_WEBHOOK_QUEUE },
      { name: PAYPAL_WEBHOOK_DLQ },
    ),

    ThrottlerModule.forRoot([
      { name: 'global',   ttl: 60_000, limit: 60 },
      { name: 'webhook',  ttl: 60_000, limit: 200 },
    ]),

    TelegramModule,
    PaypalModule,
    SubscriptionModule,
  ],
  controllers: [
    AppController,
    HealthController,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      // Factory para BullBoardMiddleware (necesita las Queue injected)
      provide: BullBoardMiddleware,
      useFactory: (
        webhookQueue: Queue,
        dlqQueue: Queue,
      ) => new BullBoardMiddleware([webhookQueue, dlqQueue]),
      inject: [
        `BullQueue_${PAYPAL_WEBHOOK_QUEUE}`,
        `BullQueue_${PAYPAL_WEBHOOK_DLQ}`,
      ],
    },
  ],
})
export class AppModule implements NestModule {
  constructor(private readonly bullBoardMiddleware: BullBoardMiddleware) {}

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(PayPalIpMiddleware)
      .forRoutes({ path: 'paypal/events', method: RequestMethod.POST });

    // Dashboard de colas — solo si habilitado explícitamente
    if (process.env.BULL_BOARD_ENABLED === 'true') {
      consumer
        .apply(this.bullBoardMiddleware.use.bind(this.bullBoardMiddleware))
        .forRoutes({ path: 'queues*', method: RequestMethod.ALL });
    }
  }
}

