╔════════════════════════════════════════════════════════════════════════════════╗
║                    🤖 TELEGRAM + PAYPAL SUBSCRIPTIONS                          ║
║                         Sistema de Suscripciones Automáticas                   ║
╚════════════════════════════════════════════════════════════════════════════════╝

📂 ESTRUCTURA DEL PROYECTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

tg-paypal-bot/
├── 📦 src/
│   ├── 💳 paypal/
│   │   ├── paypal.service.ts      → Métodos de API de PayPal
│   │   └── paypal.module.ts       → Módulo de inyección
│   │
│   ├── 💬 telegram/
│   │   ├── telegram.service.ts    → Bot commands y notificaciones
│   │   └── telegram.module.ts     → Módulo de inyección
│   │
│   ├── 💾 database/
│   │   └── entities/
│   │       ├── user.entity.ts     → Modelo de usuarios
│   │       ├── subscription.entity.ts → Modelo de suscripciones
│   │       └── index.ts
│   │
│   ├── 📋 subscription/
│   │   ├── subscription.service.ts → Lógica de suscripciones
│   │   └── subscription.module.ts  → Módulo de inyección
│   │
│   ├── paypal.controller.ts       → Rutas HTTP (endpoints)
│   ├── app.module.ts              → Módulo raíz
│   └── main.ts                    → Punto de entrada
│
├── 🌐 public/                     → Archivos estáticos (futuro)
├── data/                          → Base de datos SQLite
├── scripts/
│   └── create-paypal-plan.sh      → Script de setup
├── .env.example                   → Plantilla de variables
├── .env                           → Variables (crear)
├── package.json
├── tsconfig.json
├── nest-cli.json
├── README.md                      → Documentación completa
├── INTEGRATION_GUIDE.md           → Guía paso a paso
├── EXAMPLES.ts                    → Ejemplos de código
└── test.ts                        → Tests de endpoints


🔄 FLUJO DE SUSCRIPCIÓN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────┐
│  TELEGRAM   │ 1. Usuario escribe /premium
└──────┬──────┘
       │
       ├─→ Bot envía botón con URL
       │   /paypal/subscribe?tg_id=123456789
       │
       ▼
┌──────────────────┐
│  SERVIDOR BACKEND│ 2. GET /paypal/subscribe
│  (NestJS)        │    → Renderiza HTML con SDK PayPal
└────────┬─────────┘
         │
         ├─→ Usuario hace clic en botón
         │
         ▼
    ┌───────────────┐
    │   PAYPAL      │ 3. Usuario hace login
    │   SANDBOX     │    Aprueba pago
    │   CHECKOUT    │
    └────────┬──────┘
             │
             ├─→ Redirige a /success
             │
             ▼
    ┌──────────────────┐
    │ BD (SQLite)      │ 4. Guarda suscripción pendiente
    │ users + subs     │
    └──────────────────┘
             │
             ├─→ PayPal envía webhook
             │   BILLING.SUBSCRIPTION.ACTIVATED
             │
             ▼
    ┌──────────────────┐
    │ POST /webhook    │ 5. Backend recibe evento
    └────────┬─────────┘
             │
             ├─→ Verifica firma
             ├─→ Actualiza BD
             ├─→ Activa premium en usuario
             │
             ▼
    ┌──────────────────┐
    │   TELEGRAM       │ 6. Bot notifica usuario
    │   (Mensaje ✅)   │    "¡Suscripción activa!"
    └──────────────────┘


🛠️ COMPONENTES PRINCIPALES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 PaypalService
   ├─ getAccessToken()           → Obtiene token de API
   ├─ createProduct()            → Crea producto
   ├─ createPlan()               → Crea plan de precios
   ├─ getPlan()                  → Obtiene detalles del plan
   ├─ getSubscription()          → Obtiene datos de suscripción
   ├─ cancelSubscription()       → Cancela suscripción
   ├─ suspendSubscription()      → Pausa suscripción
   ├─ activateSubscription()     → Reactiva suspendida
   ├─ verifyWebhookSignature()   → Verifica firma de webhook
   └─ generateWebhookSignature() → Genera firma esperada


📌 TelegramService
   ├─ start()                    → Inicia bot
   ├─ stop()                     → Detiene bot
   ├─ getBot()                   → Retorna instancia
   ├─ sendPremiumButton()        → Envía botón de suscripción
   ├─ sendMessage()              → Envía mensaje personalizado
   ├─ notifySubscriptionActivated()
   ├─ notifySubscriptionCancelled()
   ├─ notifyPaymentFailed()
   └─ sendHelp()


📌 SubscriptionService
   ├─ getOrCreateUser()          → Obtiene o crea usuario
   ├─ getUserByTelegramId()      → Busca usuario
   ├─ getSubscriptionByPaypalId()→ Busca suscripción
   ├─ createSubscription()       → Crea nueva suscripción
   ├─ activateSubscription()     → Activa suscripción
   ├─ cancelSubscription()       → Cancela suscripción
   ├─ suspendSubscription()      → Suspende suscripción
   ├─ resumeSubscription()       → Reactiva suscripción
   ├─ getUserPremiumStatus()     → Verifica si es premium
   └─ getUserActiveSubscriptions()→ Obtiene suscripciones activas


📌 PaypalController (Endpoints HTTP)
   ├─ GET  /paypal/subscribe?tg_id=XXX → Página de checkout
   ├─ GET  /paypal/success?subscription_id=XXX&tg_id=XXX → Confirmación
   ├─ POST /paypal/webhook              → Recibe eventos
   ├─ GET  /paypal/status?tg_id=XXX    → Estado de suscripción
   └─ POST /paypal/cancel               → Cancela suscripción


