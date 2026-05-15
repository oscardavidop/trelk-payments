/**
 * env.ts — Validación y tipado seguro de variables de entorno con Zod.
 *
 * Por qué Zod:
 * - Falla rápido al arranque si falta algo crítico (fail-fast)
 * - Tipo TypeScript inferido automáticamente del schema
 * - Coerciones automáticas (string → number para PORT)
 * - Mensajes de error descriptivos que dicen exactamente qué falta
 *
 * Uso:
 *   import { env } from '../common/env';
 *   env.REDIS_URL  // string tipado, nunca undefined
 */

import { z } from 'zod';

// ── Schema de validación ──────────────────────────────────────────────────────

const envSchema = z.object({
  // ── Entorno ──────────────────────────────────────────────────────────────
  NODE_ENV: z
    .enum(['development', 'staging', 'production', 'test'])
    .default('development'),
  APP_ENV: z
    .enum(['development', 'staging', 'production', 'test'])
    .optional()
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  // ── PayPal ───────────────────────────────────────────────────────────────
  PAYPAL_CLIENT_ID: z.string().min(10, 'PAYPAL_CLIENT_ID parece muy corto'),
  PAYPAL_CLIENT_SECRET: z.string().min(10, 'PAYPAL_CLIENT_SECRET parece muy corto'),
  PAYPAL_WEBHOOK_ID: z.string().min(5, 'PAYPAL_WEBHOOK_ID requerido'),
  PAYPAL_MODE: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_PLAN_ID: z.string().optional(),

  // ── MongoDB ───────────────────────────────────────────────────────────────
  MONGODB_URI_PAYMENTS: z
    .string()
    .url()
    .refine((v) => v.startsWith('mongodb'), 'Debe ser una URI MongoDB válida'),
  MONGODB_URI_MBOTS: z
    .string()
    .url()
    .refine((v) => v.startsWith('mongodb'), 'Debe ser una URI MongoDB válida'),

  // ── Redis ─────────────────────────────────────────────────────────────────
  REDIS_URL: z
    .string()
    .url()
    .refine((v) => v.startsWith('redis'), 'Debe ser una URL Redis válida (redis:// o rediss://)'),

  // ── Telegram ──────────────────────────────────────────────────────────────
  TELEGRAM_BOT_TOKEN: z
    .string()
    .regex(/^\d+:[A-Za-z0-9_-]+$/, 'TELEGRAM_BOT_TOKEN tiene formato inválido (debe ser NUM:TOKEN)'),

  // ── API interna ───────────────────────────────────────────────────────────
  EXTERNAL_API_KEY: z
    .string()
    .min(32, 'EXTERNAL_API_KEY debe tener al menos 32 caracteres — usa: openssl rand -hex 32'),

  // ── CORS / Network ────────────────────────────────────────────────────────
  BASE_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: z.string().optional(),

  // ── BullMQ Dashboard ──────────────────────────────────────────────────────
  BULL_BOARD_ENABLED: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  BULL_BOARD_USERNAME: z.string().optional().default('admin'),
  BULL_BOARD_PASSWORD: z
    .string()
    .min(12, 'BULL_BOARD_PASSWORD debe tener al menos 12 caracteres')
    .optional(),
});

// ── Parse y exportar ──────────────────────────────────────────────────────────

/** Resultado del parse — inferido del schema, todos los campos son seguros */
export type Env = z.infer<typeof envSchema>;

/**
 * Parsea y valida los env vars del proceso actual.
 * Lanza un error descriptivo al arranque si algo falta o es inválido.
 */
function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues
      .map((e) => `  • ${String(e.path.join('.'))}: ${e.message}`)
      .join('\n');
    throw new Error(
      `\n[FATAL] Variables de entorno inválidas o faltantes:\n${missing}\n\n` +
        `Revisa tu archivo .env (copia de .env.example)\n`,
    );
  }

  return result.data;
}

/** Env vars validadas y tipadas. Disponible en toda la aplicación. */
export const env: Env = parseEnv();
