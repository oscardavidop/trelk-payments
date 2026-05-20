import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  Req,
  Logger,
} from '@nestjs/common';
import { SubscriptionService } from '../subscription/subscription.service';
import { PaypalService } from './paypal.service';
import { LoggerService } from '../common/logger.service';
import { AttachSubscriptionDto } from './dto/attach-subscription.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { ReviseSubscriptionDto } from './dto/revise-subscription.dto';
import { ResumeSubscriptionDto } from './dto/resume-subscription.dto';
import { PaypalWebhookProducer } from '../queues/paypal-webhook.producer';
import { RedisService } from '../redis/redis.service';
import { WEBHOOK_DONE_PREFIX } from '../queues/paypal-webhook.types';

// ── Ventana de tolerancia para timestamps de PayPal ────────────────────────
// PayPal puede entregar webhooks con cierto retraso; 5 minutos es razonable.
// Esto previene replay attacks con webhooks viejos capturados.
const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1_000;

@Controller('paypal')
export class PaypalController {
  private readonly logger = new Logger(PaypalController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly paypalService: PaypalService,
    private readonly producer: PaypalWebhookProducer,
    private readonly redisService: RedisService,
    private readonly loggerService: LoggerService,
  ) {}

  /**
   * Webhook de PayPal — endpoint HTTP delgado.
   *
   * Responsabilidades del API (síncrono, <50ms):
   * 1. Validar timestamp → previene replay attacks
   * 2. Verificar firma criptográfica → previene spoofing
   * 3. Verificar idempotencia Redis → evita re-encolar eventos ya procesados
   * 4. Encolar job en BullMQ → responder 200 inmediatamente
   *
   * El procesamiento real (activar suscripciones, notificar Telegram, etc.)
   * ocurre de forma asíncrona en el proceso Worker separado.
   * Esto garantiza que PayPal recibe ACK en <5s incluso si hay lentitud en DB.
   */
  @Post('events')
  async webhook(@Body() body: any, @Req() req: any) {
    const eventId: string = body?.id;
    const eventType: string = body?.event_type;
    const correlationId = req.headers['paypal-transmission-id'] ?? eventId ?? 'unknown';

    // ── 0. Validación básica del payload ─────────────────────────────────────
    if (!eventId || !eventType || !body.resource) {
      this.logger.warn(`[${correlationId}] Malformed webhook payload rejected`);
      return { status: 'rejected', reason: 'malformed_payload' };
    }

    // ── 1. Validación de timestamp (anti-replay) ──────────────────────────────
    const transmissionTime = req.headers['paypal-transmission-time'] as string;
    if (transmissionTime) {
      const eventTs = new Date(transmissionTime).getTime();
      const now = Date.now();
      if (isNaN(eventTs) || Math.abs(now - eventTs) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
        this.logger.warn(`[${correlationId}] Webhook timestamp out of window: ${transmissionTime}`);
        return { status: 'rejected', reason: 'timestamp_out_of_window' };
      }
    }

    // ── 2. Verificación criptográfica de firma ────────────────────────────────
    const webhookId = this.requireEnv('PAYPAL_WEBHOOK_ID');
    let isValid: boolean;
    try {
      isValid = await this.paypalService.verifyWebhookSignature(webhookId, req);
    } catch (err: any) {
      this.logger.error(`[${correlationId}] Signature verification error: ${err?.message}`);
      return { status: 'error', reason: 'signature_verification_failed' };
    }

    if (!isValid) {
      // Log de seguridad: firma inválida — posible intento de spoofing
      this.logger.warn(
        `[${correlationId}] Invalid PayPal webhook signature — rejected ` +
          `[eventType=${eventType}, eventId=${eventId}]`,
      );
      return { status: 'rejected', reason: 'invalid_signature' };
    }

    // ── 3. Idempotencia Redis (fast path) ─────────────────────────────────────
    // Evita re-encolar eventos que el Worker ya procesó exitosamente.
    // El Worker setea esta clave (TTL 24h) cuando completa el job.
    const doneKey = `${WEBHOOK_DONE_PREFIX}${eventId}`;
    const alreadyDone = await this.redisService.get(doneKey);
    if (alreadyDone) {
      this.logger.log(`[${correlationId}] Webhook already processed (Redis) — skipping`);
      return { status: 'already_processed', event_id: eventId };
    }

    // ── 4. Encolar en BullMQ y responder 200 inmediatamente ───────────────────
    // BullMQ usa jobId=eventId para deduplicación: si el job ya está en cola
    // (being processed), rechaza silenciosamente el duplicado.
    try {
      const jobId = await this.producer.enqueueWebhook({
        eventId,
        eventType,
        resource: body.resource,
        correlationId,
        receivedAt: new Date().toISOString(),
      });

      this.logger.log(
        `[${correlationId}] Webhook enqueued [jobId=${jobId}, eventType=${eventType}]`,
      );
      return { status: 'queued', event_id: eventId, job_id: jobId };
    } catch (err: any) {
      this.logger.error(`[${correlationId}] Failed to enqueue webhook: ${err?.message}`);
      // Devolver 500: PayPal reintentará con backoff exponencial
      throw new HttpException('Failed to queue webhook for processing', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Asocia una suscripción a un usuario de Telegram.
   * Requiere API key interna. Solo para uso server-to-server.
   *
   * FIX A-3/A-4: Ahora usa DTO tipado con class-validator.
   */
  @Post('subscription/attach')
  async attachSubscription(
    @Body() body: AttachSubscriptionDto,
    @Req() req: any,
  ) {
    // Autenticación por API key interna (timing-safe comparison)
    const authorization = req.headers['authorization'] as string | undefined;
    const expectedKey = `Bearer ${this.requireEnv('EXTERNAL_API_KEY')}`;
    if (!this.timingSafeEqual(authorization ?? '', expectedKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    return this.subscriptionService.attachUser(
      body.subscription_id,
      String(body.tg_id),
    );
  }

  /**
   * Verifica el estado premium de un usuario.
   * GET /paypal/status?tg_id=123
   *
   * NOTA: Endpoint público. No exponer datos sensibles.
   */
  @Get('status')
  async status(@Query('tg_id') telegramId: string) {
    if (!telegramId) {
      throw new BadRequestException('tg_id is required');
    }
    const parsedTgId = parseInt(telegramId, 10);
    if (isNaN(parsedTgId) || parsedTgId <= 0) {
      throw new BadRequestException('tg_id must be a positive integer');
    }

    try {
      const isPremium = await this.subscriptionService.getUserPremiumStatus(parsedTgId);
      const subscriptions = await this.subscriptionService.getUserActiveSubscriptions(parsedTgId);

      return {
        telegramId: parsedTgId,
        isPremium,
        activeSubscriptions: subscriptions.length,
        subscriptions: subscriptions.map((sub) => ({
          id: sub.id,
          status: sub.status,
          // No exponer amount/currency si no es necesario para el consumidor
          createdAt: sub.createdAt,
        })),
      };
    } catch {
      throw new HttpException(
        'Failed to get subscription status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Cancela una suscripción.
   * POST /paypal/cancel
   *
   * FIX C-3: Restaurado el ownership check que estaba comentado.
   * FIX C-8: Este endpoint NO debería ser público. Requiere API key interna.
   * En producción real, debería requerir JWT del usuario.
   *
   * FIX A-3/A-4: Usa DTO tipado.
   */
  @Post('cancel')
  async cancel(@Body() body: CancelSubscriptionDto, @Req() req: any) {
    // Autenticación mínima (reemplazar por JWT en producción)
    const authorization = req.headers['authorization'] as string | undefined;
    const expectedKey = `Bearer ${this.requireEnv('EXTERNAL_API_KEY')}`;
    if (!this.timingSafeEqual(authorization ?? '', expectedKey)) {
      throw new UnauthorizedException('Unauthorized');
    }

    const subscription = await this.subscriptionService.getSubscriptionByPaypalId(
      body.subscription_id,
    );

    if (!subscription) {
      throw new BadRequestException('Subscription not found');
    }

    // FIX C-3: Verificar que el usuario es propietario de la suscripción
    if (!subscription.user_id || subscription.user_id !== String(body.tg_id)) {
      this.logger.warn(
        `Cancel attempt by non-owner: tg_id=${body.tg_id}, subscription owner=${subscription.user_id}`,
      );
      throw new UnauthorizedException('You do not own this subscription');
    }

    try {
      await this.paypalService.cancelSubscription(body.subscription_id);
      await this.subscriptionService.cancelSubscription(body.subscription_id);
      return { status: 'cancelled' };
    } catch (error: any) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new HttpException(
        'Failed to cancel subscription',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PLANES DISPONIBLES (público — sin datos sensibles)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lista los planes activos almacenados en MongoDB.
   * GET /paypal/plans
   *
   * Endpoint público: solo devuelve name, plan_id y precio.
   * NO expone IDs internos de Mongo, features completas, ni metadata sensible.
   */
  @Get('plans')
  async listPlans() {
    const plans = await this.subscriptionService.listActivePlans();
    return { ok: true, plans };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ESTADO DE SUSCRIPCIÓN DEL USUARIO (server-to-server)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Devuelve el estado completo de suscripción de un usuario.
   * GET /paypal/user-status?tg_id=...
   *
   * Protegido por API key interna. La mini app usa este endpoint para
   * mostrar el estado real con próximo cobro, amount, etc.
   */
  @Get('user-status')
  async userSubscriptionStatus(@Query('tg_id') tgIdRaw: string, @Req() req: any) {
    const authorization = req.headers['authorization'] as string | undefined;
    const expectedKey = `Bearer ${this.requireEnv('EXTERNAL_API_KEY')}`;
    if (!this.timingSafeEqual(authorization ?? '', expectedKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    const tgId = parseInt(tgIdRaw, 10);
    if (isNaN(tgId) || tgId <= 0) {
      throw new BadRequestException('tg_id must be a positive integer');
    }

    const result = await this.subscriptionService.getUserSubscriptionStatus(tgId);
    return { ok: true, ...result };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CREAR SUSCRIPCIÓN (server-to-server)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Inicia el flujo de nueva suscripción PayPal.
   * POST /paypal/subscription/create
   *
   * Flujo:
   * 1. Valida que el plan_id exista en nuestra DB (evita plan spoofing)
   * 2. Verifica que el usuario no tenga ya una suscripción activa
   * 3. Crea la suscripción en PayPal (status: APPROVAL_PENDING)
   * 4. Pre-registra en DB para correlacionar el webhook entrante
   * 5. Devuelve subscriptionId + approvalUrl para redirigir al usuario
   */
  @Post('subscription/create')
  async createSubscription(@Body() body: CreateSubscriptionDto, @Req() req: any) {
    const authorization = req.headers['authorization'] as string | undefined;
    const expectedKey = `Bearer ${this.requireEnv('EXTERNAL_API_KEY')}`;
    if (!this.timingSafeEqual(authorization ?? '', expectedKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Validar que el plan existe en nuestra DB (anti-spoofing)
    const plans = await this.subscriptionService.listActivePlans();
    const planExists = plans.some((p) => p.plan_id === body.plan_id);
    if (!planExists) {
      throw new BadRequestException(`Plan ${body.plan_id} not found or inactive`);
    }

    // Verificar que no hay suscripción activa o pendiente (evita duplicados)
    const currentStatus = await this.subscriptionService.getUserSubscriptionStatus(body.tg_id);
    if (currentStatus.status === 'ACTIVE' || currentStatus.status === 'PENDING') {
      throw new BadRequestException(
        `User already has a ${currentStatus.status.toLowerCase()} subscription. Use /revise to change plan.`,
      );
    }

    try {
      const { subscriptionId, approvalUrl } = await this.paypalService.createSubscriptionLink(
        body.plan_id,
        body.return_url,
        body.cancel_url,
        String(body.tg_id),
      );

      // Pre-registrar en DB para que el webhook pueda correlacionarla
      await this.subscriptionService.createSubscriptionIfNotExists({
        paypal_subscription_id: subscriptionId,
        plan_id: body.plan_id,
        user_id: String(body.tg_id),
        status: 'APPROVAL_PENDING',
        features_applied: false,
        activation_notified: false,
      });

      this.logger.log(
        `Subscription created for user ${body.tg_id}: ${subscriptionId} (plan: ${body.plan_id})`,
      );

      return { ok: true, subscriptionId, approvalUrl };
    } catch (error: any) {
      console.error(error);
      if (error instanceof BadRequestException || error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`Failed to create subscription for user ${body.tg_id}: ${error?.message}`);
      throw new HttpException('Failed to create subscription', HttpStatus.BAD_GATEWAY);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REVISAR PLAN (upgrade / downgrade) — server-to-server
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Cambia el plan de una suscripción activa mediante la API de revisión de PayPal.
   * POST /paypal/subscription/revise
   *
   * PayPal requiere que el suscriptor apruebe la revisión vía browser.
   * Devuelve `approvalUrl` al que redirigir al usuario.
   * Tras la aprobación, PayPal dispara el webhook BILLING.SUBSCRIPTION.UPDATED.
   *
   * Estrategia:
   * - Upgrades y downgrades usan el mismo endpoint /revise de PayPal.
   * - El ciclo de facturación y prorratas los maneja PayPal automáticamente.
   */
  @Post('subscription/revise')
  async reviseSubscription(@Body() body: ReviseSubscriptionDto, @Req() req: any) {
    const authorization = req.headers['authorization'] as string | undefined;
    const expectedKey = `Bearer ${this.requireEnv('EXTERNAL_API_KEY')}`;
    if (!this.timingSafeEqual(authorization ?? '', expectedKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Validar ownership: la suscripción debe pertenecer al usuario
    const subscription = await this.subscriptionService.getSubscriptionByPaypalId(
      body.subscription_id,
    );
    if (!subscription) {
      throw new BadRequestException('Subscription not found');
    }
    if (subscription.user_id !== String(body.tg_id)) {
      this.logger.warn(
        `Revise attempt by non-owner: tg_id=${body.tg_id}, owner=${subscription.user_id}`,
      );
      throw new UnauthorizedException('You do not own this subscription');
    }

    // Solo se puede revisar si está en estado válido
    const revisableStatuses = ['ACTIVE', 'SUSPENDED'];
    if (!revisableStatuses.includes(subscription.status)) {
      throw new BadRequestException(
        `Cannot revise a subscription in ${subscription.status} status`,
      );
    }

    // Validar nuevo plan en DB
    const plans = await this.subscriptionService.listActivePlans();
    const newPlanExists = plans.some((p) => p.plan_id === body.new_plan_id);
    if (!newPlanExists) {
      throw new BadRequestException(`Plan ${body.new_plan_id} not found or inactive`);
    }

    // Evitar revisión innecesaria al mismo plan
    if (subscription.plan_id === body.new_plan_id) {
      throw new BadRequestException('Subscription is already on this plan');
    }

    try {
      const { approvalUrl } = await this.paypalService.reviseSubscriptionPlan(
        body.subscription_id,
        body.new_plan_id,
        body.return_url,
        body.cancel_url,
      );

      this.logger.log(
        `Subscription revise initiated: ${body.subscription_id} → plan ${body.new_plan_id} (user ${body.tg_id})`,
      );

      return {
        ok: true,
        approvalUrl: approvalUrl ?? null,
        requiresApproval: approvalUrl !== null,
      };
    } catch (error: any) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      this.logger.error(`Failed to revise subscription ${body.subscription_id}: ${error?.message}`);
      throw new HttpException('Failed to revise subscription', HttpStatus.BAD_GATEWAY);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REANUDAR SUSCRIPCIÓN SUSPENDIDA — server-to-server
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Reactiva una suscripción suspendida.
   * POST /paypal/subscription/resume
   *
   * Solo funciona si la suscripción está en SUSPENDED.
   * Llama a PayPal activate + actualiza DB.
   */
  @Post('subscription/resume')
  async resumeSubscription(@Body() body: ResumeSubscriptionDto, @Req() req: any) {
    const authorization = req.headers['authorization'] as string | undefined;
    const expectedKey = `Bearer ${this.requireEnv('EXTERNAL_API_KEY')}`;
    if (!this.timingSafeEqual(authorization ?? '', expectedKey)) {
      throw new UnauthorizedException('Invalid API key');
    }

    const subscription = await this.subscriptionService.getSubscriptionByPaypalId(
      body.subscription_id,
    );
    if (!subscription) {
      throw new BadRequestException('Subscription not found');
    }
    if (subscription.user_id !== String(body.tg_id)) {
      this.logger.warn(
        `Resume attempt by non-owner: tg_id=${body.tg_id}, owner=${subscription.user_id}`,
      );
      throw new UnauthorizedException('You do not own this subscription');
    }

    if (subscription.status !== 'SUSPENDED') {
      throw new BadRequestException(
        `Cannot resume a subscription in ${subscription.status} status`,
      );
    }

    try {
      await this.paypalService.activateSubscription(body.subscription_id);
      await this.subscriptionService.resumeSubscription(body.subscription_id);

      this.logger.log(`Subscription resumed: ${body.subscription_id} (user ${body.tg_id})`);
      return { ok: true, status: 'resumed' };
    } catch (error: any) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      this.logger.error(`Failed to resume subscription ${body.subscription_id}: ${error?.message}`);
      throw new HttpException('Failed to resume subscription', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Comparación en tiempo constante de strings para prevenir timing attacks.
   * No usar === para comparar secrets/tokens.
   */
  private timingSafeEqual(a: string, b: string): boolean {
    const { timingSafeEqual: cryptoEqual } = require('crypto');
    if (a.length !== b.length) return false;
    try {
      return cryptoEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }

  private requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) throw new Error(`Missing required environment variable ${key}`);
    return value;
  }
}
