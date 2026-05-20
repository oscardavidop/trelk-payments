import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../database/schemas/user.schema';
import { Subscription } from '../database/schemas/subscription.schema';
import { PaypalService } from '../paypal/paypal.service';
import { TelegramService } from '../telegram/telegram.service';
import { Plan } from '../database/schemas/plan.schema';
import { LoggerService } from '../common/logger.service';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectModel(User.name, 'mbot')
    private userModel: Model<User>,
    @InjectModel(Subscription.name, 'payments')
    private subscriptionModel: Model<Subscription>,
    @InjectModel(Plan.name, 'payments')
    private planModel: Model<Plan>,
    private paypalService: PaypalService,
    private telegramService: TelegramService,
    private logger: LoggerService,
  ) { }

  /**
   * Obtiene o crea un usuario por telegram ID
   * FIX: Usa 'id' en lugar de 'telegramId' para consistencia con schema
   */
  async getOrCreateUser(telegramId: number, userData?: any): Promise<User> {
    let user = await this.userModel.findOne({ id: telegramId }).lean() as unknown as User;

    if (!user) {
      const newUser = new this.userModel({
        id: telegramId,
        telegramUsername: userData?.username,
        firstName: userData?.first_name,
        lastName: userData?.last_name,
        tier: 'free',
        isPremium: false,
        subscriptions: [],
      });

      user = await newUser.save();
      this.logger.info(`User created: ${telegramId}`);
    }

    return user;
  }

  /**
   * Obtiene un usuario por telegram ID
   */
  async getUserByTelegramId(telegramId: number): Promise<User | null> {
    return this.userModel.findOne({ id: telegramId }).lean() as unknown as User | null;
  }

  // ════════════════════════════════════════════════
  // PLANES DISPONIBLES
  // ════════════════════════════════════════════════

  /**
   * Devuelve los planes activos (sin datos internos sensibles).
   * Solo se exponen: name, plan_id, price y features públicas.
   */
  async listActivePlans(): Promise<Array<{
    name: string;
    plan_id: string;
    price: number;
    currency: string;
    displayName: string;
  }>> {
    const plans = await this.planModel
      .find({ active: true })
      .select('name plan_id price')
      .sort({ price: 1 })
      .lean()
      .exec();

    return (plans as any[]).map((p) => ({
      name: p.name,
      plan_id: p.plan_id,
      price: p.price ?? 0,
      currency: 'USD',
      displayName: (p.name as string).charAt(0).toUpperCase() + (p.name as string).slice(1),
    }));
  }

  // ════════════════════════════════════════════════
  // ESTADO DE SUSCRIPCIÓN DEL USUARIO
  // ════════════════════════════════════════════════

  /**
   * Devuelve el estado completo de suscripción de un usuario:
   * - suscripción activa/suspendida más reciente
   * - próxima fecha de cobro
   * - historial resumido (últimas 5 entradas)
   */
  async getUserSubscriptionStatus(telegramId: number): Promise<{
    status: 'FREE' | 'ACTIVE' | 'SUSPENDED' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED' | 'PENDING';
    subscription: any | null;
    isPremium: boolean;
  }> {
    const userId = String(telegramId);

    // Include CANCELLED with cancel_at_period_end (still active) in the query
    const subscription = await this.subscriptionModel
      .findOne({
        user_id: userId,
        $or: [
          { status: { $nin: ['CANCELLED', 'EXPIRED'] } },
          // Cancelled but period not yet ended → user still has access
          { status: 'CANCELLED', cancel_at_period_end: true },
        ],
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec() as any;

    if (!subscription) {
      const hadSubscription = await this.subscriptionModel.exists({ user_id: userId });
      return {
        status: hadSubscription !== null ? 'CANCELLED' : 'FREE',
        subscription: null,
        isPremium: false,
      };
    }

    const rawStatus = subscription.status as string;
    const statusMap: Record<string, 'ACTIVE' | 'SUSPENDED' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED' | 'PENDING'> = {
      ACTIVE: 'ACTIVE',
      SUSPENDED: 'SUSPENDED',
      APPROVAL_PENDING: 'PENDING',
      PENDING_ASSOCIATION: 'PENDING',
      CANCELLED: 'CANCELLED',
      EXPIRED: 'EXPIRED',
    };
    const mappedStatus = statusMap[rawStatus] ?? 'PENDING';

    // isPremium: true if ACTIVE, or if CANCELLED with deferred access still valid
    const cancelledWithAccess =
      rawStatus === 'CANCELLED' &&
      subscription.cancel_at_period_end === true &&
      subscription.next_billing_date &&
      new Date(subscription.next_billing_date).getTime() > Date.now();

    const isPremium = mappedStatus === 'ACTIVE' || cancelledWithAccess;

    return {
      status: mappedStatus,
      subscription: {
        id: subscription.paypal_subscription_id,
        plan_id: subscription.plan_id,
        status: subscription.status,
        next_billing_date: subscription.next_billing_date ?? null,
        amount: subscription.amount ?? null,
        currency: subscription.currency ?? 'USD',
        start_time: subscription.start_time ?? null,
        cancelled_at: subscription.cancelledAt ?? null,
        // New fields for deferred cancel + scheduled downgrade
        cancel_at_period_end: subscription.cancel_at_period_end ?? false,
        scheduled_plan_id: subscription.scheduled_plan_id ?? null,
      },
      isPremium,
    };
  }

  /**
   * Obtiene una suscripción por ID de PayPal
   * FIX: Query correcto con paypal_subscription_id
   */
  async getSubscriptionByPaypalId(paypalSubscriptionId: string): Promise<Subscription | null> {
    return this.subscriptionModel.findOne({ paypal_subscription_id: paypalSubscriptionId }).lean() as unknown as Subscription | null;
  }

  /**
   * Cancela una suscripción con lógica SaaS de cancelación diferida.
   *
   * CRITICAL UX RULE:
   * The user keeps access until the end of the already-paid billing period.
   * We do NOT revoke premium access immediately.
   *
   * Flow:
   * 1. Mark status = 'CANCELLED' (reflects PayPal state)
   * 2. Set cancel_at_period_end = true (if period hasn't ended yet)
   * 3. Keep user.is_pro = true, keep pro_features intact
   * 4. Send "Cancellation scheduled — access until X" notification
   * 5. Cron job (ReconciliationService) downgrades user when next_billing_date <= now
   *
   * For immediate revocation (refund, fraud): pass { immediate: true }
   */
  async cancelSubscription(
    subscriptionId: string,
    options: { immediate?: boolean } = {},
  ): Promise<void> {
    const subscription = await this.subscriptionModel
      .findOne({ paypal_subscription_id: subscriptionId })
      .lean() as unknown as Subscription;

    if (!subscription) {
      this.logger.warn(`Subscription not found: ${subscriptionId}`);
      return;
    }

    if (subscription.status === 'CANCELLED') {
      this.logger.info(`Subscription already cancelled: ${subscriptionId}`);
      return;
    }

    const periodEnd = (subscription as any).next_billing_date as Date | null;
    const periodAlreadyEnded =
      options.immediate ||
      !periodEnd ||
      new Date(periodEnd).getTime() <= Date.now();

    // Mark cancelled in DB — reflect PayPal's state
    await this.subscriptionModel.updateOne(
      { paypal_subscription_id: subscriptionId },
      {
        $set: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          // Deferred: keep access until period end
          cancel_at_period_end: !periodAlreadyEnded,
        },
      }
    );

    if (subscription.user_id) {
      const planName = (subscription as any).plan_name
        ?? (await this.planModel.findOne({ plan_id: subscription.plan_id }).lean() as any)?.name
        ?? 'premium';

      if (periodAlreadyEnded) {
        // Period already over → downgrade immediately
        this.logger.info(`Subscription period ended, downgrading immediately: ${subscriptionId}`);
        await this.expireSubscriptionAccess(subscriptionId, planName);
      } else {
        // Access continues — notify with access-until date
        await this.telegramService
          .notifyCancelScheduled(Number(subscription.user_id), {
            planName,
            accessUntil: periodEnd,
          })
          .catch((err) => this.logger.error('Failed to notify cancel scheduled', err));
      }
    }

    this.logger.info(
      `Subscription cancelled (deferred=${!periodAlreadyEnded}): ${subscriptionId}, access until: ${periodEnd ?? 'immediate'}`,
    );
  }

  /**
   * Expirara el acceso premium de una suscripción.
   * Llamado por: cron job (deferred cancel), BILLING.SUBSCRIPTION.EXPIRED webhook,
   * o cancelación inmediata (refund/fraud).
   *
   * Downgrades the user account to free tier.
   */
  async expireSubscriptionAccess(subscriptionId: string, planNameHint?: string): Promise<void> {
    const sub = await this.subscriptionModel
      .findOneAndUpdate(
        { paypal_subscription_id: subscriptionId },
        { $set: { cancel_at_period_end: false } },
        { new: false },
      )
      .lean() as unknown as Subscription;

    if (!sub?.user_id) {
      this.logger.info(`No user to downgrade for ${subscriptionId}`);
      return;
    }

    const user = await this.userModel.findOne({ id: Number(sub.user_id) });
    if (user) {
      user.is_pro = false;
      // Mark subscription sub-field as inactive (don't wipe pro_features entirely so
      // history is preserved)
      if ((user as any).pro_features?.subscription) {
        (user as any).pro_features.subscription.active = false;
        (user as any).pro_features.subscription.auto_renew = false;
      }
      await user.save();
      this.logger.info(`User ${sub.user_id} downgraded to free tier (sub: ${subscriptionId})`);
    }

    // Resolve plan name for notification
    const planName = planNameHint
      ?? (await this.planModel.findOne({ plan_id: sub.plan_id }).lean() as any)?.name
      ?? 'premium';

    await this.telegramService
      .notifyAccessExpired(Number(sub.user_id), { planName })
      .catch((err) => this.logger.error('Failed to notify access expired', err));
  }

  /**
   * Aplica un downgrade programado (scheduled_plan_id).
   * Llamado por ReconciliationService cron cuando next_billing_date <= now.
   */
  async applyScheduledDowngrade(subscriptionId: string): Promise<void> {
    // Atomically grab the scheduled plan and clear it
    const sub = await this.subscriptionModel.findOneAndUpdate(
      {
        paypal_subscription_id: subscriptionId,
        scheduled_plan_id: { $exists: true, $ne: null },
      },
      { $unset: { scheduled_plan_id: '' }, $set: { features_applied: false } },
      { new: false },
    ).lean() as unknown as Subscription;

    if (!sub) return;

    const newPlanId = (sub as any).scheduled_plan_id;
    if (!newPlanId) return;

    // Update plan_id to the confirmed downgrade plan
    await this.subscriptionModel.updateOne(
      { paypal_subscription_id: subscriptionId },
      { $set: { plan_id: newPlanId } },
    );

    // Apply new (lower) plan features
    await this.tryActivateFeatures(subscriptionId);

    this.logger.info(
      `Scheduled downgrade applied: ${subscriptionId} → plan ${newPlanId}`,
    );
  }

  /**
   * Suspende una suscripción
   * FIX: Query correcto y limpieza de código
   */
  async suspendSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionModel.findOneAndUpdate(
      { paypal_subscription_id: subscriptionId },
      { $set: { status: 'SUSPENDED' } },
      { new: true }
    );

    if (!subscription) {
      this.logger.warn(`Subscription not found for suspend: ${subscriptionId}`);
      return;
    }

    // Downgrade usuario temporalmente
    if (subscription.user_id) {
      await this.userModel.updateOne(
        { id: Number(subscription.user_id) },
        { $set: { is_pro: false } }
      );

      const planName = (subscription as any).plan_name
        ?? (await this.planModel.findOne({ plan_id: subscription.plan_id }).lean() as any)?.name
        ?? 'premium';

      await this.telegramService
        .notifySubscriptionSuspended(Number(subscription.user_id), { planName })
        .catch((err) => this.logger.error('Failed to notify suspension', err));
    }

    this.logger.info(`Subscription suspended: ${subscriptionId}`);
  }

  /**
   * Reanuda una suscripción
   * FIX: Validación con PayPal y actualización consistente
   */
  async resumeSubscription(subscriptionId: string): Promise<void> {
    // Validar con PayPal primero
    const paypalSub = await this.paypalService.getSubscription(subscriptionId);

    if (paypalSub.status !== 'ACTIVE') {
      this.logger.warn(`PayPal subscription not active: ${subscriptionId}, status: ${paypalSub.status}`);
      return;
    }

    const subscription = await this.subscriptionModel.findOneAndUpdate(
      { paypal_subscription_id: subscriptionId },
      { $set: { status: 'ACTIVE' } },
      { new: true }
    );

    if (!subscription) {
      this.logger.warn(`Subscription not found for resume: ${subscriptionId}`);
      return;
    }

    // Reactivar usuario
    if (subscription.user_id) {
      await this.userModel.updateOne(
        { id: Number(subscription.user_id) },
        { $set: { is_pro: true } }
      );

      const planName = (subscription as any).plan_name
        ?? (await this.planModel.findOne({ plan_id: subscription.plan_id }).lean() as any)?.name
        ?? 'premium';

      await this.telegramService
        .notifySubscriptionResumed(Number(subscription.user_id), {
          planName,
          nextBillingDate: (subscription as any).next_billing_date ?? null,
        })
        .catch((err) => this.logger.error('Failed to notify resume', err));
    }

    this.logger.info(`Subscription resumed: ${subscriptionId}`);
  }

  /**
   * Cancela un downgrade programado (el usuario quiere mantener su plan actual).
   * Borra scheduled_plan_id — el plan activo no cambia.
   * Llama a PayPal revise de vuelta al plan actual para cancelar la revisión pendiente.
   */
  async cancelScheduledDowngrade(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionModel
      .findOne({ paypal_subscription_id: subscriptionId })
      .lean() as unknown as Subscription;

    if (!subscription) {
      this.logger.warn(`Subscription not found for cancel downgrade: ${subscriptionId}`);
      return;
    }

    if (!(subscription as any).scheduled_plan_id) {
      this.logger.info(`No scheduled downgrade to cancel: ${subscriptionId}`);
      return;
    }

    // Clear the scheduled downgrade
    await this.subscriptionModel.updateOne(
      { paypal_subscription_id: subscriptionId },
      { $unset: { scheduled_plan_id: '' } },
    );

    this.logger.info(
      `Scheduled downgrade cancelled: ${subscriptionId} stays on ${subscription.plan_id}`,
    );
  }

  /**
   * Crea una nueva suscripción
   */
  async createSubscription(data: any): Promise<Subscription> {
    const subscription = new this.subscriptionModel(data);
    await subscription.save();
    return subscription;
  }

  /**
   * Crea o retorna suscripción existente (idempotente)
   */
  async createSubscriptionIfNotExists(data: any): Promise<Subscription> {
    let subscription = await this.subscriptionModel
      .findOne({ paypal_subscription_id: data.paypal_subscription_id })
      .lean() as unknown as Subscription;

    if (!subscription) {
      const newSub = new this.subscriptionModel(data);
      subscription = await newSub.save();
      this.logger.info(`Subscription created: ${data.paypal_subscription_id}`);
    }

    return subscription as Subscription;
  }

  /**
   * Actualiza o crea suscripción desde webhook
   * IDEMPOTENTE: Usa upsert con $setOnInsert
   */
  async updateFromWebhook(resource: any): Promise<Subscription | null> {
    if (!resource?.id) {
      this.logger.warn('Webhook without subscription id, ignored');
      return null;
    }

    const status = resource.status === 'ACTIVE' ? 'ACTIVE' : 'APPROVAL_PENDING';

    const subscription = await this.subscriptionModel.findOneAndUpdate(
      { paypal_subscription_id: resource.id },
      {
        $setOnInsert: {
          paypal_subscription_id: resource.id,
          plan_id: resource.plan_id,
          createdAt: new Date(),
        },
        $set: {
          start_time: resource.start_time,
          quantity: resource.quantity,
          status,
        },
      },
      {
        new: true,
        upsert: true,
      }
    );

    this.logger.info(`Subscription upserted from webhook: ${resource.id}, status: ${status}`);
    return subscription;
  }
  /**
   * Asocia una suscripción a un usuario (Telegram ID)
   * CRÍTICO: Operación ATÓMICA para prevenir race conditions
   * 
   * Flujo:
   * 1. Valida que el usuario exista
   * 2. Intenta asociar SOLO si no tiene user_id (previene doble attach)
   * 3. Si no existe en DB → la busca en PayPal, la registra y attach en la misma op
   * 4. Si ya está activa, intenta activar features automáticamente
   *
   * @throws ConflictException si ya está asociada a un usuario
   * @throws NotFoundException si el usuario no existe o PayPal no conoce el ID
   */
  async attachUser(
    paypalSubscriptionId: string,
    userId: string,
  ): Promise<Subscription> {
    // Validar que el usuario existe
    const user = await this.userModel.findOne({ id: Number(userId) }).lean() as unknown as User;
    if (!user) {
      throw new NotFoundException(`User not found: ${userId}`);
    }

    // Operación ATÓMICA: solo actualiza si NO tiene user_id
    let subscription = await this.subscriptionModel.findOneAndUpdate(
      {
        paypal_subscription_id: paypalSubscriptionId,
        user_id: { $exists: false }, // CRÍTICO: previene doble attach
      },
      {
        $set: { user_id: userId },
      },
      {
        new: true,
        upsert: false,
      }
    );

    if (!subscription) {
      // Verificar si ya estaba asociada
      const existing = await this.subscriptionModel
        .findOne({ paypal_subscription_id: paypalSubscriptionId })
        .lean() as unknown as Subscription;

      if (existing?.user_id) {
        throw new ConflictException(
          `Subscription ${paypalSubscriptionId} is already attached`,
        );
      }

      // No existe en DB → buscar en PayPal y registrarla con el attach incluido
      this.logger.warn(
        `Subscription ${paypalSubscriptionId} not in DB, fetching from PayPal…`,
      );

      let paypalData: any;
      try {
        paypalData = await this.paypalService.getSubscription(paypalSubscriptionId);
      } catch (err) {
        this.logger.error(
          `PayPal lookup failed for ${paypalSubscriptionId}`,
          err,
        );
        throw new NotFoundException(
          `Subscription ${paypalSubscriptionId} not found in DB or PayPal`,
        );
      }

      // Mapear estado PayPal → estado interno
      const VALID_STATUSES = [
        'APPROVAL_PENDING',
        'PENDING_ASSOCIATION',
        'ACTIVE',
        'SUSPENDED',
        'CANCELLED',
        'EXPIRED',
      ];
      const rawStatus: string = (paypalData.status ?? 'APPROVAL_PENDING').toUpperCase();
      const mappedStatus = VALID_STATUSES.includes(rawStatus)
        ? rawStatus
        : 'APPROVAL_PENDING';

      // Upsert: crea la suscripción con user_id ya adjunto (atómico)
      subscription = await this.subscriptionModel.findOneAndUpdate(
        { paypal_subscription_id: paypalSubscriptionId },
        {
          $setOnInsert: {
            paypal_subscription_id: paypalSubscriptionId,
            plan_id: paypalData.plan_id ?? '',
            start_time: paypalData.start_time,
            quantity: paypalData.quantity,
            status: mappedStatus,
            createdAt: new Date(),
          },
          $set: { user_id: userId },
        },
        { new: true, upsert: true },
      );

      this.logger.info(
        `Subscription ${paypalSubscriptionId} registered from PayPal (status: ${mappedStatus}) and attached to user ${userId}`,
      );
    }

    this.logger.info(`Subscription ${paypalSubscriptionId} attached to user ${userId}`);

    // Si ya está ACTIVE, intentar activar features automáticamente
    if (subscription!.status === 'ACTIVE' && !(subscription as any).features_applied) {
      this.logger.info(`Subscription already ACTIVE, triggering feature activation`);
      setImmediate(() => {
        this.tryActivateFeatures(paypalSubscriptionId).catch(err =>
          this.logger.error(`Failed to auto-activate features for ${paypalSubscriptionId}`, err)
        );
      });
    }

    return subscription as Subscription;
  }

  /**
   * Activa features premium para una suscripción
   * OPERACIÓN IDEMPOTENTE Y ATÓMICA
   * 
   * Previene:
   * - Doble activación (race condition entre webhooks)
   * - Stack overflow (serialización segura de plan.features)
   * - Inconsistencia User/Subscription
   * 
   * Solo ejecuta si:
   * - status === 'ACTIVE'
   * - user_id existe
   * - features_applied === false
   * 
   * Marca features_applied en la MISMA operación atómica
   */
  async tryActivateFeatures(subscriptionId: string): Promise<void> {
    // OPERACIÓN ATÓMICA: solo actualiza UNA VEZ
    const subscription = await this.subscriptionModel.findOneAndUpdate(
      {
        paypal_subscription_id: subscriptionId,
        status: 'ACTIVE',
        user_id: { $exists: true },
        features_applied: false // CRÍTICO: solo si no ha sido aplicado
      },
      {
        $set: {
          features_applied: true,
          activation_notified: true
        }
      },
      { new: false } // Retorna el documento ANTES del update
    );

    // Si no hay documento, ya fue activado por otro proceso
    if (!subscription) {
      this.logger.info(`Feature activation skipped (already applied or not ready): ${subscriptionId}`);
      return;
    }

    this.logger.info(`Activating features for subscription: ${subscriptionId}`);

    try {
      // Buscar usuario
      const user = await this.userModel.findOne({ id: Number(subscription.user_id) });
      if (!user) {
        this.logger.error(`User not found for subscription ${subscriptionId}: ${subscription.user_id}`);
        // Rollback flag si falla
        await this.subscriptionModel.updateOne(
          { paypal_subscription_id: subscriptionId },
          { $set: { features_applied: false, activation_notified: false } }
        );
        return;
      }

      // Buscar plan con LEAN para evitar objetos Mongoose circulares
      const plan = await this.planModel.findOne({ plan_id: subscription.plan_id }).lean() as any;
      if (!plan) {
        this.logger.error(`Plan not found for subscription ${subscriptionId}: ${subscription.plan_id}`);
        // Rollback flag si falla
        await this.subscriptionModel.updateOne(
          { paypal_subscription_id: subscriptionId },
          { $set: { features_applied: false, activation_notified: false } }
        );
        return;
      }

      // CRÍTICO: Serialización segura de plan.features
      // Evita stack overflow por objetos circulares Mongoose
      const safeFeatures = JSON.parse(JSON.stringify(plan.features));

      // Aplicar features al usuario
      user.pro_features = {
        ...safeFeatures,
        subscription: {
          tier: plan.name,
          paypal_subscription_id: subscription.paypal_subscription_id,
          started_at: new Date(),
          expires_at: subscription.next_billing_date || null,
          auto_renew: true,
          interval: 30,
          active: true,
          price: plan.price,
        },
      };
      user.is_pro = true;

      await user.save();

      this.logger.info(`Features activated for user ${subscription.user_id}, plan: ${plan.name}`);

      // Premium welcome notification with full context
      await this.telegramService
        .notifySubscriptionActivated(Number(subscription.user_id), {
          planName: plan.name,
          amount: plan.price ?? null,
          currency: 'USD',
          nextBillingDate: subscription.next_billing_date ?? null,
        })
        .catch((err) => this.logger.error('Failed to notify activation', err));

    } catch (error) {
      this.logger.error(`Failed to activate features for ${subscriptionId}`, error);

      // Rollback flag para permitir retry
      await this.subscriptionModel.updateOne(
        { paypal_subscription_id: subscriptionId },
        { $set: { features_applied: false, activation_notified: false } }
      );

      throw error;
    }
  }

  /**
   * Actualiza el estado de una suscripción
   * FIX: No sobrescribe plan_id si es undefined
   */
  async updateStatus(
    paypalSubscriptionId: string,
    newStatus: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED',
    resource?: any,
  ): Promise<Subscription | null> {
    const update: any = { status: newStatus };

    // Datos financieros solo si existen
    if (resource?.billing_info?.last_payment) {
      const amount = parseFloat(resource.billing_info.last_payment.amount?.value || '0');
      if (amount > 0) {
        update.amount = amount;
        update.currency = resource.billing_info.last_payment.amount?.currency_code || 'USD';
      }
    }

    if (resource?.billing_info?.next_billing_time) {
      update.next_billing_date = new Date(resource.billing_info.next_billing_time);
    }

    if (resource?.subscriber?.payer_id) {
      update.paypal_payerId = resource.subscriber.payer_id;
    }

    // Solo actualizar plan_id si viene en el resource
    if (resource?.plan_id) {
      update.plan_id = resource.plan_id;
    }

    // Fecha de cancelación
    if (newStatus === 'CANCELLED') {
      update.cancelledAt = new Date();
    }

    // Solo resetear features_applied si cambia a ACTIVE desde otro estado
    // Previene reseteo innecesario que podría causar doble activación
    let subscription = await this.subscriptionModel.findOneAndUpdate(
      { paypal_subscription_id: paypalSubscriptionId },
      { $set: update },
      { new: true }
    );

    if (!subscription) {
      this.logger.warn(`updateStatus: subscription not found ${paypalSubscriptionId}, creating a new one`);
      this.logger.info(`Creating new subscription record for ${paypalSubscriptionId} with status ${newStatus}`);
      try {
        subscription = await this.subscriptionModel.create({
          paypal_subscription_id: paypalSubscriptionId,
          status: newStatus,
          next_billing_date: update.next_billing_date,
          amount: update.amount,
          currency: update.currency,
          plan_id: resource?.plan_id || 'unknown',
          paypal_payerId: update.paypal_payerId,
          // B-5 FIX: garantizar que la query atómica de tryActivateFeatures
          // pueda encontrarlo cuando featues_applied no exista en el documento
          features_applied: false,
          activation_notified: false,
          createdAt: new Date(),
        });
      } catch (error) {
        this.logger.error(`Failed to create subscription ${paypalSubscriptionId}`, error);
        throw error;
      }
    }

    this.logger.info(`Subscription status updated: ${paypalSubscriptionId} -> ${newStatus}`);
    return subscription;
  }

  /**
   * Obtiene el estado premium del usuario
   */
  async getUserPremiumStatus(telegramId: number): Promise<boolean> {
    const user = await this.userModel.findOne({ id: telegramId }).lean() as unknown as User;
    return user?.is_pro || false;
  }

  /**
   * Obtiene todas las suscripciones activas de un usuario
   */
  async getUserActiveSubscriptions(telegramId: number): Promise<Subscription[]> {
    return this.subscriptionModel
      .find({
        user_id: String(telegramId),
        status: 'ACTIVE'
      })
      .lean() as unknown as Subscription[];
  }

  /**
   * Asocia suscripción a usuario en PayPal usando custom_id
   */
  async attachSubscriptionToUser(
    paypalSubscriptionId: string,
    telegramId: number
  ): Promise<{ ok: boolean }> {
    this.logger.info(`Attaching subscription ${paypalSubscriptionId} to user ${telegramId} in PayPal`);

    try {
      const subscription = await this.paypalService.subscriptionsController.getSubscription({
        id: paypalSubscriptionId
      });

      if (!subscription) {
        throw new NotFoundException('Subscription not found in PayPal');
      }

      await this.paypalService.subscriptionsController.patchSubscription({
        id: paypalSubscriptionId,
        body: [
          {
            op: 'replace',
            path: '/custom_id',
            value: telegramId.toString(),
          } as any,
        ]
      });

      this.logger.info(`Subscription ${paypalSubscriptionId} custom_id updated to ${telegramId}`);
      return { ok: true };

    } catch (error: any) {
      this.logger.error(`Failed to attach subscription to user in PayPal`, error);
      throw new Error(error?.message || 'Failed to update PayPal subscription');
    }
  }

  /**
   * Actualiza una suscripción con filtros opcionales.
   * FIX A-9: Usa findOneAndUpdate atómico en lugar de findOne + Object.assign + save
   * que tenía una race condition clásica read-modify-write.
   */
  async updateSubscription(
    subscriptionId: string,
    data: Record<string, any>,
    otherFilters: Record<string, any> = {},
  ): Promise<void> {
    const result = await this.subscriptionModel.findOneAndUpdate(
      { paypal_subscription_id: subscriptionId, ...otherFilters },
      { $set: data },
      { new: true },
    );

    if (!result) {
      this.logger.warn(`Subscription not found for update: ${subscriptionId}`);
      return;
    }

    this.logger.info(`Subscription updated: ${subscriptionId}`);
  }

  /**
   * Obtiene un plan por su plan_id de PayPal.
   * Usado por el webhook processor para construir notificaciones contextuales.
   */
  async getPlanByPlanId(planId: string): Promise<{ name: string; price?: number } | null> {
    if (!planId) return null;
    return this.planModel
      .findOne({ plan_id: planId })
      .select('name price')
      .lean() as unknown as { name: string; price?: number } | null;
  }
}
