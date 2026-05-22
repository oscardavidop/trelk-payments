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
import {
  CreateStarsInvoiceDto,
  StarsPaymentWebhookDto,
  CancelStarSubscriptionDto,
  RefundStarPaymentDto,
  CreateCardInvoiceDto,
} from './dto/create-stars-invoice.dto';
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

  /**
   * POST /telegram-payment/invoice/create-card
   *
   * Creates a Telegram credit card invoice link for the given plan.
   * Called by the app backend when the user selects "Pay with Credit Card".
   *
   * Returns { invoiceUrl } — the Mini App passes this to openInvoice().
   * Protected by internal API key.
   * 
   * Supports any currency configured in the plan (USD, EUR, GBP, etc.).
   */
  @Post('invoice/create-card')
  async createCardInvoice(@Body() body: CreateCardInvoiceDto, @Req() req: any) {
    this.requireApiKey(req);

    if (!body.tg_id || !body.plan_name) {
      throw new BadRequestException('tg_id and plan_name are required');
    }

    try {
      const result = await this.telegramPaymentService.createCardInvoice(
        body.tg_id,
        body.plan_name,
      );

      this.logger.log(
        `Card invoice created: tg_id=${body.tg_id}, plan=${result.planName}, price=${result.priceUsd} ${result.currency}`,
      );

      return {
        ok: true,
        invoiceUrl: result.invoiceUrl,
        planName: result.planName,
        priceUsd: result.priceUsd,
        currency: result.currency,
        amountCents: result.amountCents,
      };
    } catch (err: any) {
      if (err instanceof BadRequestException || err.status === 404) throw err;
      this.logger.error(`Failed to create Card invoice: ${err?.message}`);
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
      `Telegram payment webhook: tg_id=${body.tg_id}, method=${body.method ?? 'telegram_stars'}, currency=${body.currency ?? 'XTR'}, charge=${body.telegram_charge_id}`,
    );

    try {
      const result = await this.telegramPaymentService.handleSuccessfulPayment({
        tgId: body.tg_id,
        telegramChargeId: body.telegram_charge_id,
        invoicePayload: body.invoice_payload,
        totalAmount: body.total_amount,
        method: body.method,
        currency: body.currency,
        isFirstRecurring: body.is_first_recurring,
        isRecurring: body.is_recurring,
        subscriptionExpirationDate: body.subscription_expiration_date,
      });

      return { ok: true, subscriptionId: result.subscriptionId, accessUntil: result.accessUntil };
    } catch (err: any) {
      if (err instanceof BadRequestException || err.status === 404) throw err;
      this.logger.error(`Stars payment webhook failed: ${err?.message}`);
      throw new HttpException('Payment processing failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CANCEL RECURRING SUBSCRIPTION
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /telegram-payment/subscription/cancel
   *
   * Cancels a user's Telegram Stars recurring subscription at the end of
   * the current billing period. The user retains access until expires_at.
   */
  @Post('subscription/cancel')
  async cancelSubscription(@Body() body: CancelStarSubscriptionDto, @Req() req: any) {
    this.requireApiKey(req);

    try {
      const result = await this.telegramPaymentService.cancelStarSubscription(body.tg_id);
      return result;
    } catch (err: any) {
      if (err.status === 404 || err instanceof BadRequestException) throw err;
      this.logger.error(`Stars cancel failed: ${err?.message}`);
      throw new HttpException('Failed to cancel subscription', HttpStatus.BAD_GATEWAY);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REFUND (admin / paysupport)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /telegram-payment/refund
   *
   * Issues a Telegram Stars refund for a given charge.
   * This endpoint is intended for admin/support use in response to
   * /paysupport requests.
   */
  @Post('refund')
  async refund(@Body() body: RefundStarPaymentDto, @Req() req: any) {
    this.requireApiKey(req);

    try {
      const result = await this.telegramPaymentService.refundStarPayment(
        body.tg_id,
        body.telegram_charge_id,
      );
      return result;
    } catch (err: any) {
      this.logger.error(`Stars refund failed: ${err?.message}`);
      throw new HttpException('Refund failed', HttpStatus.BAD_GATEWAY);
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
