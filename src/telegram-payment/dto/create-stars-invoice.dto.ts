import { IsString, IsNotEmpty, IsInt, IsPositive, IsOptional } from 'class-validator';
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

  /** The payload we sent when creating the invoice (contains tgId + planName) */
  @IsString()
  @IsNotEmpty()
  invoice_payload: string;

  /** Total stars paid */
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  total_amount: number;
}
