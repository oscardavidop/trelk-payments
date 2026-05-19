# Trelk Payments

![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?style=flat-square&logo=nestjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)
![PayPal](https://img.shields.io/badge/PayPal-Subscriptions-003087?style=flat-square&logo=paypal)
![BullMQ](https://img.shields.io/badge/BullMQ-5-red?style=flat-square)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis)
![MongoDB](https://img.shields.io/badge/MongoDB-8-47A248?style=flat-square&logo=mongodb)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

Microservicio de pagos para el ecosistema Trelk. Gestiona el ciclo de vida completo de suscripciones PayPal — desde el checkout hasta la reconciliación automática — con workers desacoplados y notificaciones vía Telegram.

---

## 🧠 ¿Qué problema resuelve?

Trelk necesita cobrar suscripciones recurrentes a usuarios de Telegram sin intervención manual. Este servicio centraliza:

- Creación y activación de planes PayPal desde código
- Recepción y verificación de webhooks PayPal con firma HMAC
- Sincronización de estado de suscripción en MongoDB
- Notificaciones automáticas al usuario por Telegram (activación, fallo, cancelación)
- Reconciliación periódica de estados divergentes (cron job)
- Worker separado para procesamiento asíncrono de eventos de pago

---

## ⚙️ Tech Stack

| Capa | Tecnología | Por qué |
|---|---|---|
| Framework | NestJS 10 + Express | DI estructurado, modular, testeable |
| Lenguaje | TypeScript 5 | Type safety entre capas |
| Pagos | PayPal Server SDK v2 | Subscriptions API oficial |
| Base de datos | MongoDB 8 + Mongoose | Historial de transacciones flexible |
| Colas | BullMQ 5 + Redis 7 | Worker desacoplado, retries automáticos |
| Notificaciones | Telegram Bot API | Comunicación directa con el usuario final |
| Rate limiting | @nestjs/throttler | Protección de endpoints públicos |
| Dashboard colas | Bull Board | Monitoreo de jobs en `/queues` |
| Infra | Docker + PM2 | Contenedores o bare-metal con clustering |

---

## 🏗 Arquitectura

```
┌──────────────────────────────────────────┐
│           PayPal Webhooks                │
│  (BILLING.SUBSCRIPTION.* events)        │
└──────────────┬───────────────────────────┘
               │ POST /paypal/webhook (HMAC verified)
┌──────────────▼───────────────────────────┐
│         NestJS API (port 3001)           │
│                                          │
│  ┌─────────────┐  ┌────────────────────┐│
│  │  PayPal     │  │   Subscription     ││
│  │  Module     │  │   Module           ││
│  │  (webhook + │  │  (CRUD + lifecycle) ││
│  │   checkout) │  └────────────────────┘│
│  └──────┬──────┘  ┌────────────────────┐│
│         │         │   Reconciliation   ││
│         │         │   (cron diario)    ││
│         │         └────────────────────┘│
└─────────┼────────────────────────────────┘
          │ BullMQ jobs
┌─────────▼────────────────────────────────┐
│        Worker Process (worker.ts)        │
│   Procesa eventos de pago en background  │
└─────────┬────────────────────────────────┘
          │
┌─────────▼──────────┐   ┌─────────────────┐
│     MongoDB        │   │  Telegram Bot   │
│  (subscriptions,   │   │  (notificaciones│
│   transactions)    │   │   al usuario)   │
└────────────────────┘   └─────────────────┘
```

---

## 🔥 Características

- **Webhook PayPal verificado** — validación de firma HMAC antes de procesar cualquier evento
- **Worker desacoplado** — proceso separado consume la cola BullMQ; la API nunca bloquea en pagos
- **Reconciliación automática** — cron job diario detecta y corrige suscripciones con estado divergente entre PayPal y MongoDB
- **Notificaciones Telegram** — el usuario recibe confirmación inmediata de activación, fallo o cancelación
- **Bull Board** — dashboard en `/queues` para monitorear jobs activos, fallidos y completados
- **Rate limiting** — throttling por IP en todos los endpoints públicos
- **Helmet** — security headers HTTP en producción
- **Escalado horizontal** — workers escalables con `docker compose scale worker=N` o `pm2 cluster mode`

---

## 🧪 Cómo ejecutar

### Docker (recomendado)

```bash
cp .env.example .env
# Editar .env con credenciales reales de PayPal y Telegram

# Desarrollo
docker compose -f docker-compose.dev.yml up

# Producción
docker compose -f docker-compose.prod.yml up -d

# Escalar workers
docker compose -f docker-compose.prod.yml scale worker=4
```

### Local

```bash
npm install
cp .env.example .env

# API + Worker en paralelo (con hot reload)
npm run dev:all

# Solo API
npm run dev

# Solo Worker
npm run dev:worker
```

### PM2 (bare-metal producción)

```bash
npm run build
npm run pm2:start
npm run pm2:monit
```

---

## 🔑 Variables de entorno

| Variable | Descripción | Requerida |
|---|---|---|
| `NODE_ENV` | `development` / `production` | ✅ |
| `PORT` | Puerto de la API (default: 3001) | — |
| `PAYPAL_MODE` | `sandbox` / `live` | ✅ |
| `PAYPAL_CLIENT_ID` | Client ID de la app PayPal | ✅ |
| `PAYPAL_CLIENT_SECRET` | Client secret de la app PayPal | ✅ |
| `PAYPAL_PLAN_ID` | ID del plan de suscripción | ✅ |
| `PAYPAL_WEBHOOK_ID` | ID del webhook registrado en PayPal | ✅ |
| `TELEGRAM_BOT_TOKEN` | Token del bot notificador | ✅ |
| `MONGODB_URI_PAYMENTS` | URI de conexión MongoDB (pagos) | ✅ |
| `MONGODB_URI_MBOTS` | URI de conexión MongoDB (usuarios) | ✅ |
| `REDIS_URL` | URL de Redis para BullMQ | ✅ |
| `REDIS_PASSWORD` | Contraseña Redis (producción) | — |
| `EXTERNAL_API_KEY` | API key para endpoints internos | ✅ |
| `BASE_URL` | URL pública del servicio | ✅ |
| `ALLOWED_ORIGINS` | Orígenes CORS permitidos | ✅ |
| `BULL_BOARD_ENABLED` | Activar dashboard de colas | — |
| `BULL_BOARD_USERNAME` | Usuario del dashboard | — |
| `BULL_BOARD_PASSWORD` | Contraseña del dashboard | — |

Ver `.env.example` para la lista completa.

---

## 🧠 Decisiones técnicas

**API + Worker como procesos separados** — el proceso worker consume la cola BullMQ de forma independiente. Si el worker falla, la API sigue funcionando; los jobs se re-encolan automáticamente con backoff exponencial.

**BullMQ sobre llamadas síncronas a PayPal** — los webhooks de PayPal deben responder en < 5s o PayPal reintenta. Encolando el procesamiento real en BullMQ la API responde 200 inmediatamente y el worker procesa sin presión.

**Reconciliación diaria** — PayPal puede enviar eventos fuera de orden o duplicados. El cron de reconciliación consulta directamente la Subscriptions API y corrige cualquier estado divergente en MongoDB.

**MongoDB sobre SQL** — el historial de transacciones y los metadatos de suscripción son documentos semi-estructurados (distintos por tipo de evento). MongoDB evita migraciones de esquema ante cambios en el payload de PayPal.

---

## 📄 Licencia

MIT © Trelk

