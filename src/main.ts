import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { join } from 'path';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import * as bodyParser from 'body-parser';
import helmet from 'helmet';

dotenv.config();

const logger = new Logger('Bootstrap');

// ── Validar variables de entorno críticas al arranque ────────────────────────
const REQUIRED_ENV_VARS = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'MONGODB_URI_PAYMENTS',
  'MONGODB_URI_MBOTS',
  'TELEGRAM_BOT_TOKEN',
  'EXTERNAL_API_KEY',
  'REDIS_URL',
];

for (const envVar of REQUIRED_ENV_VARS) {
  if (!process.env[envVar]) {
    throw new Error(`[FATAL] Missing required environment variable: ${envVar}`);
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Deshabilitar logs de arranque con cuerpo (evita exponer env en init)
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
      whitelist: true,           // elimina campos no declarados en DTO
      forbidNonWhitelisted: true, // lanza error si llegan campos no declarados
      transform: true,           // convierte tipos automáticamente
      disableErrorMessages: process.env.NODE_ENV === 'production',
    }),
  );

  // ── Archivos estáticos ─────────────────────────────────────────────────────
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // ── Servidor ───────────────────────────────────────────────────────────────
  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`Server running on port ${port} [${process.env.NODE_ENV ?? 'development'}]`);
}

bootstrap().catch((error) => {
  logger.error('Failed to start application', error?.message ?? error);
  process.exit(1);
});
