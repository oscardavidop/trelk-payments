import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * PayPalIpMiddleware
 *
 * Restringe el endpoint de webhooks a las IPs conocidas de PayPal.
 * Referencia oficial: https://developer.paypal.com/api/rest/webhooks/
 *
 * IMPORTANTE: Actualizar esta lista cuando PayPal publique cambios.
 * Considerar obtenerla dinámicamente o usar un allowlist gestionado.
 *
 * En entornos con proxy/load-balancer, asegurarse de configurar:
 *   app.set('trust proxy', 1) o equivalente para obtener la IP real.
 */
@Injectable()
export class PayPalIpMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PayPalIpMiddleware.name);

  // IPs oficiales de PayPal (actualizar periódicamente)
  // Fuente: https://developer.paypal.com/api/rest/webhooks/
  private static readonly PAYPAL_IP_RANGES = new Set([
    // Producción
    '64.4.240.0/21',
    '64.4.248.0/22',
    '66.211.168.0/22',
    '173.0.80.0/20',
    '173.0.82.0/24',
    '69.243.232.0/21',
    // Sandbox
    '173.0.84.0/24',
    '198.199.0.0/20',
  ]);

  // IPs individuales conocidas de PayPal (incluir localhost para desarrollo)
  private static readonly PAYPAL_IPS = new Set([
    '173.0.82.50',
    '173.0.82.52',
    '66.211.170.73',
    '66.211.170.74',
    // Localhost/desarrollo
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
  ]);

  use(req: Request, res: Response, next: NextFunction): void {
    // En bypass mode (desarrollo local sin reverse proxy), saltar validación
    if (process.env.PAYPAL_IP_BYPASS === 'true' && process.env.NODE_ENV !== 'production') {
      return next();
    }

    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      '';

    if (this.isAllowedIp(clientIp)) {
      return next();
    }

    this.logger.warn(
      `Webhook request from unauthorized IP: ${clientIp} — blocked`,
    );

    res.status(403).json({ status: 'forbidden', reason: 'ip_not_allowed' });
  }

  private isAllowedIp(ip: string): boolean {
    // Verificación directa
    if (PayPalIpMiddleware.PAYPAL_IPS.has(ip)) return true;

    // Verificación por CIDR (simplificada para IPv4)
    if (this.isInCidrRanges(ip)) return true;

    return false;
  }

  private isInCidrRanges(ip: string): boolean {
    // Normalizar IPv4-mapped IPv6 (::ffff:x.x.x.x)
    const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
    const ipParts = normalized.split('.').map(Number);
    if (ipParts.length !== 4 || ipParts.some(isNaN)) return false;

    for (const cidr of PayPalIpMiddleware.PAYPAL_IP_RANGES) {
      const [range, bits] = cidr.split('/');
      const prefixLen = parseInt(bits, 10);
      const rangeParts = range.split('.').map(Number);
      if (rangeParts.length !== 4) continue;

      const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
      const ipInt =
        ((ipParts[0] << 24) |
          (ipParts[1] << 16) |
          (ipParts[2] << 8) |
          ipParts[3]) >>>
        0;
      const rangeInt =
        ((rangeParts[0] << 24) |
          (rangeParts[1] << 16) |
          (rangeParts[2] << 8) |
          rangeParts[3]) >>>
        0;

      if ((ipInt & mask) === (rangeInt & mask)) return true;
    }

    return false;
  }
}
