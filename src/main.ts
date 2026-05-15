import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { AppModule } from './app.module';
import { AppLogger } from './common/app-logger';
import * as dotenv from 'dotenv';
import * as bodyParser from 'body-parser';
import helmet from 'helmet';

dotenv.config();

// ── Validación de env con Zod ────────────────────────────────────────────────
// Importar env dispara la validación — falla con mensaje claro si algo falta
import { env } from './common/env';

const logger = new AppLogger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Usar nuestro logger estructurado (JSON en prod, pretty en dev)
    logger: new AppLogger('NestJS'),
    bufferLogs: true,
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  // Permite que NestJS complete requests en vuelo antes de terminar
  app.enableShutdownHooks();

  // ── Helmet: security headers ───────────────────────────────────────────────
  // Agrega: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, CORP, etc.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://www.paypal.com', 'https://www.paypalobjects.com'],
          frameSrc: ["'self'", 'https://www.paypal.com'],
          imgSrc: ["'self'", 'data:', 'https://www.paypalobjects.com'],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  // ── Raw body para verificación de firma PayPal ─────────────────────────────
  // Solo captura rawBody; el límite de 256kb previene JSON bombs
  app.use(
    bodyParser.json({
      limit: '256kb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );

  // ── CORS ───────────────────────────────────────────────────────────────────
  // NOTA: el fallback usa el protocolo explícito https:// para ser válido
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['https://trelk.site'];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── ValidationPipe global ──────────────────────────────────────────────────
  // Valida todos los DTOs automáticamente; rechaza propiedades desconocidas
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      disableErrorMessages: env.NODE_ENV === 'production',
    }),
  );

  app.useStaticAssets(join(__dirname, '..', 'public'));

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`API running on port ${env.PORT} [${env.NODE_ENV}] [PID=${process.pid}]`);
}

bootstrap().catch((error) => {
  logger.error('Failed to start application', error?.message ?? error);
  process.exit(1);
});
