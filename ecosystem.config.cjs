/**
 * ecosystem.config.cjs — Configuración PM2 para producción.
 *
 * Uso:
 *   pm2 start ecosystem.config.cjs          # Iniciar todos
 *   pm2 restart ecosystem.config.cjs        # Restart con reload config
 *   pm2 reload ecosystem.config.cjs         # Zero-downtime reload (cluster mode)
 *   pm2 delete ecosystem.config.cjs         # Detener y eliminar todos
 *   pm2 logs payments-api                   # Ver logs de la API
 *   pm2 monit                               # Monitor interactivo
 *   pm2 save && pm2 startup                 # Persitir entre reinicios del SO
 *
 * Escalar workers horizontalmente:
 *   pm2 scale payments-worker +2            # Agregar 2 instancias más
 *   pm2 scale payments-worker 4             # Fijar en 4 instancias
 *
 * NOTA: Los workers BullMQ son concurrency-safe por diseño.
 * Pueden correr múltiples instancias sin riesgo de procesamiento duplicado
 * gracias a la idempotencia Redis+MongoDB implementada en el processor.
 */

'use strict';

// Carpeta de logs — PM2 crea si no existe
const LOG_DIR = './logs';

module.exports = {
  apps: [
    // ── API Process ────────────────────────────────────────────────────────
    {
      name: 'payments-api',
      script: 'dist/main.js',
      instances: 'max',           // Un proceso por CPU (cluster mode)
      exec_mode: 'cluster',       // Balanceo de carga automático entre instancias
      wait_ready: true,           // Esperar señal app.ready antes de considerar started
      listen_timeout: 10_000,     // Tiempo máximo de startup en ms
      kill_timeout: 5_000,        // Tiempo de graceful shutdown antes de SIGKILL
      max_memory_restart: '512M', // Restart automático si supera 512MB heap

      // ── Restart policy ──────────────────────────────────────────────────
      restart_delay: 3_000,       // Esperar 3s antes de reintentar restart
      max_restarts: 10,           // Máximo 10 reinicios por minuto
      min_uptime: '30s',          // Si muere antes de 30s → no contar como restart exitoso

      // ── Variables de entorno ──────────────────────────────────────────
      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=256',
      },

      // ── Logs ─────────────────────────────────────────────────────────
      out_file: `${LOG_DIR}/api.out.log`,
      error_file: `${LOG_DIR}/api.err.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      merge_logs: true,           // Un solo archivo para todas las instancias del cluster
      log_type: 'json',

      // ── Source maps ───────────────────────────────────────────────────
      source_map_support: true,
    },

    // ── Worker Process ─────────────────────────────────────────────────────
    // Los workers BullMQ NO usan cluster mode: se escalan como procesos separados.
    // Cada proceso Worker es un consumidor BullMQ independiente.
    // BullMQ garantiza que cada job es procesado por exactamente un worker.
    {
      name: 'payments-worker',
      script: 'dist/worker.js',
      instances: 2,               // 2 instancias por defecto (escalar según carga)
      exec_mode: 'fork',          // FORK (no cluster): cada worker es independiente
      wait_ready: true,
      listen_timeout: 15_000,     // Workers tardan más en iniciar (conexiones BD+BullMQ)
      kill_timeout: 30_000,       // 30s graceful shutdown: terminar jobs activos
      max_memory_restart: '384M',

      restart_delay: 5_000,
      max_restarts: 10,
      min_uptime: '30s',

      env_file: '.env',
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=256',
      },

      out_file: `${LOG_DIR}/worker.out.log`,
      error_file: `${LOG_DIR}/worker.err.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS Z',
      merge_logs: true,
      log_type: 'json',
      source_map_support: true,
    },
  ],
};
