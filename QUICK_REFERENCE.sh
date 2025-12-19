#!/bin/bash

# 📋 Quick Reference - Comandos Útiles del Proyecto

# ═══════════════════════════════════════════════════════════════════════════════
# 📂 NAVIGATION
# ═══════════════════════════════════════════════════════════════════════════════

# Ir al proyecto
cd /home/trelkbot17/tg-paypal-bot

# ═══════════════════════════════════════════════════════════════════════════════
# 📦 INSTALACIÓN
# ═══════════════════════════════════════════════════════════════════════════════

# Instalar todas las dependencias
npm install

# Instalar una dependencia adicional
npm install package-name

# Crear carpeta de datos
mkdir -p data

# ═══════════════════════════════════════════════════════════════════════════════
# ⚙️ CONFIGURACIÓN
# ═══════════════════════════════════════════════════════════════════════════════

# Copiar template de variables
cp .env.example .env

# Editar variables de entorno
nano .env

# Ver variables configuradas (sin valores sensibles)
grep -v "^#" .env | grep -v "^$"

# ═══════════════════════════════════════════════════════════════════════════════
# 🚀 EJECUCIÓN
# ═══════════════════════════════════════════════════════════════════════════════

# Desarrollo (con hot-reload)
npm run dev

# Build para producción
npm run build

# Ejecutar en producción
npm start

# ═══════════════════════════════════════════════════════════════════════════════
# 🧪 TESTING
# ═══════════════════════════════════════════════════════════════════════════════

# Ejecutar tests de endpoints (mientras dev está corriendo)
ts-node test.ts

# Ver logs de servidor en tiempo real
npm run dev

# Ver logs de base de datos
sqlite3 data/app.db ".mode box" "SELECT * FROM users;"

# ═══════════════════════════════════════════════════════════════════════════════
# 📊 BASE DE DATOS
# ═══════════════════════════════════════════════════════════════════════════════

# Ver usuarios
sqlite3 data/app.db "SELECT * FROM users;"

# Ver suscripciones
sqlite3 data/app.db "SELECT * FROM subscriptions;"

# Contar usuarios
sqlite3 data/app.db "SELECT COUNT(*) as total FROM users;"

# Limpiar base de datos (perderá datos!)
rm -rf data/app.db

# ═══════════════════════════════════════════════════════════════════════════════
# 🔧 DEVELOPMENT
# ═══════════════════════════════════════════════════════════════════════════════

# Ver estructura de archivos
find src -type f -name "*.ts" | sort

# Contar líneas de código
find src -name "*.ts" -exec wc -l {} + | tail -1

# Ver errores TypeScript
npx tsc --noEmit

# Formatear código
npx prettier --write "src/**/*.ts"

# ═══════════════════════════════════════════════════════════════════════════════
# 📚 DOCUMENTACIÓN
# ═══════════════════════════════════════════════════════════════════════════════

# Ver README
cat README.md

# Ver guía de integración
cat INTEGRATION_GUIDE.md

# Ver ejemplos de código
cat EXAMPLES.ts

# Ver setup visual
cat SETUP.md

# ═══════════════════════════════════════════════════════════════════════════════
# 🔐 SEGURIDAD
# ═══════════════════════════════════════════════════════════════════════════════

# Verificar que .env NO está en git
grep ".env" .gitignore

# Ver archivos que NO están en control de versión
git status

# ═══════════════════════════════════════════════════════════════════════════════
# 📡 PAYPAL
# ═══════════════════════════════════════════════════════════════════════════════

# Crear plan en PayPal (necesita credenciales en .env)
export PAYPAL_CLIENT_ID="YOUR_ID"
export PAYPAL_CLIENT_SECRET="YOUR_SECRET"
export PAYPAL_MODE="sandbox"
bash scripts/create-paypal-plan.sh

# Verificar credenciales de PayPal
curl -X POST https://api-m.sandbox.paypal.com/v1/oauth2/token \
  -H "Authorization: Basic $(echo -n '$PAYPAL_CLIENT_ID:$PAYPAL_CLIENT_SECRET' | base64)" \
  -d "grant_type=client_credentials"

# ═══════════════════════════════════════════════════════════════════════════════
# 💬 TELEGRAM
# ═══════════════════════════════════════════════════════════════════════════════

# Verificar que el token de Telegram es válido
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe"

# Obtener información de un usuario (necesita el bot corriendo)
# En Telegram: @userinfobot

# ═══════════════════════════════════════════════════════════════════════════════
# 🐛 DEBUGGING
# ═══════════════════════════════════════════════════════════════════════════════

# Ver puerto en uso
sudo ss -tulnp | grep 3001

# Ver procesos Node corriendo
ps aux | grep node

# Matar proceso Node
pkill -f "node dist/main.js"

# Ver errores de compilación
npm run build 2>&1 | head -20

# ═══════════════════════════════════════════════════════════════════════════════
# 🌐 ENDPOINTS (Con servidor corriendo)
# ═══════════════════════════════════════════════════════════════════════════════

# Página de suscripción
curl http://localhost:3001/paypal/subscribe?tg_id=123456789

# Ver estado de suscripción
curl http://localhost:3001/paypal/status?tg_id=123456789

# Simular webhook de PayPal
curl -X POST http://localhost:3001/paypal/webhook \
  -H "Content-Type: application/json" \
  -d '{"event_type":"BILLING.SUBSCRIPTION.ACTIVATED","resource":{"id":"I-TEST","custom_id":"telegram_123456789"}}'

# ═══════════════════════════════════════════════════════════════════════════════
# 📦 PRODUCCIÓN
# ═══════════════════════════════════════════════════════════════════════════════

# Compilar para producción
npm run build

# Ver tamaño de dist
du -sh dist/

# Instalar PM2 (gestor de procesos)
npm install -g pm2

# Ejecutar con PM2
pm2 start dist/main.js --name "tg-paypal-bot"

# Ver logs con PM2
pm2 logs tg-paypal-bot

# ═══════════════════════════════════════════════════════════════════════════════
# 🧹 LIMPIEZA
# ═══════════════════════════════════════════════════════════════════════════════

# Eliminar node_modules (cuidado!)
rm -rf node_modules

# Limpiar dist
rm -rf dist

# Limpiar todo (menos .env)
rm -rf dist data node_modules

# ═══════════════════════════════════════════════════════════════════════════════

# 💡 TIPS:
# 1. Siempre edita .env antes de ejecutar por primera vez
# 2. Asegúrate que PAYPAL_PLAN_ID esté configurado
# 3. En desarrollo, usa "npm run dev" (hot-reload)
# 4. Usa ts-node test.ts para verificar endpoints
# 5. Lee INTEGRATION_GUIDE.md si tienes dudas

# ═══════════════════════════════════════════════════════════════════════════════
