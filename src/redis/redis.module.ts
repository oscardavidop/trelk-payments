import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * RedisModule — @Global()
 *
 * Al ser global, cualquier módulo puede inyectar RedisService sin
 * necesidad de importar RedisModule explícitamente.
 *
 * Requiere REDIS_URL en variables de entorno.
 * Ejemplo: redis://localhost:6379 o rediss://user:pass@host:6380/0
 */
@Global()
@Module({
  providers: [
    {
      provide: RedisService,
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;
        if (!redisUrl) {
          throw new Error('[FATAL] REDIS_URL is required — RedisModule cannot initialize');
        }
        return new RedisService(redisUrl);
      },
    },
  ],
  exports: [RedisService],
})
export class RedisModule {}
