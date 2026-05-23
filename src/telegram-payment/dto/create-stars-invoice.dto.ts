import { IsString, IsNotEmpty, IsInt, IsPositive, IsOptional, IsBoolean, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStarsInvoiceDto {
  /** Telegram user ID who is making the purchase */
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  tg_id: number;

  /** Plan name slug: basic | pro | ultra */
  @IsString()
  @IsNotEmpty()
  plan_name: string;
}

export class StarsPaymentWebhookDto {
  /** Telegram user ID */
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  tg_id: number;

  /** Telegram's unique charge identifier (from successful_payment.telegram_payment_charge_id) */
  @IsString()
  @IsNotEmpty()
  telegram_charge_id: string;

  /** The payload we sent when creating the invoice (contains base64(tgId:planName)) */
  @IsString()
  @IsNotEmpty()
  invoice_payload: string;

  /** Total stars paid */
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  total_amount: number;

  /** Payment method inferred by bot from currency */
  @IsOptional()
  @IsIn(['telegram_stars', 'telegram_card'])
  method?: 'telegram_stars' | 'telegram_card';

  /** Payment currency from Telegram successful_payment */
  @IsOptional()
  @IsString()
  currency?: string;

  /** True on the first payment of a recurring subscription (Telegram native recurring) */
  @IsOptional()
  @IsBoolean()
  is_first_recurring?: boolean;

  /** True for automatic renewals of a recurring subscription */
  @IsOptional()
  @IsBoolean()
  is_recurring?: boolean;

  /**
   * Unix timestamp of the subscription expiration date.
   * Provided by Telegram on recurring payments — use this as the authoritative expires_at.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  subscription_expiration_date?: number;
}

export class CancelStarSubscriptionDto {
  /** Telegram user ID whose subscription to cancel */
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  tg_id: number;
}

export class ToggleTelegramAutoRenewDto {
  /** Telegram user ID whose subscription should be updated */
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  tg_id: number;

  /** Whether renewal should remain enabled */
  @IsBoolean()
  auto_renew: boolean;
}

export class RefundStarPaymentDto {
  /** Telegram user ID to refund */
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  tg_id: number;

  /** The telegram_payment_charge_id to refund */
  @IsString()
  @IsNotEmpty()
  telegram_charge_id: string;
}

export class CreateCardInvoiceDto {
  /** Telegram user ID who is making the purchase */
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  tg_id: number;

  /** Plan name slug: basic | pro | ultra */
  @IsString()
  @IsNotEmpty()
  plan_name: string;

  /** Currency code (USD, EUR, GBP, etc.). Defaults to USD if omitted. */
  @IsOptional()
  @IsString()
  currency?: string;
}
