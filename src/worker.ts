import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { AppLogger } from './common/app-logger';
import * as dotenv from 'dotenv';

dotenv.config();

// Validación de env con Zod (falla rápido si falta algo crítico)
import './common/env';

const logger = new AppLogger('Worker');

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new AppLogger('Worker-NestJS'),
    bufferLogs: true,
  });

  app.enableShutdownHooks();

  logger.log(`Worker started [PID=${process.pid}]`);
  logger.log(`Queue: payments_paypal_webhooks`);
  logger.log(`DLQ:   payments_paypal_webhooks_dlq`);
  logger.log(`Cron:  reconciliation active`);
}

bootstrap().catch((error) => {
  logger.error(`Worker failed to start: ${error?.message ?? error}`);
  process.exit(1);
});
