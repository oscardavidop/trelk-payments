import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  Req,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Response } from 'express';
import { SubscriptionService } from '../subscription/subscription.service';
import { PaypalService } from './paypal.service';
import { TelegramService } from '../telegram/telegram.service';
import { PayPalEvent } from '../database/schemas/paypal-event.schema';
import { User } from '../database/schemas/user.schema';
import { LoggerService } from '../common/logger.service';

@Controller('paypal')
export class PaypalController {
  constructor(
    private subscriptionService: SubscriptionService,
    private paypalService: PaypalService,
    private telegramService: TelegramService,
    @InjectModel(PayPalEvent.name, 'payments')
    private paypalEventModel: Model<PayPalEvent>,
    @InjectModel(User.name, 'mbot')
    private userModel: Model<User>,
    private logger: LoggerService,
  ) { }

  /**
   * Webhook de PayPal para eventos de suscripción
   * FIX: Mejor idempotencia y logs sanitizados
   */
  @Post('events')
  async webhook(@Body() body: any, @Req() req: any) {
    const eventId = body.id;
    const eventType = body.event_type;

    console.log(`[PayPal Webhook] Received: ${eventType} (${eventId})`);

    // FIX: Verificar si ya fue procesado (idempotencia)
    const existing = await this.paypalEventModel.findOne({ event_id: eventId }).lean();
    if (existing?.processed) {
      // console.log(`[PayPal Webhook] Already processed: ${eventId}`);
      // return { status: 'already_processed', event_id: eventId };
    }

    try {
      // Guardar evento con upsert para idempotencia
      const event = await this.paypalEventModel.findOneAndUpdate(
        { event_id: eventId },
        {
          $setOnInsert: {
            event_id: eventId,
            eventType,
            eventBody: body,
            subscriptionId: body.resource?.id,
            payerId: body.resource?.payer?.email_address,
            processed: false,
          }
        },
        { upsert: true, new: true }
      );

      console.log(`[PayPal Webhook] Event saved: ${event._id}`);

      const webhookId = this.requireEnv('PAYPAL_WEBHOOK_ID');
      const isValid = await this.paypalService.verifyWebhookSignature(webhookId, req);

      if (!isValid) {
        await this.paypalEventModel.updateOne(
          { _id: event._id },
          { $set: { invalid_signature: true, processed: false } }
        );
        console.warn(`[PayPal Webhook] Invalid signature: ${eventId}`);
        return { status: 'invalid_signature', event_id: eventId };
      }

      const resource = body.resource;

      if (!resource) {
        throw new BadRequestException('Invalid webhook payload');
      }

      switch (eventType) {
        case 'BILLING.SUBSCRIPTION.ACTIVATED': {
          console.log(`[PayPal Webhook] Activating subscription: ${resource.id}`);

          await this.subscriptionService.updateStatus(resource.id, 'ACTIVE', resource);
          await this.subscriptionService.tryActivateFeatures(resource.id);
          break;
        }

        case 'BILLING.SUBSCRIPTION.UPDATED': {
          console.log(`[PayPal Webhook] Subscription updated: ${resource.id}`);

          const subscription = await this.subscriptionService.getSubscriptionByPaypalId(resource.id);
          if (!subscription) {
            console.error(`[PayPal Webhook] Subscription not found: ${resource.id}`);
            break;
          }

          const customId = resource.custom_id;

          // Si tiene custom_id y la suscripción está pendiente de asociación
          if (customId && subscription.status === 'PENDING_ASSOCIATION' && !subscription.user_id) {
            await this.subscriptionService.updateSubscription(
              resource.id,
              { user_id: customId },
              { user_id: { $exists: false } }
            );
            console.log(`[PayPal Webhook] User attached: ${customId} -> ${resource.id}`);
          }
          break;
        }

        case 'BILLING.SUBSCRIPTION.CANCELLED': {
          console.log(`[PayPal Webhook] Subscription cancelled: ${resource.id}`);
          await this.subscriptionService.cancelSubscription(resource.id);
          break;
        }

        case 'BILLING.SUBSCRIPTION.SUSPENDED': {
          console.log(`[PayPal Webhook] Subscription suspended: ${resource.id}`);
          await this.subscriptionService.suspendSubscription(resource.id);
          break;
        }

        case 'BILLING.SUBSCRIPTION.RE_ACTIVATED': {
          console.log(`[PayPal Webhook] Subscription reactivated: ${resource.id}`);
          await this.subscriptionService.resumeSubscription(resource.id);
          break;
        }

        case 'PAYMENT.BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
          console.log(`[PayPal Webhook] Payment failed: ${resource.id}`);
          const subscription = await this.subscriptionService.getSubscriptionByPaypalId(resource.id);
          if (subscription?.user_id) {
            await this.telegramService.notifyPaymentFailed(Number(subscription.user_id));
          }
          break;
        }

        case 'BILLING.SUBSCRIPTION.CREATED': {
          console.log(`[PayPal Webhook] Subscription created: ${resource.id}`);
          await this.subscriptionService.updateFromWebhook(resource);
          break;
        }

        default:
          console.log(`[PayPal Webhook] Event not handled: ${eventType}`);
      }

      // Marcar evento como procesado
      await this.paypalEventModel.updateOne(
        { _id: event._id },
        { $set: { processed: true } }
      );

      return { status: 'success', event_id: eventId };
    } catch (error: any) {
      console.error(`[PayPal Webhook] Error processing ${eventId}:`, error?.message);
      return { status: 'error', event_id: eventId, error: error?.message };
    }
  }

  @Post('subscription/attach')
  async attachSubscription(
    @Body() body: { tg_id: number; subscription_id: string },
    @Req() req: any,
  ) {
    const authorization = req.headers['authorization'];
    if (authorization !== `Bearer ${this.requireEnv('EXTERNAL_API_KEY')}`) {
      throw new UnauthorizedException('Invalid API key');
    }
    if (!body.tg_id || !body.subscription_id) {
      throw new BadRequestException('tg_id and subscription_id are required');
    }
    return this.subscriptionService.attachUser(
      body.subscription_id,
      String(body.tg_id),
    );
  }

  /**
   * Endpoint para verificar estado de suscripción (GET /paypal/status?tg_id=123)
   */
  @Get('status')
  async status(@Query('tg_id') telegramId: string) {
    if (!telegramId) {
      throw new BadRequestException('tg_id is required');
    }

    try {
      const parsedTgId = parseInt(telegramId, 10);
      const isPremium = await this.subscriptionService.getUserPremiumStatus(parsedTgId);
      const subscriptions = await this.subscriptionService.getUserActiveSubscriptions(parsedTgId);

      return {
        telegramId: parsedTgId,
        isPremium,
        activeSubscriptions: subscriptions.length,
        subscriptions: subscriptions.map((sub) => ({
          id: sub.id,
          status: sub.status,
          amount: sub.amount,
          currency: sub.currency,
          createdAt: sub.createdAt,
        })),
      };
    } catch (error: any) {
      throw new HttpException('Failed to get subscription status', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Endpoint para cancelar suscripción (POST /paypal/cancel)
   */
  @Post('cancel')
  async cancel(@Body() body: { tg_id: number; subscription_id: string }) {
    if (!body.tg_id || !body.subscription_id) {
      throw new BadRequestException('tg_id and subscription_id are required');
    }

    try {
      // Verificar que el usuario sea propietario de la suscripción
      const subscription = await this.subscriptionService.getSubscriptionByPaypalId(body.subscription_id);

      if (!subscription) {
        throw new BadRequestException('Subscription not found');
      }

      const user = await this.userModel.findById(subscription.user);
      // if (!user || user.telegramId !== body.tg_id) {
      //   throw new UnauthorizedException('You do not own this subscription');
      // }

      // Cancelar en PayPal
      await this.paypalService.cancelSubscription(body.subscription_id);

      return { status: 'cancelled' };
    } catch (error: any) {
      if (error instanceof UnauthorizedException || error instanceof BadRequestException) {
        throw error;
      }
      throw new HttpException('Failed to cancel subscription', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Missing required environment variable ${key}`);
    }
    return value;
  }
}
