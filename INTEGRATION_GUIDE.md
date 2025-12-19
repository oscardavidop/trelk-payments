# 📖 Guía de Integración Paso a Paso

Esta guía te ayudará a integrar tu bot de Telegram existente con el sistema de PayPal Subscriptions.

## Paso 1: Setup Inicial

### 1.1 Clonar/Copiar proyecto

```bash
# Si estás en /home/trelkbot17, ya tienes la carpeta tg-paypal-bot
cd /home/trelkbot17/tg-paypal-bot
```

### 1.2 Instalar dependencias

```bash
npm install
```

### 1.3 Crear carpeta de datos

```bash
mkdir -p data
```

## Paso 2: Configurar PayPal

### 2.1 Obtener credenciales

1. **Crear App en PayPal Developer:**
   - Ir a https://developer.paypal.com/dashboard
   - Login (crear cuenta si no tienes)
   - Apps & Credentials → Create App
   - Copiar `Client ID` y `Client Secret`

2. **Seleccionar Sandbox:**
   - En el dropdown de arriba, asegurate que dice "Sandbox"

### 2.2 Crear Producto y Plan

**Opción A: Usando el script (recomendado)**

```bash
# Primero, agregar variables temporales
export PAYPAL_CLIENT_ID="YOUR_CLIENT_ID"
export PAYPAL_CLIENT_SECRET="YOUR_CLIENT_SECRET"
export PAYPAL_MODE="sandbox"

# Ejecutar script
bash scripts/create-paypal-plan.sh
```

El script mostrará tu `PAYPAL_PLAN_ID`.

**Opción B: Manual en Dashboard**

1. Ve a PayPal Dashboard → Products → Subscriptions
2. Click "Create plan"
3. Llenar:
   - Name: "Premium Bot Access"
   - Price: $10.00 USD
   - Billing frequency: Monthly
   - Click "Create"
4. Copiar el Plan ID

### 2.3 Crear Webhook

1. Ve a https://developer.paypal.com/dashboard
2. Tools → Webhooks
3. Click "Create webhook"
4. URL: `http://localhost:3001/paypal/webhook` (en desarrollo)
5. En producción será: `https://tu-dominio.com/paypal/webhook`
6. Seleccionar eventos:
   - ✓ BILLING.SUBSCRIPTION.ACTIVATED
   - ✓ BILLING.SUBSCRIPTION.CANCELLED
   - ✓ BILLING.SUBSCRIPTION.SUSPENDED
   - ✓ BILLING.SUBSCRIPTION.RE_ACTIVATED
   - ✓ PAYMENT.BILLING.SUBSCRIPTION.PAYMENT.FAILED
7. Click "Create"
8. Copiar el Webhook ID

## Paso 3: Configurar Telegram

### 3.1 Crear Bot

