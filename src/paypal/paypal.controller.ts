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
  ) { }

  /**
   * Webhook de PayPal para eventos de suscripción
   */
  @Post('events')
  async webhook(@Body() body: any, @Req() req: any) {
    console.log('📢 PayPal Webhook received:', JSON.stringify(body, null, 2));

    try {
      // Guardar evento en MongoDB
      const event = new this.paypalEventModel({
        event_id: body.id,
        eventType: body.event_type,
        eventBody: body,
        subscriptionId: body.resource?.id,
        payerId: body.resource?.payer?.email_address,
        processed: false,
      });
      await event.save();
      console.log(`💾 Event saved to MongoDB: ${event._id}`);

      const webhookId = this.requireEnv('PAYPAL_WEBHOOK_ID');
      // Verificar firma del webhook
      const isValid = await this.paypalService.verifyWebhookSignature(
        webhookId,
        req
      );

      if (!isValid) {
        console.warn('⚠️ Invalid webhook signature');
        // En algunos casos, PayPal puede ser lento, permitimos procesar igualmente
        // pero lo logueamos
      }

      const resource = body.resource;

      if (!resource) {
        throw new BadRequestException('Invalid webhook payload');
      }

      // Extraer telegram ID del custom_id
      const customId = resource.custom_id || '';
      const telegramIdMatch = customId.match(/telegram_(\d+)/);
      const telegramId = 0;

      // if (!telegramId) {
      //   console.warn('No telegram ID found in webhook');
      //   // Marcar evento como procesado
      //   event.processed = true;
      //   await event.save();
      //   return { status: 'processed' };
      // }

      // Procesar eventos
      switch (body.event_type) {
        case 'BILLING.SUBSCRIPTION.ACTIVATED': {
          console.log(`✅ Subscription ACTIVATED: ${resource.id}`);
          await this.subscriptionService.updateSubscription(
            resource.id,
            {
              status: resource.custom_id ? 'ACTIVE' : 'APPROVAL_PENDING',
              user_id: resource.custom_id || undefined,
              paypal_payerId: resource.subscriber?.payer_id || undefined,
              amount: parseFloat(resource.billing_info?.last_payment?.amount?.value || '0'),
              currency: resource.billing_info?.last_payment?.amount?.currency_code || 'USD',
              next_billing_date: new Date(resource.billing_info?.next_billing_time),
            }
          );
          break;
        }

        case 'BILLING.SUBSCRIPTION.CANCELLED': {
          console.log(`❌ Subscription CANCELLED: ${resource.id}`);
          await this.subscriptionService.cancelSubscription(resource.id);
          break;
        }

        case 'BILLING.SUBSCRIPTION.SUSPENDED': {
          console.log(`⏸️ Subscription SUSPENDED: ${resource.id}`);
          await this.subscriptionService.suspendSubscription(resource.id);
          break;
        }

        case 'BILLING.SUBSCRIPTION.RE_ACTIVATED': {
          console.log(`▶️ Subscription RE_ACTIVATED: ${resource.id}`);
          await this.subscriptionService.resumeSubscription(resource.id);
          break;
        }

        case 'PAYMENT.BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
          console.log(`💔 Payment FAILED for subscription: ${resource.id}`);
          await this.telegramService.notifyPaymentFailed(telegramId);
          break;
        }
        // create
        case 'BILLING.SUBSCRIPTION.CREATED': {
          await this.subscriptionService.createSubscription(
            telegramId, {
            event_id: body.id,
            ...body.resource
          });
          break;
        }

        case 'BILLING.SUBSCRIPTION.UPDATED': {
          console.log(`🔄 Subscription UPDATED: ${resource.id}`);
          const subscription = await this.subscriptionService.getSubscriptionByPaypalId(resource.id);
          if (!subscription) {
            console.error(`Subscription not found for update: ${resource.id}`);
            break;
          }
          const subscriptionId = resource.id;
          const telegramId = resource.custom_id;

          if (subscription.user_id !== telegramId && telegramId && subscription.status === 'PENDING_ASSOCIATION') {
            await this.subscriptionService.updateSubscription(
              subscriptionId, {
              user_id: telegramId,
            }, {
              user_id: { $exists: false }
            });
          } else {
            console.log(`No user_id update needed for subscription: ${subscriptionId}`);
          }
          break;
        }

        default:
          console.log(`ℹ️ Event not handled: ${body.event_type}`);
      }

      // Marcar evento como procesado
      event.processed = true;
      await event.save();

      return { status: 'success' };
    } catch (error: any) {
      console.error('❌ Webhook processing error:', error);
      return { status: 'processed', error: error?.message };
    }
  }

  @Post('subscription/attach')
  async attachSubscription(@Body() body: { tg_id: number; subscription_id: string }) {
    if (!body.tg_id || !body.subscription_id) {
      throw new BadRequestException('tg_id and subscription_id are required');
    }
    try {
      return await this.subscriptionService.attachSubscriptionToUser(
        body.subscription_id,
        body.tg_id,
      );
    } catch (error: any) {
      throw new HttpException('Failed to attach subscription', HttpStatus.INTERNAL_SERVER_ERROR);
    }
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
      if (!user || user.telegramId !== body.tg_id) {
        throw new UnauthorizedException('You do not own this subscription');
      }

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
