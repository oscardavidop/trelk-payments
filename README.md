# Trelk Payments

![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?style=flat-square&logo=nestjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript)
![PayPal](https://img.shields.io/badge/PayPal-Subscriptions-003087?style=flat-square&logo=paypal)
![BullMQ](https://img.shields.io/badge/BullMQ-5-red?style=flat-square)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis)
![MongoDB](https://img.shields.io/badge/MongoDB-8-47A248?style=flat-square&logo=mongodb)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

Payment microservice for the Trelk ecosystem. Manages the complete lifecycle of PayPal subscriptions — from checkout to automatic reconciliation — with decoupled workers and Telegram notifications.

---

## 🧠 What problem does it solve?

Trelk needs to charge recurring subscriptions to Telegram users without manual intervention. This service centralizes:

- Creation and activation of PayPal plans from code
- Reception and verification of PayPal webhooks with HMAC signature
- Subscription state synchronization in MongoDB
- Automatic user notifications via Telegram (activation, failure, cancellation)
- Periodic reconciliation of divergent states (cron job)
- Separate worker for asynchronous payment event processing

---

## ⚙️ Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Framework | NestJS 10 + Express | Structured DI, modular, testable |
| Language | TypeScript 5 | Type safety across layers |
| Payments | PayPal Server SDK v2 | Official Subscriptions API |
| Database | MongoDB 8 + Mongoose | Flexible transaction history |
| Queues | BullMQ 5 + Redis 7 | Decoupled worker, automatic retries |
| Notifications | Telegram Bot API | Direct communication with end user |
| Rate limiting | @nestjs/throttler | Public endpoint protection |
| Queue dashboard | Bull Board | Job monitoring at `/queues` |
| Infrastructure | Docker + PM2 | Containers or bare-metal clustering |

---

## 🏗 Architecture

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
│         │         │   (daily cron)     ││
│         │         └────────────────────┘│
└─────────┼────────────────────────────────┘
          │ BullMQ jobs
┌─────────▼────────────────────────────────┐
│        Worker Process (worker.ts)        │
│   Processes payment events in background │
└─────────┬────────────────────────────────┘
          │
┌─────────▼──────────┐   ┌─────────────────┐
│     MongoDB        │   │  Telegram Bot   │
│  (subscriptions,   │   │  (send           │
│   transactions)    │   │   notifications) │
└────────────────────┘   └─────────────────┘
```

---

## 🔥 Features

- **Verified PayPal webhook** — HMAC signature validation before processing any event
- **Decoupled worker** — separate process consumes BullMQ queue; API never blocks on payments
- **Automatic reconciliation** — daily cron detects and fixes subscriptions with divergent state between PayPal and MongoDB
- **Telegram notifications** — user receives immediate confirmation of activation, failure, or cancellation
- **Bull Board** — dashboard at `/queues` to monitor active, failed, and completed jobs
- **Rate limiting** — per-IP throttling on all public endpoints
- **Helmet** — HTTP security headers in production
- **Horizontal scaling** — workers scalable with `docker compose scale worker=N` or `pm2 cluster mode`

---

## 🧪 How to run

### Docker (recommended)

```bash
cp .env.example .env
# Edit .env with real PayPal and Telegram credentials

# Development
docker compose -f docker-compose.dev.yml up

# Production
docker compose -f docker-compose.prod.yml up -d

# Scale workers
docker compose -f docker-compose.prod.yml scale worker=4
```

### Local

```bash
npm install
cp .env.example .env

# API + Worker in parallel (with hot reload)
npm run dev:all

# API only
npm run dev

# Worker only
npm run dev:worker
```

### PM2 (bare-metal production)

```bash
npm run build
npm run pm2:start
npm run pm2:monit
```

---

## 🔑 Environment variables

| Variable | Description | Required |
|---|---|---|
| `NODE_ENV` | `development` / `production` | ✅ |
| `PORT` | API port (default: 3001) | — |
| `PAYPAL_MODE` | `sandbox` / `live` | ✅ |
| `PAYPAL_CLIENT_ID` | Client ID from PayPal app | ✅ |
| `PAYPAL_CLIENT_SECRET` | Client secret from PayPal app | ✅ |
| `PAYPAL_PLAN_ID` | Subscription plan ID | ✅ |
| `PAYPAL_WEBHOOK_ID` | Webhook ID registered in PayPal | ✅ |
| `TELEGRAM_BOT_TOKEN` | Notification bot token | ✅ |
| `MONGODB_URI_PAYMENTS` | MongoDB connection URI (payments) | ✅ |
| `MONGODB_URI_MBOTS` | MongoDB connection URI (users) | ✅ |
| `REDIS_URL` | Redis URL for BullMQ | ✅ |
| `REDIS_PASSWORD` | Redis password (production) | — |
| `EXTERNAL_API_KEY` | API key for internal endpoints | ✅ |
| `BASE_URL` | Public service URL | ✅ |
| `ALLOWED_ORIGINS` | Allowed CORS origins | ✅ |
| `BULL_BOARD_ENABLED` | Enable queue dashboard | — |
| `BULL_BOARD_USERNAME` | Dashboard username | — |
| `BULL_BOARD_PASSWORD` | Dashboard password | — |

See `.env.example` for the complete list.

---

## 🧠 Technical decisions

**API + Worker as separate processes** — the worker process consumes the BullMQ queue independently. If the worker fails, the API continues running; jobs are automatically re-queued with exponential backoff.

**BullMQ over synchronous PayPal calls** — PayPal webhooks must respond in < 5s or PayPal retries. By queuing the actual processing in BullMQ the API responds 200 immediately and the worker processes without pressure.

**Daily reconciliation** — PayPal may send events out of order or duplicated. The reconciliation cron queries the Subscriptions API directly and fixes any divergent state in MongoDB.

**MongoDB over SQL** — transaction history and subscription metadata are semi-structured documents (vary by event type). MongoDB avoids schema migrations on PayPal payload changes.

---

## 📄 License

MIT © Trelk

