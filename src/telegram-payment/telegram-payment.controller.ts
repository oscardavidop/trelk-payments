import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { TelegramPaymentService } from './telegram-payment.service';
import { CreateStarsInvoiceDto, StarsPaymentWebhookDto } from './dto/create-stars-invoice.dto';
import { LoggerService } from '../common/logger.service';

@Controller('telegram-payment')
export class TelegramPaymentController {
  private readonly logger = new Logger(TelegramPaymentController.name);

  constructor(
    private readonly telegramPaymentService: TelegramPaymentService,
    private readonly loggerService: LoggerService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // CREATE STARS INVOICE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /telegram-payment/invoice/create
   *
   * Creates a Telegram Stars invoice link for the given plan.
   * Called by the app backend when the user selects "Pay with Stars".
   *
   * Returns { invoiceUrl } — the Mini App passes this to openInvoice().
   * Protected by internal API key.
   */
  @Post('invoice/create')
  async createInvoice(@Body() body: CreateStarsInvoiceDto, @Req() req: any) {
    this.requireApiKey(req);

    if (!body.tg_id || !body.plan_name) {
      throw new BadRequestException('tg_id and plan_name are required');
    }

    try {
      const result = await this.telegramPaymentService.createStarsInvoice(
        body.tg_id,
        body.plan_name,
      );

      this.logger.log(
        `Stars invoice created: tg_id=${body.tg_id}, plan=${result.planName}, stars=${result.starsAmount}`,
      );

      return {
        ok: true,
        invoiceUrl: result.invoiceUrl,
        planName: result.planName,
        starsAmount: result.starsAmount,
        priceUsd: result.priceUsd,
      };
    } catch (err: any) {
      if (err instanceof BadRequestException || err.status === 404) throw err;
      this.logger.error(`Failed to create Stars invoice: ${err?.message}`);
      throw new HttpException('Failed to create invoice', HttpStatus.BAD_GATEWAY);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PAYMENT WEBHOOK (from bot successful_payment handler)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /telegram-payment/payment/webhook
   *
   * Called by the Trelk bot after receiving a `successful_payment` update.
   * Activates the user's Stars subscription.
   *
   * Idempotent: duplicate telegram_charge_id calls return the same result.
   * Protected by internal API key.
   */
  @Post('payment/webhook')
  async paymentWebhook(@Body() body: StarsPaymentWebhookDto, @Req() req: any) {
    this.requireApiKey(req);

    this.logger.log(
      `Stars payment webhook: tg_id=${body.tg_id}, charge=${body.telegram_charge_id}`,
    );

    try {
      const result = await this.telegramPaymentService.handleSuccessfulPayment({
        tgId: body.tg_id,
        telegramChargeId: body.telegram_charge_id,
        invoicePayload: body.invoice_payload,
        totalAmount: body.total_amount,
      });

      return { ok: true, subscriptionId: result.subscriptionId, accessUntil: result.accessUntil };
    } catch (err: any) {
      if (err instanceof BadRequestException || err.status === 404) throw err;
      this.logger.error(`Stars payment webhook failed: ${err?.message}`);
      throw new HttpException('Payment processing failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  private requireApiKey(req: any): void {
    const authorization = req.headers['authorization'] as string | undefined;
    const expectedKey = `Bearer ${this.getEnv('EXTERNAL_API_KEY')}`;

    if (!this.safeEqual(authorization ?? '', expectedKey)) {
      throw new UnauthorizedException('Invalid API key');
    }
  }

  private getEnv(key: string): string {
    const value = process.env[key];
    if (!value) throw new Error(`Missing required env var: ${key}`);
    return value;
  }

  /** Timing-safe string comparison — prevents timing attacks */
  private safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }
}
