import { IsInt, IsString, IsNotEmpty, IsUrl, Min, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class ReviseSubscriptionDto {
  @IsInt({ message: 'tg_id must be an integer' })
  @Min(1, { message: 'tg_id must be positive' })
  @Transform(({ value }) => Number(value))
  tg_id: number;

  /** PayPal subscription ID actual (I-...) */
  @IsString()
  @IsNotEmpty()
  @Matches(/^I-[A-Z0-9]{16,}$/, {
    message: 'subscription_id must be a valid PayPal subscription ID (I-...)',
  })
  subscription_id: string;

  /** Nuevo plan (P-...) al que se quiere cambiar */
  @IsString()
  @IsNotEmpty()
  @Matches(/^P-[A-Z0-9]{16,}$/, {
    message: 'new_plan_id must be a valid PayPal plan ID (P-...)',
  })
  new_plan_id: string;

  /** URL de retorno después de que el usuario aprueba la revisión */
  @IsUrl({ require_tld: false }, { message: 'return_url must be a valid URL' })
  return_url: string;

  /** URL de cancelación si el usuario abandona el flujo */
  @IsUrl({ require_tld: false }, { message: 'cancel_url must be a valid URL' })
  cancel_url: string;
}
