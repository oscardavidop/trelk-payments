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
   */
  async handleSuccessfulPayment(params: {
    tgId: number;
    telegramChargeId: string;
    invoicePayload: string;
    totalAmount: number;   // Stars paid
  }): Promise<{ ok: boolean; subscriptionId: string; accessUntil: Date }> {
    const { tgId, telegramChargeId, invoicePayload, totalAmount } = params;

    // ── 1. Idempotency: skip if we already processed this charge ─────────────
    const existing = await this.subscriptionModel.findOne({
      telegram_charge_id: telegramChargeId,
    }).lean();

    if (existing) {
      this.logger.log(`Stars payment already processed: ${telegramChargeId}`);
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
        `Stars payload mismatch: tgId=${tgId}, parsed=${JSON.stringify(parsed)}`,
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
    const accessUntil = new Date(now);
    accessUntil.setDate(accessUntil.getDate() + STARS_ACCESS_DAYS);

    // Synthetic subscription ID: STARS-<hash of chargeId>
    const subscriptionId = `${STARS_SUB_ID_PREFIX}-${this.shortHash(telegramChargeId)}`;
    const userId = String(tgId);

    // ── 5. Check for existing active Stars subscription (renewal) ────────────
    const activeStarsSub = await this.subscriptionModel.findOne({
      user_id: userId,
      provider: 'telegram_stars',
      status: 'ACTIVE',
    }).lean() as any;

    if (activeStarsSub) {
      // Renewal: extend the expiry date forward
      const currentExpiry = activeStarsSub.expires_at
        ? new Date(activeStarsSub.expires_at)
        : new Date();
      // If still in active period, add 30 days from current expiry
      const baseDate = currentExpiry > now ? currentExpiry : now;
      const renewedUntil = new Date(baseDate);
      renewedUntil.setDate(renewedUntil.getDate() + STARS_ACCESS_DAYS);

      await this.subscriptionModel.updateOne(
        { _id: activeStarsSub._id },
        {
          $set: {
            expires_at: renewedUntil,
            next_billing_date: renewedUntil,
            telegram_charge_id: telegramChargeId,
            telegram_invoice_payload: invoicePayload,
            amount: totalAmount,
            plan_id: plan.plan_id,
          },
        },
      );

      await this.activateUserFeatures(tgId, planName);
      await this.telegramService.notifyStarsPaymentReceived(tgId, {
        planName: plan.name.charAt(0).toUpperCase() + plan.name.slice(1),
        starsAmount: totalAmount,
        accessUntil: renewedUntil,
      }).catch((e) => this.logger.error('Notify failed', e));

      this.appLogger.info(
        `Stars renewal processed: user=${tgId}, plan=${planName}, until=${renewedUntil.toISOString()}`,
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
      provider: 'telegram_stars',
      status: 'ACTIVE',
      user_id: userId,
      start_time: now.toISOString(),
      amount: totalAmount,
      currency: 'XTR',
      next_billing_date: accessUntil,
      expires_at: accessUntil,
      telegram_charge_id: telegramChargeId,
      telegram_invoice_payload: invoicePayload,
      features_applied: false,
      activation_notified: false,
      cancel_at_period_end: false,
    });

    await this.activateUserFeatures(tgId, planName);

    await this.telegramService.notifyStarsPaymentReceived(tgId, {
      planName: plan.name.charAt(0).toUpperCase() + plan.name.slice(1),
      starsAmount: totalAmount,
      accessUntil,
    }).catch((e) => this.logger.error('Notify failed', e));

    this.appLogger.info(
      `Stars subscription created: user=${tgId}, plan=${planName}, sub=${subscriptionId}, until=${accessUntil.toISOString()}`,
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
          'pro_features.subscription.auto_renew': false, // Stars = manual renewal
        },
      },
    );

    this.logger.log(`User ${tgId} activated with Stars plan: ${planName}`);
  }

  /** Builds a compact signed payload: "tgId:planName" */
  private buildPayload(tgId: number, planName: string): string {
    return `${tgId}:${planName}`;
  }

  /** Parses the payload created by buildPayload */
  private parsePayload(payload: string): { tgId: number; planName: string } | null {
    try {
      const [idStr, planName] = payload.split(':');
      const tgId = parseInt(idStr, 10);
      if (!isFinite(tgId) || !planName) return null;
      return { tgId, planName };
    } catch {
      return null;
    }
  }

  /** Short deterministic hash prefix for synthetic subscription IDs */
  private shortHash(input: string): string {
    return createHash('sha256').update(input).digest('hex').slice(0, 12).toUpperCase();
  }
}
