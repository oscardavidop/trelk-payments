import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { TelegramService } from './telegram/telegram.service';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Habilitar CORS
  app.enableCors();

  // Middleware para servir archivos estáticos
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // Iniciar servidor HTTP
  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`✅ Server running on http://localhost:${port}`);

  // Iniciar bot de Telegram
  const telegramService = app.get(TelegramService);
  await telegramService.start();

  console.log('🚀 Application started successfully');
}

bootstrap().catch((error) => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
});
