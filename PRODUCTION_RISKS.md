# ⚠️ RIESGOS ACTUALES Y RECOMENDACIONES

## 🔴 RIESGOS CRÍTICOS (Requieren atención antes de producción)

### **1. Sin Transacciones MongoDB**
**Riesgo**: Si `user.save()` falla después de marcar `features_applied = true`, queda inconsistencia.

**Escenario**:
```typescript
subscription.features_applied = true;
await subscription.save(); // ✅ OK

user.pro_features = { ... };
await user.save(); // ❌ FALLA (red, memoria, etc.)

// Resultado: Subscription marcada como aplicada, pero user sin features
```

**Solución**: MongoDB Transactions
```typescript
const session = await this.connection.startSession();
await session.withTransaction(async () => {
  await subscription.save({ session });
  await user.save({ session });
});
```

**Mitigación actual**: Rollback manual en catch block (implementado)

---

### **2. Sin Rate Limiting**
**Riesgo**: Alguien puede spamear endpoints públicos.

**Endpoints vulnerables**:
- `/paypal/events` (webhook público)
- `/paypal/status`
- `/paypal/cancel`

**Solución**:
```bash
npm install @nestjs/throttler
```

```typescript
@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 10, // 10 requests por minuto
    }),
  ],
})

@UseGuards(ThrottlerGuard)
@Post('events')
async webhook() { ... }
```

---

### **3. Sin Validación de Input (DTOs)**
**Riesgo**: Acepta payloads maliciosos o malformados.

**Problema**:
```typescript
@Post('subscription/attach')
async attachSubscription(@Body() body: any) { // ❌ any
  // No valida que tg_id sea número
  // No valida formato de subscription_id
}
```

**Solución**:
```typescript
class AttachSubscriptionDto {
  @IsNumber()
  @IsPositive()
  tg_id: number;

  @IsString()
  @Matches(/^I-[A-Z0-9]+$/)
  subscription_id: string;
}

@Post('subscription/attach')
async attachSubscription(@Body() dto: AttachSubscriptionDto) { ... }
```

---

## 🟠 RIESGOS ALTOS (Antes de escalar)

### **4. Sin Retry Automático**
**Riesgo**: Si Telegram API falla temporalmente, se pierde la notificación.

**Solución**: Bull Queue
```bash
npm install @nestjs/bull bull
```

```typescript
@InjectQueue('notifications')
private notificationQueue: Queue;

await this.notificationQueue.add('send-message', {
  chatId: userId,
  text: 'Tu suscripción ha sido activada',
}, {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
});
```

---

### **5. Sin Monitoring**
**Riesgo**: No sabes si hay errores en producción hasta que los usuarios reportan.

**Solución**: Sentry
```bash
npm install @sentry/node
```

```typescript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

---

### **6. Sin Health Checks**
**Riesgo**: Load balancer no sabe si la app está saludable.

**Solución**:
```bash
npm install @nestjs/terminus
```

```typescript
@Get('health')
@HealthCheck()
check() {
  return this.health.check([
    () => this.db.pingCheck('database'),
    () => this.http.pingCheck('paypal', 'https://api.paypal.com'),
  ]);
}
```

---

## 🟡 RIESGOS MEDIOS (Mejoras de calidad)

### **7. Sin Tests**
**Riesgo**: Cambios futuros pueden romper funcionalidad sin que te des cuenta.

**Solución**: Jest + Supertest
```typescript
describe('SubscriptionService', () => {
  it('should prevent double activation', async () => {
    // Simular 2 webhooks concurrentes
    const [result1, result2] = await Promise.all([
      service.tryActivateFeatures('sub-123'),
      service.tryActivateFeatures('sub-123'),
    ]);

    // Solo uno debe activar
    const user = await userModel.findOne({ id: 123 });
    expect(user.is_pro).toBe(true);
    
    // Verificar que se envió solo 1 mensaje
    expect(telegramService.sendMessage).toHaveBeenCalledTimes(1);
  });
});
```

---

### **8. Logs en `console.log`**
**Riesgo**: En producción, los logs se pierden o son difíciles de filtrar.

**Solución**: Winston / Pino
```bash
npm install nest-winston winston
```

```typescript
private readonly logger = new Logger(SubscriptionService.name);

