import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';

/**
 * HealthController
 *
 * Endpoints de salud requeridos por load balancers, Kubernetes probes y
 * sistemas de monitoreo (UptimeRobot, Pingdom, etc.).
 *
 * GET /health    — liveness probe  (está vivo el proceso?)
 * GET /health/ready — readiness probe (puede recibir tráfico?)
 */
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection('payments') private readonly paymentsConn: Connection,
    @InjectConnection('mbot') private readonly mbotConn: Connection,
  ) {}

  @Get()
  liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    };
  }

  @Get('ready')
  readiness() {
    const paymentsReady = this.paymentsConn.readyState === ConnectionStates.connected;
    const mbotReady = this.mbotConn.readyState === ConnectionStates.connected;
    const ready = paymentsReady && mbotReady;

    const status = {
      status: ready ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      databases: {
        payments: paymentsReady ? 'connected' : 'disconnected',
        mbot: mbotReady ? 'connected' : 'disconnected',
      },
    };

    if (!ready) {
      // Devolver 503 para que el load balancer deje de enviar tráfico
      throw Object.assign(new Error('Service not ready'), {
        response: status,
        status: 503,
      });
    }

    return status;
  }
}
