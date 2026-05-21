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
  }): Promise<string> {
    const res = await axios.post<{ ok: boolean; result: string }>(
      `${this.apiUrl}/createInvoiceLink`,
      {
        title: params.title.slice(0, 32),
        description: params.description.slice(0, 255),
        payload: params.payload.slice(0, 128),
        currency: 'XTR',          // XTR = Telegram Stars currency code
        prices: [{ label: params.title.slice(0, 32), amount: params.starAmount }],
        // No provider_token needed for Stars payments
      },
    );

    if (!res.data.ok || !res.data.result) {
      throw new Error(`Telegram createInvoiceLink failed: ${JSON.stringify(res.data)}`);
    }

    return res.data.result; // direct invoice URL
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
}