1. Abre Telegram y busca [@BotFather](https://t.me/botfather)
2. Escribe `/newbot`
3. Responde las preguntas:
   - Nombre del bot (ej: "Mi Bot Premium")
   - Username único (ej: "mi_bot_premium_bot")
4. BotFather te dará un `TOKEN`
5. Copiar el token

### 3.2 Configurar Bot

Opcional - para mejorar comandos:
```
/mybots → Seleccionar tu bot → Edit Commands
```

## Paso 4: Configurar Variables de Entorno

```bash
# Copiar template
cp .env.example .env

# Editar .env con tus valores
nano .env
```

Contenido de `.env`:

```env
# PayPal
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=AXxxxxxxx_xxxxxxx
PAYPAL_CLIENT_SECRET=EGxxxxxxx
PAYPAL_PLAN_ID=P-XXXXX
PAYPAL_WEBHOOK_ID=XXXXX

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABCdefGHIjklmnoPQRstuvWXYZ

# Server
PORT=3001
NODE_ENV=development
BASE_URL=http://localhost:3001

# Database
DATABASE_URL=sqlite:./data/app.db
```

## Paso 5: Ejecutar en Desarrollo

```bash
npm run dev
```

Deberías ver:
```
✅ Server running on http://localhost:3001
✅ Telegram bot started
🚀 Application started successfully
```

## Paso 6: Testear Flujo Completo

### 6.1 Obtener tu ID de Telegram

Busca [@userinfobot](https://t.me/userinfobot) y obtén tu ID de usuario.

### 6.2 Abrir página de suscripción

Reemplaza `YOUR_TELEGRAM_ID` con tu ID real:

```
http://localhost:3001/paypal/subscribe?tg_id=YOUR_TELEGRAM_ID
```

### 6.3 Hacer "pago" de prueba

En Sandbox:
- Usuario: `sb-xxxxx@personal.example.com`
- Contraseña: `12345678`

(Las credenciales las proporciona PayPal Sandbox)

### 6.4 Ver confirmación

Deberías:
1. Ver página "¡Suscripción Confirmada!"
2. Recibir un mensaje en Telegram (si está configurado correctamente)
3. Ver en base de datos una nueva suscripción

## Paso 7: Integrar con Bot Existente

Si ya tienes un bot de Telegram, aquí cómo añadirlo:

### 7.1 Usar la clase TelegramService

```typescript
import { TelegramService } from './telegram/telegram.service';

@Injectable()
export class MyBotService {
  constructor(private telegramService: TelegramService) {}

  async addPremiumButton(userId: number) {
    // Enviar botón de suscripción
    await this.telegramService.sendPremiumButton(null, userId);
  }

  async checkPremium(userId: number): Promise<boolean> {
    const bot = this.telegramService.getBot();
    // Usar el bot para verificar estado
    return await this.subscriptionService.getUserPremiumStatus(userId);
  }
}
```

### 7.2 Usar SubscriptionService en tus handlers

```typescript
import { SubscriptionService } from './subscription/subscription.service';

// En tu servicio del bot
constructor(private subscriptionService: SubscriptionService) {}

// En un handler
if (cmd === '/premium') {
  const isPremium = await this.subscriptionService.getUserPremiumStatus(userId);
  
  if (isPremium) {
    await ctx.reply('Ya eres premium ✨');
  } else {
    await ctx.reply('Hazte premium con /subscribe');
  }
}
```

## Paso 8: Deploy en Producción

### 8.1 Cambiar variables

```env
PAYPAL_MODE=live
BASE_URL=https://tu-dominio.com
NODE_ENV=production
TELEGRAM_BOT_TOKEN=xxx (verificar que sea válido)
```

### 8.2 Actualizar Webhook en PayPal

1. Ve a PayPal Developer → Webhooks
2. Edit webhook
3. Cambiar URL a: `https://tu-dominio.com/paypal/webhook`
4. Save

### 8.3 Compilar y ejecutar

```bash
npm run build
npm start
```

O con PM2:

```bash
pm2 start dist/main.js --name "tg-paypal-bot"
```

## Paso 9: Monitorear

### Ver logs

```bash
# Desarrollo
npm run dev

# Producción con PM2
pm2 logs tg-paypal-bot
```

### Ver webhooks en PayPal

1. Developer Dashboard → Webhooks
2. Click en el webhook
3. Ver "Recent Events"

### Ver base de datos

```bash
# Abrir SQLite CLI
sqlite3 data/app.db

# Ver usuarios
SELECT * FROM users;

# Ver suscripciones
SELECT * FROM subscriptions;
```

## 🔧 Troubleshooting

### Bot no responde en Telegram

**Verificar:**
```bash
curl https://api.telegram.org/botTOKEN_AQUI/getMe

# Debería devolver info del bot
```

### No aparece página de PayPal

**Verificar:**
- URL está correcta: `http://localhost:3001/paypal/subscribe?tg_id=123`
- Puerto 3001 está accesible: `curl http://localhost:3001`

### Error "PAYPAL_PLAN_ID is not defined"

**Solucionar:**
1. Verificar que `.env` existe en raíz
2. Verificar que tiene `PAYPAL_PLAN_ID=P-XXXXX`
3. Reiniciar servidor: `npm run dev`

### Webhook no funciona

**Verificar:**
1. URL pública correcta en PayPal
2. Firewall permite puerto 3001
3. PayPal puede alcanzar tu servidor: `curl -v https://tu-dominio.com/paypal/webhook`

## 📝 Próximos Pasos Avanzados

- [ ] Agregar más niveles de subscripción (Pro, Enterprise)
- [ ] Implementar descuentos y cupones
- [ ] Agregar dashboard de administración
- [ ] Exportar reportes de ingresos
- [ ] Integrar con analytics

---

¿Preguntas? Revisa [README.md](README.md) para más detalles.