📊 BASE DE DATOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TABLE: users
┌─────────────────────────────────────────────────────────┐
│ id (UUID)                                               │
│ telegramId (BIGINT) - ID único de Telegram              │
│ telegramUsername (VARCHAR)                              │
│ firstName (VARCHAR)                                     │
│ lastName (VARCHAR)                                      │
│ paypalPayerId (VARCHAR)                                 │
│ tier (VARCHAR) - free | premium | pro                   │
│ isPremium (BOOLEAN)                                     │
│ createdAt (DATETIME)                                    │
│ updatedAt (DATETIME)                                    │
└─────────────────────────────────────────────────────────┘

TABLE: subscriptions
┌─────────────────────────────────────────────────────────┐
│ id (UUID)                                               │
│ paypalSubscriptionId (VARCHAR) - ID de PayPal           │
│ planId (VARCHAR) - Plan al que está suscrito            │
│ status (VARCHAR) - APPROVAL_PENDING | ACTIVE | ...      │
│ paypalPayerId (VARCHAR)                                 │
│ amount (DECIMAL)                                        │
│ currency (VARCHAR)                                      │
│ nextBillingDate (DATETIME)                              │
│ cancelledAt (DATETIME)                                  │
│ userId (UUID) - Referencia a users                      │
│ createdAt (DATETIME)                                    │
│ updatedAt (DATETIME)                                    │
└─────────────────────────────────────────────────────────┘


⚙️ VARIAB LES DE ENTORNO NECESARIAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PAYPAL_MODE=sandbox                 # sandbox | live
PAYPAL_CLIENT_ID=AXXX               # De PayPal Developer
PAYPAL_CLIENT_SECRET=EXXX           # De PayPal Developer
PAYPAL_PLAN_ID=P-XXXX               # Del script create-paypal-plan.sh
PAYPAL_WEBHOOK_ID=XXXX              # De PayPal Webhooks

TELEGRAM_BOT_TOKEN=123456:ABCXYZ   # De @BotFather

PORT=3001                           # Puerto del servidor
NODE_ENV=development                # development | production
BASE_URL=http://localhost:3001     # En producción: https://dominio.com

DATABASE_URL=sqlite:./data/app.db  # Conexión a BD


🚀 COMANDOS QUICK START
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# Instalación
npm install

# Crear carpeta de datos
mkdir -p data

# Crear .env desde ejemplo
cp .env.example .env

# Llenar .env con tus credenciales
nano .env

# Desarrollo
npm run dev

# Build para producción
npm run build

# Ejecutar en producción
npm start

# Tests de endpoints
ts-node test.ts


📞 EVENTOS DE WEBHOOK DE PAYPAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Event Type                           Acción
────────────────────────────────────────────────────────────────
BILLING.SUBSCRIPTION.ACTIVATED       ✅ Activa premium del usuario
BILLING.SUBSCRIPTION.CANCELLED       ❌ Desactiva premium
BILLING.SUBSCRIPTION.SUSPENDED       ⏸️  Pausa premium temporal
BILLING.SUBSCRIPTION.RE_ACTIVATED    ▶️  Reactiva desde pausa
PAYMENT.BILLING.SUBSCRIPTION...      💔 Pago fallido
  PAYMENT.FAILED


✨ CARACTERÍSTICAS COMPLETAMENTE IMPLEMENTADAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Integración completa con PayPal Subscriptions API
✅ Webhooks seguros con verificación de firma
✅ Bot de Telegram con comandos
✅ Base de datos relacional (SQLite)
✅ Página de checkout responsive con HTML/CSS
✅ Notificaciones automáticas en Telegram
✅ Gestión de suscripciones (crear, activar, cancelar, suspender)
✅ Middleware de autenticación
✅ Manejo de errores completo
✅ Logs detallados
✅ TypeScript con tipos seguros
✅ NestJS con inyección de dependencias


🔐 SEGURIDAD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Verificación de firma de webhooks de PayPal
✓ Verificación de permisos (solo propietario puede cancelar)
✓ Uso de Bearer tokens para API
✓ custom_id para vincular Telegram con PayPal
✓ Timestamps en todas las operaciones
✓ Validación de entrada en endpoints


📈 PRÓXIMAS MEJORAS POSIBLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

□ Dashboard de administración (ver usuarios y ingresos)
□ Múltiples planes (Starter, Pro, Enterprise)
□ Cupones y descuentos
□ Upgrade/Downgrade de planes
□ Facturas y recibos automáticos
□ Analytics y reportes
□ Integración con base de datos PostgreSQL
□ Webhook retries automáticos
□ Rate limiting
□ Caché de datos


📖 DOCUMENTACIÓN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📄 README.md              - Documentación completa del proyecto
📄 INTEGRATION_GUIDE.md   - Guía paso a paso de setup
📄 EXAMPLES.ts           - Ejemplos de código para usar los servicios
📄 SETUP.md              - Este archivo


═══════════════════════════════════════════════════════════════════════════════

¡El proyecto está completamente listo para usar! 🎉

Comienza por:
1. Leer INTEGRATION_GUIDE.md para setup
2. Llenar el .env con tus credenciales
3. Ejecutar: npm install && npm run dev
4. Testear con: ts-node test.ts

═══════════════════════════════════════════════════════════════════════════════
