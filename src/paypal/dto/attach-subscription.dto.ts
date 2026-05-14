import { IsNotEmpty, IsString, IsInt, Min, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class AttachSubscriptionDto {
  @IsInt({ message: 'tg_id must be an integer' })
  @Min(1, { message: 'tg_id must be positive' })
  @Transform(({ value }) => Number(value))
  tg_id: number;

  /**
   * PayPal subscription IDs siguen el patrón I-XXXXXXXXXXXXXXXX
   * Validamos el formato para evitar injection y reducir superficie de ataque.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^I-[A-Z0-9]{16,}$/, {
    message: 'subscription_id must be a valid PayPal subscription ID (I-...)',
  })
  subscription_id: string;
}
