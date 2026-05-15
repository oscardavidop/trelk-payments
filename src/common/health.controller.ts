import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';
import { RedisService } from '../redis/redis.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PAYPAL_WEBHOOK_QUEUE, PAYPAL_WEBHOOK_DLQ } from '../queues/paypal-webhook.types';
import axios from 'axios';

/** TTL del cache de la verificación de PayPal conectividad (ms) */
const PAYPAL_CHECK_CACHE_MS = 30_000;

/**
 * HealthController — liveness + readiness probes.
 *
 * GET /health       → liveness  (¿el proceso respira?)
 * GET /health/ready → readiness (¿puede servir tráfico?)
 * GET /health/live  → alias de liveness (compatibilidad k8s)
 *
 * Los load balancers y Kubernetes llaman a estos endpoints.
 * /health/ready devuelve 503 si algún recurso crítico está down.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private paypalCheckCache: { ok: boolean; ts: number } | null = null;

  constructor(
    @InjectConnection('payments') private readonly paymentsConn: Connection,
    @InjectConnection('mbot') private readonly mbotConn: Connection,
    private readonly redisService: RedisService,
    @InjectQueue(PAYPAL_WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
    @InjectQueue(PAYPAL_WEBHOOK_DLQ) private readonly dlqQueue: Queue,
  ) {}

  // ── Liveness ──────────────────────────────────────────────────────────────
  // Solo verifica que el proceso Node está vivo.
  // No verifica dependencias externas (eso lo hace readiness).
  // Si esto retorna error → k8s reinicia el pod.
  @Get()
  @Get('live')
  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      pid: process.pid,
      memory: {
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
        heapTotalMb: Math.round(process.memoryUsage().heapTotal / 1_048_576),
        rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
      },
      version: process.env.npm_package_version ?? '1.0.0',
      env: process.env.NODE_ENV ?? 'development',
    };
  }

  // ── Readiness ─────────────────────────────────────────────────────────────
  // Verifica que todas las dependencias críticas están disponibles.
  // Si retorna 503 → el load balancer deja de enviar tráfico a esta instancia.
  @Get('ready')
  async readiness() {
    const [paymentsDb, mbotDb, redis, queues, paypal] = await Promise.allSettled([
      this.checkMongoDB('payments', this.paymentsConn),
      this.checkMongoDB('mbot', this.mbotConn),
      this.checkRedis(),
      this.checkQueues(),
      this.checkPayPal(),
    ]);

    const checks = {
      mongodb_payments: this.settledResult(paymentsDb),
      mongodb_mbot: this.settledResult(mbotDb),
      redis: this.settledResult(redis),
      queues: this.settledResult(queues),
      paypal_connectivity: this.settledResult(paypal),
    };

    // Críticos: MongoDB y Redis — si fallan, no podemos procesar pagos
    const critical = [checks.mongodb_payments, checks.mongodb_mbot, checks.redis];
    const allCriticalOk = critical.every((c) => c.status === 'ok');

    const response = {
      status: allCriticalOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    };

    if (!allCriticalOk) {
      this.logger.warn(`Readiness check FAILED: ${JSON.stringify(checks)}`);
      throw new HttpException(response, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return response;
  }

  // ── Helpers de checks ────────────────────────────────────────────────────

  private async checkMongoDB(name: string, conn: Connection): Promise<Record<string, unknown>> {
    const state = conn.readyState;
    if (state !== ConnectionStates.connected) {
      throw new Error(`MongoDB ${name} not connected (state=${state})`);
    }
    // Ping real
    await conn.db?.admin().ping();
    return { status: 'ok', connection: name };
  }

  private async checkRedis(): Promise<Record<string, unknown>> {
    const start = Date.now();
    const client = this.redisService.getClient();
    await client.ping();
    const latencyMs = Date.now() - start;
    return { status: 'ok', latencyMs };
  }

  private async checkQueues(): Promise<Record<string, unknown>> {
    const [mainCounts, dlqCounts] = await Promise.all([
      this.webhookQueue.getJobCounts(),
      this.dlqQueue.getJobCounts(),
    ]);

    const dlqFailed = dlqCounts.failed ?? 0;
    const dlqWaiting = dlqCounts.waiting ?? 0;
    const dlqTotal = dlqFailed + dlqWaiting;

    return {
      status: 'ok',
      queue: {
        active: mainCounts.active ?? 0,
        waiting: mainCounts.waiting ?? 0,
        delayed: mainCounts.delayed ?? 0,
        failed: mainCounts.failed ?? 0,
        completed: mainCounts.completed ?? 0,
      },
      dlq: {
        total: dlqTotal,
        failed: dlqFailed,
        waiting: dlqWaiting,
        // Alerta si hay jobs en DLQ esperando revisión manual
        alert: dlqTotal > 0 ? `${dlqTotal} jobs in DLQ require manual review` : null,
      },
    };
  }

  private async checkPayPal(): Promise<Record<string, unknown>> {
    // Cache para no spamear la API de PayPal en cada readiness check
    const now = Date.now();
    if (this.paypalCheckCache && now - this.paypalCheckCache.ts < PAYPAL_CHECK_CACHE_MS) {
      return {
        status: this.paypalCheckCache.ok ? 'ok' : 'degraded',
        cached: true,
      };
    }

    try {
      const apiUrl =
        process.env.PAYPAL_MODE === 'live'
          ? 'https://api-m.paypal.com'
          : 'https://api-m.sandbox.paypal.com';

      // HEAD request al endpoint de PayPal — no requiere auth, solo verifica conectividad
      await axios.head(`${apiUrl}/v1/oauth2/token`, { timeout: 3_000 });
      this.paypalCheckCache = { ok: true, ts: now };
      return { status: 'ok', mode: process.env.PAYPAL_MODE ?? 'sandbox' };
    } catch {
      this.paypalCheckCache = { ok: false, ts: now };
      // PayPal no crítico para readiness — no bloqueamos tráfico si PayPal tiene issues
      return { status: 'degraded', reason: 'PayPal API unreachable' };
    }
  }

  private settledResult(
    result: PromiseSettledResult<Record<string, unknown>>,
  ): Record<string, unknown> {
    if (result.status === 'fulfilled') return result.value;
    return {
      status: 'error',
      error: result.reason?.message ?? String(result.reason),
    };
  }
}

