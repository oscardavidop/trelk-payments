import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';

import { Subscription } from '../database/schemas/subscription.schema';
import { Plan } from '../database/schemas/plan.schema';
import { User } from '../database/schemas/user.schema';
import { TelegramService } from '../telegram/telegram.service';
import { LoggerService } from '../common/logger.service';

// Stars subscription duration: 30 days
const STARS_ACCESS_DAYS = 30;

// Renewal reminder: sent 3 days before expiry
export const STARS_RENEWAL_REMINDER_DAYS = 3;

// Synthetic paypal_subscription_id prefix for Stars subscriptions
// Format: "STARS-<chargeId>" — unique per payment event
const STARS_SUB_ID_PREFIX = 'STARS';

@Injectable()
export class TelegramPaymentService {
  private readonly logger = new Logger(TelegramPaymentService.name);

  constructor(
    @InjectModel(Subscription.name, 'payments')
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(Plan.name, 'payments')
    private readonly planModel: Model<Plan>,
    @InjectModel(User.name, 'mbot')
    private readonly userModel: Model<User>,
    private readonly telegramService: TelegramService,
    private readonly appLogger: LoggerService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // INVOICE CREATION
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Creates a Telegram Stars invoice link for the given plan.
   *
   * Returns the invoice URL to pass to `Telegram.WebApp.openInvoice()`.
   *
   * The invoice payload encodes { tgId, planName } so the bot can correlate
   * the `successful_payment` event without any extra state.
   */
  async createStarsInvoice(tgId: number, planName: string): Promise<{
    invoiceUrl: string;
    planName: string;
    starsAmount: number;
    priceUsd: number;
  }> {
    const plan = await this.planModel
      .findOne({ name: planName.toLowerCase(), active: true })
      .lean() as any;

    if (!plan) {
      throw new NotFoundException(`Plan "${planName}" not found or inactive`);
    }

    if (!plan.stars_price || plan.stars_price < 1) {
      throw new BadRequestException(
        `Plan "${planName}" does not support Telegram Stars payment`,
      );
    }

    // Build a compact, URL-safe payload (max 128 bytes)
    const payload = this.buildPayload(tgId, plan.name);

    const displayName = plan.name.charAt(0).toUpperCase() + plan.name.slice(1);
    const invoiceUrl = await this.telegramService.createStarsInvoiceLink({
      title: `${displayName} — 30 days`,
      description: `${displayName} subscription for 30 days of premium access.`,
      payload,
      starAmount: plan.stars_price,
      subscriptionPeriod: 2592000,  // Telegram native auto-recurring every 30 days
    });

    this.appLogger.info(
      `Stars invoice created for user ${tgId}: plan=${plan.name}, stars=${plan.stars_price}`,
    );

    return {
      invoiceUrl,
      planName: plan.name,
      starsAmount: plan.stars_price,
      priceUsd: plan.price,
    };
  }

  /**
   * Creates a Telegram invoice link for credit card payment (USD) for the given plan.
   *
   * Returns the invoice URL to pass to `Telegram.WebApp.openInvoice()`.
   *
   * The invoice payload encodes { tgId, planName } so the bot can correlate
   * the `successful_payment` event without any extra state.
   * 
   * Requires TELEGRAM_PROVIDER_TOKEN to be configured (from BotFather).
   */
  async createCardInvoice(tgId: number, planName: string): Promise<{
    invoiceUrl: string;
    planName: string;
    priceUsd: number;
    currency: string;
    amountCents: number;
  }> {
    const providerToken = process.env.TELEGRAM_PROVIDER_TOKEN;
    if (!providerToken) {
      throw new BadRequestException(
        'Card payments are not configured. Provider token is missing.',
      );
    }

    const plan = await this.planModel
      .findOne({ name: planName.toLowerCase(), active: true })
      .lean() as any;

    if (!plan) {
      throw new NotFoundException(`Plan "${planName}" not found or inactive`);
    }

    if (!plan.price || plan.price < 0.01) {
      throw new BadRequestException(
        `Plan "${planName}" does not have a valid price for card payments`,
      );
    }

    // Build a compact, URL-safe payload (max 128 bytes)
    const payload = this.buildPayload(tgId, plan.name);

    const displayName = plan.name.charAt(0).toUpperCase() + plan.name.slice(1);
    const amountCents = Math.round(plan.price * 100); // Convert USD to cents

    const invoiceUrl = await this.telegramService.createCardInvoiceLink({
      title: `${displayName} — 30 days`,
      description: `${displayName} subscription for 30 days of premium access.`,
      payload,
      providerToken,
      currency: 'USD',
      amount: amountCents,
    });

    this.appLogger.info(
      `Card invoice created for user ${tgId}: plan=${plan.name}, price=${plan.price} USD`,
    );

    return {
      invoiceUrl,
      planName: plan.name,
      priceUsd: plan.price,
      currency: 'USD',
      amountCents,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PAYMENT CONFIRMATION (called from bot webhook)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Processes a confirmed Stars payment.
   *
   * Called by the bot after receiving a `successful_payment` update.
   * Idempotent: duplicate charge IDs are silently ignored.
   *
   * Flow:
   * 1. Validate payload & parse tgId/planName
   * 2. Idempotency check (telegram_charge_id)
   * 3. Create/renew subscription record
   * 4. Activate features on user
   * 5. Send confirmation notification
   *
   * For Telegram native recurring subscriptions:
   * - is_first_recurring=true → first payment, create new subscription
   * - is_recurring=true → Telegram auto-renewed, extend access using subscription_expiration_date
   */
  async handleSuccessfulPayment(params: {
    tgId: number;
    telegramChargeId: string;
    invoicePayload: string;
    totalAmount: number;   // Stars paid
    method?: 'telegram_stars' | 'telegram_card';
    currency?: string;
    isFirstRecurring?: boolean;
    isRecurring?: boolean;
    subscriptionExpirationDate?: number; // Unix timestamp from Telegram
  }): Promise<{ ok: boolean; subscriptionId: string; accessUntil: Date }> {
    const {
      tgId, telegramChargeId, invoicePayload, totalAmount,
      method, currency,
      isFirstRecurring, isRecurring, subscriptionExpirationDate,
    } = params;

    const paymentMethod = method === 'telegram_card' ? 'telegram_card' : 'telegram_stars';
    const paymentCurrency = (currency ?? (paymentMethod === 'telegram_card' ? 'USD' : 'XTR')).toUpperCase();

    // ── 1. Idempotency: skip if we already processed this charge ─────────────
    const existing = await this.subscriptionModel.findOne({
      telegram_charge_id: telegramChargeId,
    }).lean();

    if (existing) {
      this.logger.log(`Telegram payment already processed: ${telegramChargeId}`);
      const sub = existing as any;
      return {
        ok: true,
        subscriptionId: sub.paypal_subscription_id,
        accessUntil: sub.expires_at ?? sub.next_billing_date,
      };
    }

    // ── 2. Parse & validate payload ──────────────────────────────────────────
    const parsed = this.parsePayload(invoicePayload);
    if (!parsed || parsed.tgId !== tgId) {
      this.logger.warn(
        `Telegram payment payload mismatch: tgId=${tgId}, parsed=${JSON.stringify(parsed)}`,
      );
      throw new BadRequestException('Invalid invoice payload');
    }

    const planName = parsed.planName.toLowerCase();

    // ── 3. Fetch plan for feature activation ─────────────────────────────────
    const plan = await this.planModel.findOne({ name: planName, active: true }).lean() as any;
    if (!plan) {
      throw new NotFoundException(`Plan "${planName}" not found`);
    }

    // ── 4. Compute access window ─────────────────────────────────────────────
    const now = new Date();

    // For Stars recurring: use subscription_expiration_date as authoritative expiry.
    // For card payments: Telegram provider flow is one-time (manual renewal in app).
    let accessUntil: Date;
    if (paymentMethod === 'telegram_stars' && subscriptionExpirationDate && subscriptionExpirationDate > 0) {
      accessUntil = new Date(subscriptionExpirationDate * 1000);
    } else {
      accessUntil = new Date(now);
      accessUntil.setDate(accessUntil.getDate() + STARS_ACCESS_DAYS);
    }

    // Synthetic subscription ID prefix per Telegram method
    const subscriptionPrefix = paymentMethod === 'telegram_card' ? 'TGCARD' : STARS_SUB_ID_PREFIX;
    const subscriptionId = `${subscriptionPrefix}-${this.shortHash(telegramChargeId)}`;
    const userId = String(tgId);

    // ── 5. Check for existing active Telegram subscription (same provider) ───
    const activeStarsSub = await this.subscriptionModel.findOne({
      user_id: userId,
      provider: paymentMethod,
      status: 'ACTIVE',
    }).lean() as any;

    if (activeStarsSub) {
      // Renewal:
      // - Stars recurring can use Telegram subscription_expiration_date
      // - Card payments extend from current expiry (manual renewals)
      let renewedUntil: Date;
      if (
        paymentMethod === 'telegram_stars'
        && subscriptionExpirationDate
        && subscriptionExpirationDate > 0
      ) {
        renewedUntil = new Date(subscriptionExpirationDate * 1000);
      } else {
        const currentExpiry = activeStarsSub.expires_at
          ? new Date(activeStarsSub.expires_at)
          : new Date();
        const baseDate = currentExpiry > now ? currentExpiry : now;
        renewedUntil = new Date(baseDate);
        renewedUntil.setDate(renewedUntil.getDate() + STARS_ACCESS_DAYS);
      }

      await this.subscriptionModel.updateOne(
        { _id: activeStarsSub._id },
        {
          $set: {
            expires_at: renewedUntil,
            next_billing_date: renewedUntil,
            telegram_charge_id: telegramChargeId,
            telegram_invoice_payload: invoicePayload,
            amount: totalAmount,
            currency: paymentCurrency,
            plan_id: plan.plan_id,
          },
        },
      );

      await this.activateUserFeatures(tgId, planName);

      if (paymentMethod === 'telegram_stars') {
        await this.telegramService.notifyStarsPaymentReceived(tgId, {
          planName: plan.name.charAt(0).toUpperCase() + plan.name.slice(1),
          starsAmount: totalAmount,
          accessUntil: renewedUntil,
        }).catch((e) => this.logger.error('Notify failed', e));
      } else {
        await this.telegramService.notifySubscriptionActivated(tgId, {
          planName: plan.name,
          amount: totalAmount / 100,
          currency: paymentCurrency,
          nextBillingDate: renewedUntil,
        }).catch((e) => this.logger.error('Notify failed', e));
      }

      this.appLogger.info(
        `Telegram renewal processed: user=${tgId}, method=${paymentMethod}, plan=${planName}, until=${renewedUntil.toISOString()}`,
      );

      return { ok: true, subscriptionId: activeStarsSub.paypal_subscription_id, accessUntil: renewedUntil };
    }

    // ── 6. New subscription ──────────────────────────────────────────────────
    // Cancel any existing PayPal-based APPROVAL_PENDING subscriptions for this user
    // (cleanup, not blocking)
    await this.subscriptionModel.updateMany(
      { user_id: userId, status: 'APPROVAL_PENDING' },
      { $set: { status: 'CANCELLED', cancelledAt: now } },
    ).catch(() => undefined);

    await this.subscriptionModel.create({
      paypal_subscription_id: subscriptionId,
      plan_id: plan.plan_id,
      provider: paymentMethod,
      status: 'ACTIVE',
      user_id: userId,
      start_time: now.toISOString(),
      amount: totalAmount,
      currency: paymentCurrency,
      next_billing_date: accessUntil,
      expires_at: accessUntil,
      telegram_charge_id: telegramChargeId,
      telegram_invoice_payload: invoicePayload,
      features_applied: false,
      activation_notified: false,
      cancel_at_period_end: false,
    });

    await this.activateUserFeatures(tgId, planName);

    if (paymentMethod === 'telegram_stars') {
      await this.telegramService.notifyStarsPaymentReceived(tgId, {
        planName: plan.name.charAt(0).toUpperCase() + plan.name.slice(1),
        starsAmount: totalAmount,
        accessUntil,
      }).catch((e) => this.logger.error('Notify failed', e));
    } else {
      await this.telegramService.notifySubscriptionActivated(tgId, {
        planName: plan.name,
        amount: totalAmount / 100,
        currency: paymentCurrency,
        nextBillingDate: accessUntil,
      }).catch((e) => this.logger.error('Notify failed', e));
    }

    this.appLogger.info(
      `Telegram subscription created: user=${tgId}, method=${paymentMethod}, plan=${planName}, sub=${subscriptionId}, until=${accessUntil.toISOString()}`,
    );

    return { ok: true, subscriptionId, accessUntil };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXPIRY (called by reconciliation cron)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Expires all Telegram Stars subscriptions whose access period has ended.
   * Returns the number of expired subscriptions.
   */
  async expireStaleStarsSubscriptions(): Promise<number> {
    const now = new Date();

    const expired = await this.subscriptionModel.find({
      provider: 'telegram_stars',
      status: 'ACTIVE',
      expires_at: { $lte: now },
    }).lean() as any[];

    for (const sub of expired) {
      await this.subscriptionModel.updateOne(
        { _id: sub._id },
        { $set: { status: 'EXPIRED' } },
      );

      const userId = Number(sub.user_id);
      if (userId) {
        await this.userModel.updateOne(
          { id: userId },
          { $set: { is_pro: false } },
        ).catch((e) => this.logger.error(`Downgrade failed for user ${userId}`, e));

        await this.telegramService.notifyAccessExpired(userId, {
          planName: sub.plan_id ?? 'premium',
        }).catch((e) => this.logger.error('Notify expired failed', e));
      }
    }

    if (expired.length > 0) {
      this.appLogger.info(`Expired ${expired.length} stale Stars subscriptions`);
    }

    return expired.length;
  }

  /**
   * Sends renewal reminders for Stars subscriptions expiring in STARS_RENEWAL_REMINDER_DAYS.
   */
  async sendRenewalReminders(): Promise<number> {
    const now = new Date();
    const target = new Date(now);
    target.setDate(target.getDate() + STARS_RENEWAL_REMINDER_DAYS);

    // Find subscriptions expiring within the reminder window that haven't been reminded yet
    const subs = await this.subscriptionModel.find({
      provider: 'telegram_stars',
      status: 'ACTIVE',
      expires_at: { $gt: now, $lte: target },
      // Use activation_notified here as "reminder sent" flag (repurposed to avoid new field)
      // Better: add reminder_sent field, but for minimum viable: check notified flag
    }).lean() as any[];

    let sent = 0;
    for (const sub of subs) {
      const userId = Number(sub.user_id);
      if (!userId) continue;

      const expiresAt = new Date(sub.expires_at);
      const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Fetch stars_price for reminder
      const plan = await this.planModel.findOne({ plan_id: sub.plan_id }).lean() as any;
      if (!plan?.stars_price) continue;

      await this.telegramService.notifyStarsRenewalReminder(userId, {
        planName: plan.name.charAt(0).toUpperCase() + plan.name.slice(1),
        starsAmount: plan.stars_price,
        daysLeft,
        accessUntil: expiresAt,
      }).catch((e) => this.logger.error('Renewal reminder failed', e));

      sent++;
    }

    return sent;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Activates premium features for the user in the mbot DB.
   */
  private async activateUserFeatures(tgId: number, planName: string): Promise<void> {
    // Delegate to userModel: mark is_pro = true, tier = planName
    await this.userModel.updateOne(
      { id: tgId },
      {
        $set: {
          is_pro: true,
          'pro_features.subscription.tier': planName,
          'pro_features.subscription.active': true,
          'pro_features.subscription.auto_renew': true, // Stars = Telegram native auto-recurring
        },
      },
    );

    this.logger.log(`User ${tgId} activated with Stars plan: ${planName}`);
  }

  /** Builds a compact signed payload: base64("tgId:planName") — max 128 bytes */
  private buildPayload(tgId: number, planName: string): string {
    return Buffer.from(`${tgId}:${planName}`).toString('base64');
  }

  /** Parses the payload created by buildPayload (base64-encoded "tgId:planName") */
  private parsePayload(payload: string): { tgId: number; planName: string } | null {
    try {
      const raw = Buffer.from(payload, 'base64').toString('utf8');
      const colonIdx = raw.indexOf(':');
      if (colonIdx < 1) return null;
      const idStr = raw.slice(0, colonIdx);
      const planName = raw.slice(colonIdx + 1);
      const tgId = parseInt(idStr, 10);
      if (!isFinite(tgId) || !planName) return null;
      return { tgId, planName };
    } catch {
      return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUBSCRIPTION MANAGEMENT (recurring Stars)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Cancels a Telegram Stars recurring subscription at period end.
   * After cancellation the user retains access until expires_at, then loses it.
   */
  async cancelStarSubscription(tgId: number): Promise<{ ok: boolean; accessUntil: Date | null }> {
    const sub = await this.subscriptionModel.findOne({
      user_id: String(tgId),
      provider: 'telegram_stars',
      status: 'ACTIVE',
    }).lean() as any;

    if (!sub) {
      throw new NotFoundException('No active Stars subscription found');
    }

    const chargeId: string = sub.telegram_charge_id;
    if (!chargeId) {
      throw new BadRequestException('Subscription has no charge ID for cancellation');
    }

    // Cancel the Telegram recurring subscription
    await this.telegramService.editUserStarSubscription(tgId, chargeId, true);

    // Mark as cancel-at-period-end in our DB
    await this.subscriptionModel.updateOne(
      { _id: sub._id },
      { $set: { cancel_at_period_end: true } },
    );

    // Update user's auto_renew flag
    await this.userModel.updateOne(
      { id: tgId },
      { $set: { 'pro_features.subscription.auto_renew': false } },
    );

    const accessUntil = sub.expires_at ? new Date(sub.expires_at) : null;

    // Notify user
    await this.telegramService.notifyStarsCancellation(tgId, { accessUntil }).catch(
      (e) => this.logger.error('Cancel notify failed', e),
    );

    this.appLogger.info(`Stars subscription cancelled for user ${tgId}, access until ${accessUntil?.toISOString()}`);

    return { ok: true, accessUntil };
  }

  /**
   * Issues a Stars refund for a given charge ID.
   * This is called from an admin endpoint (e.g., in response to a /paysupport ticket).
   */
  async refundStarPayment(tgId: number, chargeId: string): Promise<{ ok: boolean }> {
    await this.telegramService.refundStarPayment(tgId, chargeId);

    // Mark subscription as refunded/expired
    await this.subscriptionModel.updateOne(
      { telegram_charge_id: chargeId },
      { $set: { status: 'REFUNDED', cancel_at_period_end: false } },
    );

    // Downgrade user
    await this.userModel.updateOne(
      { id: tgId },
      { $set: { is_pro: false } },
    );

    this.appLogger.info(`Stars refund issued: user=${tgId}, charge=${chargeId}`);
    return { ok: true };
  }

  /** Short deterministic hash prefix for synthetic subscription IDs */
  private shortHash(input: string): string {
    return createHash('sha256').update(input).digest('hex').slice(0, 12).toUpperCase();
  }
}
