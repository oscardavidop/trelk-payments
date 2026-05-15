/**
 * app-logger.ts — Logger estructurado con formato adaptativo.
 *
 * En DESARROLLO: pretty-print con colores, legible por humanos.
 * En PRODUCCIÓN:  JSON newline-delimited, parseable por Datadog/Loki/CloudWatch.
 *
 * Implementa LoggerService de NestJS para integrar con el sistema de
 * logging de NestJS (puede pasarse al NestFactory.create).
 *
 * Campos JSON en producción:
 *   { level, message, context, timestamp, pid, traceId, ...meta }
 */

import { LoggerService as NestLoggerService } from '@nestjs/common';

// ── Colores ANSI (solo se usan en dev) ────────────────────────────────────────
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
} as const;

const LEVEL_COLORS: Record<string, string> = {
  log:     COLORS.green,
  error:   COLORS.red,
  warn:    COLORS.yellow,
  debug:   COLORS.cyan,
  verbose: COLORS.magenta,
  fatal:   COLORS.red + COLORS.bright,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function iso(): string {
  return new Date().toISOString();
}

function formatPretty(
  level: string,
  message: string,
  context?: string,
  meta?: Record<string, unknown>,
): string {
  const color = LEVEL_COLORS[level] ?? COLORS.white;
  const ts = `${COLORS.gray}${iso()}${COLORS.reset}`;
  const lvl = `${color}${level.toUpperCase().padEnd(7)}${COLORS.reset}`;
  const ctx = context ? ` ${COLORS.cyan}[${context}]${COLORS.reset}` : '';
  const metaStr = meta ? ` ${COLORS.dim}${JSON.stringify(meta)}${COLORS.reset}` : '';
  return `${ts} ${lvl}${ctx} ${message}${metaStr}`;
}

function formatJson(
  level: string,
  message: string,
  context?: string,
  trace?: string,
  meta?: Record<string, unknown>,
): string {
  return JSON.stringify({
    level,
    message,
    context: context ?? 'App',
    timestamp: iso(),
    pid: process.pid,
    ...(trace ? { trace } : {}),
    ...(meta ?? {}),
  });
}

// ── AppLogger ─────────────────────────────────────────────────────────────────

/**
 * Logger de aplicación que implementa la interfaz de NestJS.
 * Úsalo como logger global:
 *
 *   const app = await NestFactory.create(AppModule, {
 *     logger: new AppLogger('API'),
 *   });
 */
export class AppLogger implements NestLoggerService {
  private readonly isProd: boolean;
  private readonly defaultContext: string;

  constructor(context = 'App') {
    this.defaultContext = context;
    this.isProd = process.env.NODE_ENV === 'production';
  }

  private write(
    level: string,
    message: unknown,
    contextOrTrace?: string,
    _: unknown = undefined,
    meta?: Record<string, unknown>,
  ): void {
    const msg = typeof message === 'string' ? message : JSON.stringify(message);
    const ctx = contextOrTrace ?? this.defaultContext;

    const line = this.isProd
      ? formatJson(level, msg, ctx, undefined, meta)
      : formatPretty(level, msg, ctx, meta);

    // Separar errores y advertencias en stderr
    if (level === 'error' || level === 'fatal') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    const meta: Record<string, unknown> = {};
    if (trace) meta.stack = trace;
    this.write('error', message, context, undefined, Object.keys(meta).length ? meta : undefined);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    if (this.isProd) return; // No debug en producción
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    if (this.isProd) return;
    this.write('verbose', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }
}
