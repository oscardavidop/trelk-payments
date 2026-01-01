import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import * as bodyParser from 'body-parser';

dotenv.config();

// Validar variables de entorno críticas en startup
const requiredEnvVars = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  // 'MONGODB_URI',
  'TELEGRAM_BOT_TOKEN',
  'EXTERNAL_API_KEY',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

async function bootstrap() {
  console.log('🚀 Starting application...');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // CORS con restricciones
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['trelk.site'],
    credentials: true,
  });

  // Middleware para servir archivos estáticos
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.use(
    bodyParser.json({
      verify: (req: any, res, buf) => {
        req.rawBody = buf.toString();
      },
    }),
  );
  // Iniciar servidor HTTP
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`✅ Server running on http://localhost:${port}`);
  console.log('🚀 Application started successfully');
}

bootstrap().catch((error) => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