this.logger.log('Features activated', { userId, subscriptionId, plan });
this.logger.error('Failed to activate features', error.stack);
```

---

### **9. Sin Variables de Entorno Validadas**
**Riesgo**: App arranca sin credenciales y falla en runtime.

**Solución**: `@nestjs/config` + Joi
```typescript
@Module({
  imports: [
    ConfigModule.forRoot({
      validationSchema: Joi.object({
        PAYPAL_CLIENT_ID: Joi.string().required(),
        PAYPAL_CLIENT_SECRET: Joi.string().required(),
        MONGODB_URI: Joi.string().uri().required(),
      }),
    }),
  ],
})
```

---

## 🔵 RIESGOS BAJOS (Nice to have)

### **10. Sin CORS Configurado Correctamente**
**Actual**: `app.enableCors()` (acepta cualquier origin)

**Solución**:
```typescript
app.enableCors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
});
```

---

### **11. Sin Helmet (Seguridad Headers)**
**Solución**:
```bash
npm install @nestjs/helmet
```

```typescript
app.use(helmet());
```

---

### **12. Sin Swagger Documentation**
**Solución**:
```bash
npm install @nestjs/swagger
```

```typescript
const config = new DocumentBuilder()
  .setTitle('PayPal Subscriptions API')
  .setVersion('1.0')
  .build();

const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api', app, document);
```

---

## 📊 PRIORIZACIÓN RECOMENDADA

### **Fase 1: Antes de lanzar a producción**
1. ✅ Refactor (YA HECHO)
2. 🔴 MongoDB Transactions
3. 🔴 Rate Limiting
4. 🔴 Input Validation (DTOs)
5. 🟠 Monitoring (Sentry)
6. 🟠 Health Checks

### **Fase 2: Después del lanzamiento**
7. 🟠 Retry con Bull Queue
8. 🟡 Tests unitarios e integración
9. 🟡 Logger profesional (Winston)
10. 🟡 Validación de env vars

### **Fase 3: Optimizaciones**
11. 🔵 CORS restrictivo
12. 🔵 Helmet
13. 🔵 Swagger docs

---

## 🎯 CHECKLIST PRE-PRODUCCIÓN

- [ ] Variables de entorno en servidor (NO commitear `.env`)
- [ ] MongoDB en replica set (para transactions)
- [ ] Rate limiting activado
- [ ] Monitoring configurado
- [ ] Health check endpoint
- [ ] Backup automático de DB
- [ ] SSL/TLS en MongoDB connection
- [ ] Credenciales rotadas (no usar las de desarrollo)
- [ ] Logs centralizados (CloudWatch, Datadog, etc.)
- [ ] Alertas configuradas (errores críticos, webhook failures)

---

## 🚨 ESCENARIOS DE FALLO A TESTEAR

### **1. Webhook Duplicado**
```bash
# Enviar el mismo webhook 2 veces
curl -X POST http://localhost:3001/paypal/events \
  -d '{"id": "WH-123", "event_type": "BILLING.SUBSCRIPTION.ACTIVATED", ...}'

# Debe retornar: { status: 'already_processed' }
```

### **2. Attach Concurrente**
```javascript
// En Node.js
const [res1, res2] = await Promise.all([
  fetch('http://localhost:3001/paypal/subscription/attach', {
    method: 'POST',
    body: JSON.stringify({ tg_id: 123, subscription_id: 'I-XXX' }),
  }),
  fetch('http://localhost:3001/paypal/subscription/attach', {
    method: 'POST',
    body: JSON.stringify({ tg_id: 456, subscription_id: 'I-XXX' }),
  }),
]);

// Solo uno debe tener éxito, el otro debe retornar ConflictException
```

### **3. Webhook + Attach Simultáneo**
```javascript
// Simular webhook ACTIVATED y attachUser al mismo tiempo
await Promise.all([
  webhookActivated('I-XXX'),
  attachUser('I-XXX', '123'),
]);

// Features deben aplicarse solo UNA vez
// Usuario debe recibir solo UN mensaje
```

---

## 💡 CONSEJOS FINALES

1. **Siempre usa índices compuestos** para queries atómicos
2. **Logs estructurados** son clave para debugging en producción
3. **Idempotencia es más importante que performance**
4. **Falla rápido**: Valida inputs antes de hacer I/O
5. **Monitoring > Tests**: En producción, los usuarios son tus testers
6. **Retry con backoff exponencial**: No spamees servicios externos
7. **Circuit breaker pattern**: Si PayPal falla, no lo sigas llamando
8. **Feature flags**: Para desactivar features problemáticas sin deploy

---

## 📚 RECURSOS

- [MongoDB Transactions](https://www.mongodb.com/docs/manual/core/transactions/)
- [NestJS Best Practices](https://docs.nestjs.com/techniques/performance)
- [PayPal Webhook Best Practices](https://developer.paypal.com/docs/api-basics/notifications/webhooks/best-practices/)
- [Mongoose Performance](https://mongoosejs.com/docs/guide.html#indexes)
