# 🤖 Telegram Bot + PayPal Subscriptions

Integración completa de un bot de Telegram con PayPal Subscriptions para gestionar suscripciones automáticas.

## 📋 Características

✅ **Suscripciones automáticas** - Cobro mensual/anual sin intervención manual
✅ **Webhook de PayPal** - Sincronización automática de eventos
✅ **Base de datos SQLite** - Registro de usuarios y suscripciones
✅ **Bot de Telegram** - Notificaciones y comandos para usuarios
✅ **Panel HTML** - Página de checkout con SDK de PayPal
✅ **Seguridad** - Verificación de firmas y autorización

## 🚀 Instalación Rápida

### 1. Configuración de PayPal

#### a) Crear aplicación en PayPal Developer

1. Ir a [developer.paypal.com](https://developer.paypal.com)
2. Crear una **App** en Sandbox
3. Obtener:
   - `PAYPAL_CLIENT_ID`
   - `PAYPAL_CLIENT_SECRET`

#### b) Crear Producto y Plan

```bash
# Opción 1: Usar script (si existe)
node scripts/create-paypal-plan.js

# Opción 2: Dashboard PayPal
# 1. Ir a Products → Catalogs
# 2. Crear producto: "Premium Bot Access"
# 3. Crear plan: $10 USD/mes
# 4. Copiar PLAN_ID
```

**Variables necesarias:**
- `PAYPAL_PLAN_ID` - ID del plan creado
- `PAYPAL_WEBHOOK_ID` - Lo obtendrás al crear el webhook

#### c) Configurar Webhook

1. En [developer.paypal.com](https://developer.paypal.com) → Webhooks
2. Crear webhook con URL: `https://tu-dominio.com/paypal/webhook`
3. Seleccionar eventos:
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.RE_ACTIVATED`
   - `PAYMENT.BILLING.SUBSCRIPTION.PAYMENT.FAILED`
4. Copiar `WEBHOOK_ID`

### 2. Configuración de Telegram Bot

1. Hablar con [@BotFather](https://t.me/botfather)
2. `/newbot` y seguir instrucciones
3. Copiar el `TOKEN`

**Variable necesaria:**
- `TELEGRAM_BOT_TOKEN` - Token del bot

### 3. Variables de Entorno

Copiar `.env.example` a `.env` y llenar:

```bash
cp .env.example .env
```

Editar `.env`:

```env
# PayPal Config
PAYPAL_MODE=sandbox                    # o 'live' para producción
PAYPAL_CLIENT_ID=YOUR_CLIENT_ID
PAYPAL_CLIENT_SECRET=YOUR_SECRET
PAYPAL_PLAN_ID=P-XXXXX                # Obtenido de PayPal
PAYPAL_WEBHOOK_ID=XXXXX               # Obtenido de PayPal

# Telegram Config
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN

# Server Config
PORT=3001
NODE_ENV=development
BASE_URL=http://localhost:3001        # En producción: https://tu-dominio.com

# Database
DATABASE_URL=sqlite:./data/app.db
```

### 4. Instalación y Ejecución

```bash
# Instalar dependencias
npm install

# Crear base de datos
mkdir -p data

# Desarrollo (con watch)
npm run dev

# Producción
npm run build
npm start
```

## 📚 Estructura del Proyecto

```
tg-paypal-bot/
├── src/
│   ├── paypal/                 # Servicio PayPal API
│   │   ├── paypal.service.ts   # Métodos para API de PayPal
│   │   └── paypal.module.ts    # Módulo NestJS
│   ├── telegram/               # Servicio Telegram Bot
│   │   ├── telegram.service.ts # Métodos del bot
│   │   └── telegram.module.ts  # Módulo NestJS
│   ├── subscription/           # Lógica de suscripciones
│   │   ├── subscription.service.ts
│   │   └── subscription.module.ts
│   ├── database/               # Modelos de datos
│   │   ├── entities/
│   │   │   ├── user.entity.ts
│   │   │   ├── subscription.entity.ts
│   │   │   └── index.ts
│   ├── paypal.controller.ts    # Endpoints HTTP
│   ├── app.module.ts           # Módulo principal
│   └── main.ts                 # Punto de entrada
├── data/                       # Base de datos SQLite (generada)
├── .env.example                # Variables de ejemplo
├── package.json
├── tsconfig.json
└── nest-cli.json
```

## 🔄 Flujo de Suscripción

```
Usuario Telegram
    ↓
Toca botón /premium
    ↓
Backend genera URL con tg_id
    ↓
Abre página en navegador
    ↓
Hace clic en "Suscribirse"
    ↓
Redirige a PayPal
    ↓
Usuario autoriza pago
    ↓
PayPal redirige a /success
    ↓
Backend guarda suscripción pendiente
    ↓
PayPal envía webhook ACTIVATED
    ↓
Backend activa en BD
    ↓
Telegram bot notifica ✅
    ↓
Usuario ya es premium
```

## 🛠️ API Endpoints

### GET `/paypal/subscribe?tg_id=123456789`
**Descripción:** Muestra página de suscripción con SDK de PayPal
**Parámetros:**
- `tg_id` (requerido): ID de Telegram del usuario

**Respuesta:** HTML con formulario de PayPal

### GET `/paypal/success?subscription_id=I-XXX&tg_id=123`
**Descripción:** Confirmación de suscripción aprobada
**Parámetros:**
- `subscription_id`: ID de suscripción de PayPal
- `tg_id`: ID de Telegram

**Respuesta:** Página de éxito + redirige a BD

### POST `/paypal/webhook`
**Descripción:** Webhook de PayPal (automático)
**Headers:**
- `PayPal-Transmission-Id`
- `PayPal-Transmission-Time`
- `PayPal-Cert-Url`
- `PayPal-Auth-Algo`
- `PayPal-Transmission-Sig`

**Body:** Evento de PayPal (JSON)

**Eventos procesados:**
- `BILLING.SUBSCRIPTION.ACTIVATED` - Activa premium
- `BILLING.SUBSCRIPTION.CANCELLED` - Desactiva premium
- `BILLING.SUBSCRIPTION.SUSPENDED` - Pausa premium
- `BILLING.SUBSCRIPTION.RE_ACTIVATED` - Reactiva premium
- `PAYMENT.BILLING.SUBSCRIPTION.PAYMENT.FAILED` - Notifica error

### GET `/paypal/status?tg_id=123456789`
**Descripción:** Obtiene estado de suscripción del usuario
**Parámetros:**
- `tg_id` (requerido): ID de Telegram

**Respuesta:**
```json
{
  "telegramId": 123456789,
  "isPremium": true,
  "activeSubscriptions": 1,
  "subscriptions": [
    {
      "id": "I-XXXXX",
      "status": "ACTIVE",
      "amount": 10,
      "currency": "USD",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

### POST `/paypal/cancel`
**Descripción:** Cancela una suscripción
**Body:**
```json
{
  "tg_id": 123456789,
  "subscription_id": "I-XXXXX"
}
```

**Respuesta:**
```json
{
  "status": "cancelled"
}
```

## 🤖 Comandos del Bot de Telegram

| Comando | Descripción |
|---------|-------------|
| `/start` | Muestra bienvenida y opciones |
| `/premium` | Abre página de suscripción |
| `/status` | Muestra estado actual del usuario |
| `/help` | Muestra información de ayuda |

## 🔐 Seguridad

### Verificación de Webhooks

PayPal firma todos los webhooks. El sistema verifica automáticamente:

```typescript
const isValid = await this.paypalService.verifyWebhookSignature(
  webhookId,
  webhookEvent
);
```

### Autenticación

- **Webhooks:** Verificación de firma de PayPal
- **Cancelación:** Solo el propietario de la suscripción puede cancelar
- **Datos:** IDs de Telegram protegidos en custom_id

### Base de Datos

- SQLite (cifra con contraseña en producción)
- Relaciones uno-a-muchos (Usuario → Suscripciones)
- Timestamps de creación y actualización

## 📝 Ejemplos de Uso

### Enviar botón de suscripción a usuario

```typescript
const telegramService = app.get(TelegramService);

await telegramService.sendPremiumButton(null, userId);
```

### Verificar si usuario es premium

```typescript
const subscriptionService = app.get(SubscriptionService);

const isPremium = await subscriptionService.getUserPremiumStatus(userId);
```

### Obtener suscripciones activas

```typescript
const subscriptions = await subscriptionService.getUserActiveSubscriptions(userId);
```

### Cancelar desde código

```typescript
const paypalService = app.get(PaypalService);

await paypalService.cancelSubscription(subscriptionId);
```

## 🧪 Testing en Sandbox

### 1. Crear cuenta PayPal de prueba

- Ir a [developer.paypal.com](https://developer.paypal.com)
- Tools → Accounts
- Crear comprador y vendedor

### 2. Testear flujo completo

1. Ir a `http://localhost:3001/paypal/subscribe?tg_id=123456789`
2. Hacer clic en botón
3. Usar credenciales de Sandbox
4. Completar pago
5. Ver webhook en Logs de PayPal

### 3. Simular eventos de webhook

```bash
curl -X POST http://localhost:3001/paypal/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "BILLING.SUBSCRIPTION.ACTIVATED",
    "resource": {
      "id": "I-TEST123",
      "custom_id": "telegram_123456789",
      "status": "ACTIVE"
    }
  }'
```

## 📊 Base de Datos

### Tabla: users
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  telegramId BIGINT UNIQUE NOT NULL,
  telegramUsername VARCHAR,
  firstName VARCHAR,
  lastName VARCHAR,
  paypalPayerId VARCHAR,
  tier VARCHAR DEFAULT 'free',
  isPremium BOOLEAN DEFAULT FALSE,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabla: subscriptions
```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  paypalSubscriptionId VARCHAR UNIQUE NOT NULL,
  planId VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'APPROVAL_PENDING',
  paypalPayerId VARCHAR,
  amount DECIMAL(10, 2),
  currency VARCHAR,
  nextBillingDate DATETIME,
  cancelledAt DATETIME,
  userId UUID NOT NULL REFERENCES users(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 🚀 Deploy en Producción

### 1. Cambiar a modo Live

En `.env`:
```env
PAYPAL_MODE=live
BASE_URL=https://tu-dominio.com
NODE_ENV=production
```

### 2. Configurar dominio

```bash
# Actualizar webhook en PayPal
https://tu-dominio.com/paypal/webhook

# Actualizar token de Telegram
# Bot → Token debe ser válido
```

### 3. Usar base de datos persistente

```env
# En lugar de SQLite, usar PostgreSQL
DATABASE_URL=postgresql://user:pass@host:5432/db
```

### 4. Variables de entorno seguras

```bash
# En servidor (no en .env)
export PAYPAL_CLIENT_ID=xxx
export PAYPAL_CLIENT_SECRET=xxx
export TELEGRAM_BOT_TOKEN=xxx
export PAYPAL_WEBHOOK_ID=xxx
```

### 5. Usar PM2 o similar

```bash
pm2 start dist/main.js --name "tg-paypal-bot"
pm2 save
pm2 startup
```

## 🐛 Troubleshooting

### Error: "Invalid webhook signature"

**Solución:** Esperar a que PayPal propague el webhook ID (puede tardar minutos)

### Usuario no recibe notificación de Telegram

**Verificar:**
- Token de bot es válido: `curl https://api.telegram.org/botTOKEN/getMe`
- Chat ID es correcto
- Bot no está bloqueado por el usuario

### Suscripción no se activa

**Verificar:**
- `PAYPAL_WEBHOOK_ID` es correcto
- Webhook está registrado en PayPal
- Network tab muestra respuesta 200 del servidor

### Error de base de datos

**Solución:**
```bash
rm -rf data/app.db
npm run dev
```

## 📞 Soporte

Para reportar errores o sugerencias:
- Abrir issue en GitHub
- Contactar a: support@example.com

## 📄 Licencia

MIT
# page
