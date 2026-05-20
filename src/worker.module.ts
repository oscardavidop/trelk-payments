import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';

import { RedisModule } from './redis/redis.module';
import { WebhookProcessorModule } from './queues/webhook-processor.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';

/**
 * WorkerModule
 *
 * Módulo raíz del proceso Worker. Es completamente INDEPENDIENTE
 * del AppModule (API). Tiene sus propias conexiones a MongoDB y Redis.
 *
 * Responsabilidades:
 * - Consumir jobs de BullMQ (webhooks PayPal)
 * - Procesar la lógica de negocio de pagos
 * - Ejecutar cron jobs de reconciliación financiera
 * - NO expone ningún endpoint HTTP
 *
 * Por qué proceso separado:
 * - El Worker puede escalar horizontalmente independiente del API
 * - Si el Worker falla/reinicia, el API sigue recibiendo webhooks
 * - Si el API tiene un pico, no afecta el procesamiento del Worker
 * - CPU-intensive work (Mongoose, PayPal API calls) no bloquea el event loop del API
 */
@Module({
  imports: [
    // ── Bases de datos (conexiones independientes del API) ──────────────────
    MongooseModule.forRootAsync({
      connectionName: 'payments',
      useFactory: () => ({
        uri: process.env.MONGODB_URI_PAYMENTS,
        dbName: 'payments',
      }),
    }),
    MongooseModule.forRootAsync({
      connectionName: 'mbot',
      useFactory: () => ({
        uri: process.env.MONGODB_URI_MBOTS,
        dbName: 'mbot',
      }),
    }),

    // ── Redis global (token cache + locks distribuidos) ────────────────────
    RedisModule,

    // ── BullMQ: conexión al mismo broker de colas que el API ───────────────
    BullModule.forRootAsync({
      useFactory: () => {
        const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
        return {
          connection: {
            host: redisUrl.hostname,
            port: parseInt(redisUrl.port || '6379', 10),
            password: redisUrl.password || undefined,
            db: parseInt(redisUrl.pathname.replace('/', '') || '0', 10),
            maxRetriesPerRequest: null, // requerido por BullMQ
            enableReadyCheck: false,
            retryStrategy: (times: number) => Math.min(times * 200, 5_000),
          },
        };
      },
    }),

    // ── Scheduler para cron jobs de reconciliación ─────────────────────────
    ScheduleModule.forRoot(),

    // ── Processors (BullMQ consumers) ──────────────────────────────────────
    WebhookProcessorModule,

    // ── Reconciliación automática ──────────────────────────────────────────
    ReconciliationModule,
  ],
})
export class WorkerModule {}
