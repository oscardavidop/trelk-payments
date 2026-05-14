import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import IORedis, { Redis } from 'ioredis';
import { randomBytes } from 'crypto';

/**
 * RedisService
 *
 * Servicio Redis centralizado con:
 * - Reconexión automática con exponential backoff
 * - Locks distribuidos (SET NX PX + Lua release script)
 * - Cache genérico con TTL
 *
 * Por qué Redis en lugar de in-memory:
 * - In-memory caches NO funcionan en multi-instancia/multi-pod
 * - Un token PayPal en variables globales solo lo ven los threads del mismo proceso
 * - Con Redis, 10 pods comparten el mismo token → 10x menos llamadas a PayPal API
 * - Con Redis, la idempotencia de webhooks es cross-instance
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(redisUrl: string) {
    this.client = new IORedis(redisUrl, {
      maxRetriesPerRequest: null, // requerido por BullMQ
      enableReadyCheck: false,
      lazyConnect: false,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 150, 3000);
        this.logger.warn(`Redis reconnect attempt #${times} — next try in ${delay}ms`);
        return delay;
      },
    });

    this.client.on('connect', () => this.logger.log('Redis connected'));
    this.client.on('ready', () => this.logger.log('Redis ready'));
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
    this.client.on('close', () => this.logger.warn('Redis connection closed'));
    this.client.on('reconnecting', () => this.logger.warn('Redis reconnecting…'));
  }

  // ── Cache básico ────────────────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err: any) {
      this.logger.error(`Redis GET failed [key=${key}]: ${err.message}`);
      return null; // degradar gracefully
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err: any) {
      this.logger.error(`Redis SET failed [key=${key}]: ${err.message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    try {
      if (keys.length > 0) await this.client.del(...keys);
    } catch (err: any) {
      this.logger.error(`Redis DEL failed [keys=${keys.join(',')}]: ${err.message}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await this.client.exists(key)) === 1;
    } catch {
      return false;
    }
  }

  // ── Locks distribuidos (Redlock pattern simplificado) ──────────────────────

  /**
   * Intenta adquirir un lock distribuido.
   *
   * Patrón SET NX PX (atómico en Redis):
   * - Solo un proceso/pod obtiene el lock al mismo tiempo
   * - Expira automáticamente si el proceso muere (previene deadlock)
   *
   * @returns token del lock si adquirido, null si no disponible
   */
  async acquireLock(resource: string, ttlMs: number = 10_000): Promise<string | null> {
    const key = `lock:${resource}`;
    const token = randomBytes(16).toString('hex');
    try {
      const result = await this.client.set(key, token, 'PX', ttlMs, 'NX');
      return result === 'OK' ? token : null;
    } catch (err: any) {
      this.logger.error(`Lock acquire failed [resource=${resource}]: ${err.message}`);
      return null;
    }
  }

  /**
   * Libera el lock SOLO si el token coincide (previene liberar el lock de otro proceso).
   * Usa script Lua atómico: compare-and-delete en una sola operación.
   */
  async releaseLock(resource: string, token: string): Promise<void> {
    const key = `lock:${resource}`;
    const lua = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      await this.client.eval(lua, 1, key, token);
    } catch (err: any) {
      this.logger.error(`Lock release failed [resource=${resource}]: ${err.message}`);
    }
  }

  /**
   * Retorna el cliente IORedis subyacente (para BullMQ u otros usos avanzados).
   * CUIDADO: no pasar este cliente a código externo no confiable.
   */
  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing Redis connection…');
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
