import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import {
  tplSubscriptionActivated,
  tplPaymentRenewal,
  tplSubscriptionCancelled,
  tplSubscriptionSuspended,
  tplSubscriptionResumed,
  tplSubscriptionExpired,
  tplPaymentFailed,
  tplPlanUpgraded,
  tplPlanDowngraded,
  tplCancelScheduled,
  tplAccessExpired,
  tplDowngradeScheduled,
  tplDowngradeApplied,
  type ActivatedData,
  type RenewalData,
  type CancelledData,
  type SuspendedData,
  type ResumedData,
  type ExpiredData,
  type PaymentFailedData,
  type UpgradeData,
  type DowngradeData,
  type CancelScheduledData,
  type AccessExpiredData,
  type DowngradeScheduledData,
  type DowngradeAppliedData,
} from './notification-templates';

// Retry config: 3 attempts, exponential backoff 1s → 2s → 4s
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1_000;

// Telegram errors that are permanent (no point retrying)
const PERMANENT_ERROR_CODES = new Set([400, 403]);

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken: string;
  private readonly apiUrl: string;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }
    this.botToken = token;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  // ── Core send with retry ───────────────────────────────────────────────────

  /**
   * Sends an HTML message with retry.
   * Permanent errors (blocked user, invalid chat) are logged but not thrown.
   */
  async sendMessage(
    chatId: number,
    text: string,
    parseMode: 'HTML' | 'Markdown' = 'HTML',
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await axios.post(`${this.apiUrl}/sendMessage`, {
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        });
        this.logger.log(`[TG] Sent to ${chatId} (attempt ${attempt})`);
        return;
      } catch (err: any) {
        const axiosErr = err as AxiosError<any>;
        const status = axiosErr.response?.status;

        // Permanent error: user blocked bot or chat not found — don't retry
        if (status && PERMANENT_ERROR_CODES.has(status)) {
          this.logger.warn(
            `[TG] Permanent error for chat ${chatId}: ${status} — ${axiosErr.response?.data?.description}`,
          );
          return;
        }

        lastError = err;
        this.logger.warn(
          `[TG] Attempt ${attempt}/${MAX_RETRIES} failed for chat ${chatId}: ${axiosErr.response?.data?.description ?? err.message}`,
        );

        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt - 1)));
        }
      }
    }

    // Log final failure but don't throw — billing flow must not break on TG failure
    this.logger.error(
      `[TG] Failed to deliver message to ${chatId} after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    );
  }

  // ── Lifecycle notification methods ─────────────────────────────────────────

  async notifySubscriptionActivated(chatId: number, data: ActivatedData): Promise<void> {
    await this.sendMessage(chatId, tplSubscriptionActivated(data));
  }

  async notifyPaymentRenewal(chatId: number, data: RenewalData): Promise<void> {
    await this.sendMessage(chatId, tplPaymentRenewal(data));
  }

  async notifySubscriptionCancelled(chatId: number, data: CancelledData): Promise<void> {
    await this.sendMessage(chatId, tplSubscriptionCancelled(data));
  }

  async notifySubscriptionSuspended(chatId: number, data: SuspendedData): Promise<void> {
    await this.sendMessage(chatId, tplSubscriptionSuspended(data));
  }

  async notifySubscriptionResumed(chatId: number, data: ResumedData): Promise<void> {
    await this.sendMessage(chatId, tplSubscriptionResumed(data));
  }

  async notifySubscriptionExpired(chatId: number, data: ExpiredData): Promise<void> {
    await this.sendMessage(chatId, tplSubscriptionExpired(data));
  }

  async notifyPaymentFailed(chatId: number, data?: PaymentFailedData): Promise<void> {
    const text = data
      ? tplPaymentFailed(data)
      : tplPaymentFailed({ planName: 'premium' });
    await this.sendMessage(chatId, text);
  }

  async notifyPlanUpgraded(chatId: number, data: UpgradeData): Promise<void> {
    await this.sendMessage(chatId, tplPlanUpgraded(data));
  }

  async notifyPlanDowngraded(chatId: number, data: DowngradeData): Promise<void> {
    await this.sendMessage(chatId, tplPlanDowngraded(data));
  }

  /** Cancellation scheduled — access continues until accessUntil date */
  async notifyCancelScheduled(chatId: number, data: CancelScheduledData): Promise<void> {
    await this.sendMessage(chatId, tplCancelScheduled(data));
  }

  /** Access expired — deferred cancellation period ended, user moved to free */
  async notifyAccessExpired(chatId: number, data: AccessExpiredData): Promise<void> {
    await this.sendMessage(chatId, tplAccessExpired(data));
  }

  /** Downgrade scheduled — plan change applied at next billing cycle */
  async notifyDowngradeScheduled(chatId: number, data: DowngradeScheduledData): Promise<void> {
    await this.sendMessage(chatId, tplDowngradeScheduled(data));
  }

  /** Downgrade applied — the scheduled downgrade took effect at the new billing cycle */
  async notifyDowngradeApplied(chatId: number, data: DowngradeAppliedData): Promise<void> {
    await this.sendMessage(chatId, tplDowngradeApplied(data));
  }

  // ── Telegram Stars payment helpers ─────────────────────────────────────────

  /**
   * Creates a Telegram Stars invoice link via the Bot API.
   *
   * Stars payments:
   * - Payment is instant (no pre_checkout_query)
   * - The bot receives `successful_payment` update with telegram_payment_charge_id
   * - One-time payment; access duration managed by our billing logic
   * - Telegram Stars DO require pre_checkout_query → answerPreCheckoutQuery
   *   The bot handles pre_checkout_query (fast-path approve within 10s)
   *
   * @param params.title        Short invoice title (max 32 chars)
   * @param params.description  Invoice description (max 255 chars)
   * @param params.payload      Custom payload sent back in successful_payment (max 128 bytes)
   * @param params.starAmount   Number of Stars to charge
   * @returns direct invoice link (t.me/...)
   */
  async createStarsInvoiceLink(params: {
    title: string;
    description: string;
    payload: string;
    starAmount: number;
    /** Pass 2592000 to create a recurring 30-day subscription invoice */
    subscriptionPeriod?: 2592000;
  }): Promise<string> {
    const body: Record<string, unknown> = {
      title: params.title.slice(0, 32),
      description: params.description.slice(0, 255),
      payload: params.payload.slice(0, 128),
      provider_token: '',           // Must be empty string for Telegram Stars
      currency: 'XTR',             // XTR = Telegram Stars currency code
      prices: [{ label: params.title.slice(0, 32), amount: params.starAmount }],
    };

    if (params.subscriptionPeriod) {
      body.subscription_period = params.subscriptionPeriod;
    }

    const res = await axios.post<{ ok: boolean; result: string }>(
      `${this.apiUrl}/createInvoiceLink`,
      body,
    );

    if (!res.data.ok || !res.data.result) {
      throw new Error(`Telegram createInvoiceLink failed: ${JSON.stringify(res.data)}`);
    }

    return res.data.result; // direct invoice URL
  }

  /**
   * Creates a Telegram invoice link for credit card payment via provider.
   *
   * Supported currencies: USD, EUR, GBP, JPY, CNY, etc.
   * Non-recurring: payment is one-time or handled separately for renewals.
   * Requires a valid provider_token configured in BotFather.
   *
   * Available providers:
   * - "stripe": Card payments via Stripe
   * - Others: Telegram may add additional providers
   *
   * @param params.title        Short invoice title (max 32 chars)
   * @param params.description  Invoice description (max 255 chars)
   * @param params.payload      Custom payload sent back in successful_payment (max 128 bytes)
   * @param params.providerToken Valid provider token from BotFather (for Stripe, etc.)
   * @param params.currency     Three-letter ISO 4217 currency code (USD, EUR, GBP, etc.)
   * @param params.amount       Total amount in smallest currency unit (e.g., cents for USD)
   * @returns direct invoice link (t.me/...)
   * @throws Error if provider_token is invalid or missing
   */
  async createCardInvoiceLink(params: {
    title: string;
    description: string;
    payload: string;
    providerToken: string;
    currency: string;  // e.g., 'USD', 'EUR', 'GBP'
    amount: number;     // in smallest units: cents for USD, etc.
  }): Promise<string> {
    if (!params.providerToken) {
      throw new Error('providerToken is required for card payments but was not configured');
    }

    const body: Record<string, unknown> = {
      title: params.title.slice(0, 32),
      description: params.description.slice(0, 255),
      payload: params.payload.slice(0, 128),
      provider_token: params.providerToken,  // Must be non-empty for card payments
      currency: params.currency.toUpperCase(), // 'USD', 'EUR', etc.
      prices: [{ label: params.title.slice(0, 32), amount: params.amount }],
    };

    const res = await axios.post<{ ok: boolean; result: string }>(
      `${this.apiUrl}/createInvoiceLink`,
      body,
    );

    if (!res.data.ok || !res.data.result) {
      throw new Error(`Telegram createInvoiceLink (card) failed: ${JSON.stringify(res.data)}`);
    }

    this.logger.log(
      `[TG] Card invoice created: currency=${params.currency}, amount=${params.amount}`,
    );

    return res.data.result; // direct invoice URL
  }

  /**
   * Call with isCanceled=true to cancel at period end.
   * Call with isCanceled=false to re-enable a cancelled subscription.
   *
   * @see https://core.telegram.org/bots/api#edituserstarsubscription
   */
  async editUserStarSubscription(
    userId: number,
    telegramPaymentChargeId: string,
    isCanceled: boolean,
  ): Promise<void> {
    try {
      await axios.post(`${this.apiUrl}/editUserStarSubscription`, {
        user_id: userId,
        telegram_payment_charge_id: telegramPaymentChargeId,
        is_canceled: isCanceled,
      });
      this.logger.log(
        `[TG] editUserStarSubscription user=${userId} canceled=${isCanceled}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[TG] editUserStarSubscription failed user=${userId}: ${err?.response?.data?.description ?? err.message}`,
      );
      throw err;
    }
  }

  /**
   * Refund a Stars payment to the user.
   *
   * @see https://core.telegram.org/bots/api#refundstarpayment
   */
  async refundStarPayment(
    userId: number,
    telegramPaymentChargeId: string,
  ): Promise<void> {
    try {
      await axios.post(`${this.apiUrl}/refundStarPayment`, {
        user_id: userId,
        telegram_payment_charge_id: telegramPaymentChargeId,
      });
      this.logger.log(
        `[TG] refundStarPayment user=${userId} chargeId=${telegramPaymentChargeId}`,
      );
    } catch (err: any) {
      this.logger.error(
        `[TG] refundStarPayment failed user=${userId}: ${err?.response?.data?.description ?? err.message}`,
      );
      throw err;
    }
  }

  /**
   * Notify the user about a Stars payment receipt and subscription activation.
   */
  async notifyStarsPaymentReceived(chatId: number, data: {
    planName: string;
    starsAmount: number;
    accessUntil: Date;
  }): Promise<void> {
    const untilStr = data.accessUntil.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    const text =
      `⭐ <b>Payment received!</b>\n\n` +
      `You paid <b>${data.starsAmount} Stars</b> for the <b>${data.planName}</b> plan.\n` +
      `Access granted until <b>${untilStr}</b>.\n\n` +
      `Renew anytime from the app before expiry to keep uninterrupted access.`;
    await this.sendMessage(chatId, text);
  }

  /**
   * Notify the user about an upcoming Stars subscription renewal reminder.
   */
  async notifyStarsRenewalReminder(chatId: number, data: {
    planName: string;
    starsAmount: number;
    daysLeft: number;
    accessUntil: Date;
  }): Promise<void> {
    const untilStr = data.accessUntil.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    const text =
      `⭐ <b>Renewal reminder</b>\n\n` +
      `Your <b>${data.planName}</b> plan expires in <b>${data.daysLeft} day${data.daysLeft !== 1 ? 's' : ''}</b> (${untilStr}).\n\n` +
      `Open the app to renew for another month with <b>${data.starsAmount} Stars</b>.`;
    await this.sendMessage(chatId, text);
  }

  /**
   * Notify the user that their Stars subscription was cancelled.
   * Access is retained until accessUntil date.
   */
  async notifyStarsCancellation(chatId: number, data: { accessUntil: Date | null }): Promise<void> {
    const untilStr = data.accessUntil
      ? data.accessUntil.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'end of billing period';
    const text =
      `⭐ <b>Subscription cancelled</b>\n\n` +
      `Your Telegram Stars subscription has been cancelled.\n` +
      `You will retain premium access until <b>${untilStr}</b>.\n\n` +
      `You can resubscribe anytime from the app.`;
    await this.sendMessage(chatId, text);
  }

  /**
   * Provider-aware cancellation notification for Telegram subscriptions.
   */
  async notifyTelegramSubscriptionCancellation(
    chatId: number,
    data: { accessUntil: Date | null; provider: 'telegram_stars' | 'telegram_card' },
  ): Promise<void> {
    if (data.provider === 'telegram_stars') {
      await this.notifyStarsCancellation(chatId, { accessUntil: data.accessUntil });
      return;
    }

    const untilStr = data.accessUntil
      ? data.accessUntil.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'end of billing period';

    const text =
      `💳 <b>Subscription cancelled</b>\n\n` +
      `Your Telegram card subscription has been cancelled.\n` +
      `You will retain premium access until <b>${untilStr}</b>.\n\n` +
      `You can renew anytime from the app.`;

    await this.sendMessage(chatId, text);
  }
}
