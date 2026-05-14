/**
 * worker.ts — Entrypoint del proceso Worker
 *
 * Proceso completamente separado del API HTTP.
 * Se ejecuta con: node dist/worker.js
 *
 * Este proceso:
 * - NO abre ningún puerto HTTP
 * - Consume jobs de BullMQ (webhooks PayPal)
 * - Ejecuta cron jobs de reconciliación financiera
 * - Hace graceful shutdown al recibir SIGTERM/SIGINT
 *
 * PM2 / Docker ejemplo:
 *   pm2 start dist/worker.js --name paypal-worker --instances 2
 *   docker run ... node dist/worker.js
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';
import * as dotenv from 'dotenv';

dotenv.config();

const logger = new Logger('Worker');

// ── Validar env vars mínimas para el worker ─────────────────────────────────
const WORKER_REQUIRED_VARS = [
  'REDIS_URL',
  'MONGODB_URI_PAYMENTS',
  'MONGODB_URI_MBOTS',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'TELEGRAM_BOT_TOKEN',
];

for (const envVar of WORKER_REQUIRED_VARS) {
  if (!process.env[envVar]) {
    throw new Error(`[Worker FATAL] Missing required environment variable: ${envVar}`);
  }
}

async function bootstrap() {
  // createApplicationContext: NestJS sin servidor HTTP
  // El worker es un consumidor puro, no expone endpoints
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });

  // Graceful shutdown: esperar a que los jobs activos terminen
  app.enableShutdownHooks();

  logger.log(`PayPal Webhook Worker started [PID=${process.pid}]`);
  logger.log(`Consuming queue: payments_paypal_webhooks`);
  logger.log(`DLQ: payments_paypal_webhooks_dlq`);
  logger.log(`Reconciliation cron: active`);
}

bootstrap().catch((error) => {
  logger.error(`Worker failed to start: ${error?.message ?? error}`);
  process.exit(1);
});
