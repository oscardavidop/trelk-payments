/**
 * bull-board.middleware.ts
 *
 * Integra @bull-board/express como middleware de NestJS.
 * Expone el dashboard en /queues (solo habilitado si BULL_BOARD_ENABLED=true).
 *
 * Seguridad:
 * - Solo accesible con Basic Auth (BULL_BOARD_USERNAME / BULL_BOARD_PASSWORD)
 * - En producción, proteger adicionalmente con VPN o IP allowlist en nginx
 * - No exponer al público: contiene información de todos los jobs y payloads
 */

import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';

@Injectable()
export class BullBoardMiddleware implements NestMiddleware {
  private readonly logger = new Logger(BullBoardMiddleware.name);
  private readonly serverAdapter: ExpressAdapter;

  constructor(private readonly queues: Queue[]) {
    this.serverAdapter = new ExpressAdapter();
    this.serverAdapter.setBasePath('/queues');

    createBullBoard({
      queues: queues.map((q) => new BullMQAdapter(q)),
      serverAdapter: this.serverAdapter,
    });

    this.logger.log(`Bull Board initialized with ${queues.length} queues`);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    // Basic Auth
    const username = process.env.BULL_BOARD_USERNAME || 'admin';
    const password = process.env.BULL_BOARD_PASSWORD;

    if (!password) {
      this.logger.warn('BULL_BOARD_PASSWORD not set — Bull Board disabled for security');
      res.status(503).json({ error: 'Dashboard disabled: BULL_BOARD_PASSWORD not configured' });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const [user, pass] = decoded.split(':');

    // Comparación en tiempo constante
    const { timingSafeEqual } = require('crypto');
    const validUser = Buffer.from(username);
    const validPass = Buffer.from(password);
    const inputUser = Buffer.from(user ?? '');
    const inputPass = Buffer.from(pass ?? '');

    const userMatch =
      inputUser.length === validUser.length &&
      timingSafeEqual(inputUser, validUser);
    const passMatch =
      inputPass.length === validPass.length &&
      timingSafeEqual(inputPass, validPass);

    if (!userMatch || !passMatch) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Despachar al handler de bull-board
    this.serverAdapter.getRouter()(req, res, next);
  }
}
