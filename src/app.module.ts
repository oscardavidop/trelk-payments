import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { PaypalModule } from './paypal/paypal.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { TelegramModule } from './telegram/telegram.module';
import { AppController } from './app.controller';
import { HealthController } from './common/health.controller';
import { PayPalIpMiddleware } from './common/middleware/paypal-ip.middleware';
import { RedisModule } from './redis/redis.module';
import * as dotenv from 'dotenv';

dotenv.config();

/** Parsea una Redis URL y devuelve las opciones de conexión para BullMQ */
function parseBullMQConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    db: parseInt(url.pathname.slice(1) || '0', 10) || 0,
    maxRetriesPerRequest: null, // Requerido por BullMQ para comandos bloqueantes
    retryStrategy: (times: number) => Math.min(times * 200, 3000),
  };
}

@Module({
  imports: [
    // ── Bases de datos ────────────────────────────────────────────────────
    MongooseModule.forRoot(
      process.env.MONGODB_URI_PAYMENTS!,
      {
        dbName: 'payments',
        connectionName: 'payments',
      },
    ),
    MongooseModule.forRoot(
      process.env.MONGODB_URI_MBOTS!,
      {
        dbName: 'mbot',
        connectionName: 'mbot',
      },
    ),

    // ── Redis global (@Global: disponible en todos los módulos) ───────────
    // Usado para: cache de token PayPal, idempotencia de webhooks pre-enqueue
    RedisModule,

    // ── BullMQ: conexión compartida para el producer de webhooks ──────────
    // El API solo produce jobs. Los processors están en el proceso Worker.
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: parseBullMQConnection(process.env.REDIS_URL!),
      }),
    }),

    // ── Rate limiting global ───────────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: 60_000,  // ventana de 60 segundos
        limit: 60,    // máximo 60 requests por IP en la ventana
      },
      {
        name: 'webhook',
        ttl: 60_000,
        limit: 200,   // PayPal puede enviar muchos webhooks en ráfaga
      },
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
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(PayPalIpMiddleware)
      .forRoutes({ path: 'paypal/events', method: RequestMethod.POST });
  }
}

