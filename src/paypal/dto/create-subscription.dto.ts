import { IsInt, IsString, IsNotEmpty, IsUrl, Min, Matches, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateSubscriptionDto {
  @IsInt({ message: 'tg_id must be an integer' })
  @Min(1, { message: 'tg_id must be positive' })
  @Transform(({ value }) => Number(value))
  tg_id: number;

  /**
   * PayPal plan IDs siguen el patrón P-XXXXXXXXXXXXXXXX
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^P-[A-Z0-9]{16,}$/, {
    message: 'plan_id must be a valid PayPal plan ID (P-...)',
  })
  plan_id: string;

  /** URL de retorno después de que el usuario aprueba en PayPal */
  @IsUrl({ require_tld: false }, { message: 'return_url must be a valid URL' })
  return_url: string;

  /** URL de cancelación si el usuario abandona el flujo en PayPal */
  @IsUrl({ require_tld: false }, { message: 'cancel_url must be a valid URL' })
  cancel_url: string;
}
