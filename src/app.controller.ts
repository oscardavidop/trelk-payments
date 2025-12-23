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
import { Response } from 'express';
import { SubscriptionService } from './subscription/subscription.service';
import { PaypalService } from './paypal/paypal.service';
// import { TelegramService } from './telegram/telegram.service';

@Controller('')
export class AppController {
  constructor(
    private subscriptionService: SubscriptionService,
    private paypalService: PaypalService,
    // private telegramService: TelegramService,
  ) {}

  /**
   * Página para iniciar suscripción (GET /paypal/subscribe?tg_id=123)
   */
  @Get('')
  async subscribe( @Res() res: Response) {

    try {
      const paypalClientId = this.requireEnv('PAYPAL_CLIENT_ID');
      const planId = this.requireEnv('PAYPAL_PLAN_ID');
      const baseUrl = process.env.BASE_URL ?? 'http://localhost:3001';

      // Verificar o crear usuario

      // Renderizar página HTML con SDK de PayPal
      const html = ``.replace('TU_CLIENT_ID', paypalClientId)

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.sendFile("/home/trelkbot17/tg-paypal-bot/public/index.html");
    } catch (error: any) {
      console.error('Error rendering subscribe page:', error?.message || error);
      throw new HttpException('Failed to render subscription page', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Confirma la suscripción (GET /paypal/success?subscription_id=I-XXX&tg_id=123)
   */
//   @Get('success')
//   async success(
//     @Query('subscription_id') subscriptionId: string,
//     @Query('tg_id') telegramId: string,
//     @Res() res: Response,
//   ) {
//     if (!subscriptionId || !telegramId) {
//       throw new BadRequestException('subscription_id and tg_id are required');
//     }

//     try {
//       const parsedTgId = parseInt(telegramId, 10);
//       const planId = this.requireEnv('PAYPAL_PLAN_ID');

//       // Guardar suscripción en la base de datos (pendiente de activación por webhook)
//       await this.subscriptionService.createSubscription(
//         parsedTgId,
//         subscriptionId,
//         planId,
//         10.0,
//         'USD',
//       );

//       // Renderizar página de éxito
//       const html = `
// <!DOCTYPE html>
// <html lang="es">
// <head>
//   <meta charset="UTF-8">
//   <meta name="viewport" content="width=device-width, initial-scale=1.0">
//   <title>¡Suscripción Confirmada!</title>
//   <style>
//     * { margin: 0; padding: 0; box-sizing: border-box; }
//     body {
//       font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
//       background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
//       min-height: 100vh;
//       display: flex;
//       align-items: center;
//       justify-content: center;
//       padding: 20px;
//     }
//     .container {
//       background: white;
//       border-radius: 12px;
//       box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
//       padding: 40px;
//       max-width: 500px;
//       width: 100%;
//       text-align: center;
//     }
//     .icon {
//       font-size: 60px;
//       margin-bottom: 20px;
//     }
//     h1 {
//       color: #333;
//       margin-bottom: 10px;
//       font-size: 28px;
//     }
//     .message {
//       color: #666;
//       font-size: 16px;
//       line-height: 1.6;
//       margin-bottom: 30px;
//     }
//     .steps {
//       text-align: left;
//       background: #f8f9fa;
//       border-radius: 8px;
//       padding: 20px;
//       margin-bottom: 30px;
//     }
//     .steps h3 {
//       color: #333;
//       margin-bottom: 15px;
//     }
//     .step {
//       display: flex;
//       align-items: flex-start;
//       margin-bottom: 12px;
//       color: #555;
//     }
//     .step-number {
//       display: inline-block;
//       width: 24px;
//       height: 24px;
//       background: #667eea;
//       color: white;
//       border-radius: 50%;
//       text-align: center;
//       line-height: 24px;
//       font-weight: bold;
//       margin-right: 12px;
//       flex-shrink: 0;
//       font-size: 14px;
//     }
//     .btn {
//       display: inline-block;
//       background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
//       color: white;
//       padding: 12px 30px;
//       border-radius: 6px;
//       text-decoration: none;
//       font-weight: bold;
//       border: none;
//       cursor: pointer;
//       font-size: 16px;
//     }
//     .btn:hover {
//       transform: translateY(-2px);
//       box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
//     }
//     .info {
//       text-align: center;
//       color: #999;
//       font-size: 12px;
//       padding-top: 20px;
//       border-top: 1px solid #eee;
//     }
//   </style>
// </head>
// <body>
//   <div class="container">
//     <div class="icon">✅</div>
//     <h1>¡Suscripción Confirmada!</h1>
//     <p class="message">
//       Tu pago ha sido procesado. En pocos momentos recibirás una confirmación en Telegram.
//     </p>

//     <div class="steps">
//       <h3>Próximos pasos:</h3>
//       <div class="step">
//         <span class="step-number">1</span>
//         <span>Vuelve a Telegram</span>
//       </div>
//       <div class="step">
//         <span class="step-number">2</span>
//         <span>Presiona el botón /premium para confirmar tu acceso</span>
//       </div>
//       <div class="step">
//         <span class="step-number">3</span>
//         <span>¡Disfruta de tu plan premium!</span>
//       </div>
//     </div>

//     <button class="btn" onclick="window.location.href='tg://user?id=${parsedTgId}'">
//       Volver a Telegram
//     </button>

//     <div class="info">
//       <p>Se te envió un mensaje por Telegram cuando tu suscripción sea activada.</p>
//     </div>
//   </div>
// </body>
// </html>
//       `;

//       res.setHeader('Content-Type', 'text/html; charset=utf-8');
//       res.send(html);
//     } catch (error: any) {
//       console.error('Error processing subscription:', error?.message || error);
//       throw new HttpException('Failed to process subscription', HttpStatus.INTERNAL_SERVER_ERROR);
//     }
//   }

  /**
   * Webhook de PayPal para eventos de suscripción
   */
  // @Post('webhook')
  // async webhook(@Body() body: any, @Req() req: any) {
  //   console.log('📢 PayPal Webhook received:', body.event_type);

  //   try {
  //     const webhookId = this.requireEnv('PAYPAL_WEBHOOK_ID');
  //     // Verificar firma del webhook
  //     const isValid = await this.paypalService.verifyWebhookSignature(
  //       webhookId,
  //       req
  //     );

  //     if (!isValid) {
  //       console.warn('⚠️ Invalid webhook signature');
  //       // En algunos casos, PayPal puede ser lento, permitimos procesar igualmente
  //       // pero lo logueamos
  //     }

  //     const resource = body.resource;

  //     if (!resource) {
  //       throw new BadRequestException('Invalid webhook payload');
  //     }

  //     // Extraer telegram ID del custom_id
  //     const customId = resource.custom_id || '';
  //     const telegramIdMatch = customId.match(/telegram_(\d+)/);
  //     const telegramId = telegramIdMatch ? parseInt(telegramIdMatch[1], 10) : null;

  //     if (!telegramId) {
  //       console.warn('No telegram ID found in webhook');
  //       return { status: 'processed' };
  //     }

  //     // Procesar eventos
  //     switch (body.event_type) {
  //       case 'BILLING.SUBSCRIPTION.ACTIVATED': {
  //         console.log(`✅ Subscription ACTIVATED: ${resource.id}`);
  //         await this.subscriptionService.activateSubscription(
  //           resource.id,
  //           resource.payer.payer_info?.email || 'unknown',
  //           parseFloat(resource.billing_cycles?.[0]?.pricing_scheme?.fixed_price?.value || '0'),
  //           resource.billing_cycles?.[0]?.pricing_scheme?.fixed_price?.currency_code || 'USD',
  //         );
  //         break;
  //       }

  //       case 'BILLING.SUBSCRIPTION.CANCELLED': {
  //         console.log(`❌ Subscription CANCELLED: ${resource.id}`);
  //         await this.subscriptionService.cancelSubscription(resource.id);
  //         break;
  //       }

  //       case 'BILLING.SUBSCRIPTION.SUSPENDED': {
  //         console.log(`⏸️ Subscription SUSPENDED: ${resource.id}`);
  //         await this.subscriptionService.suspendSubscription(resource.id);
  //         break;
  //       }

  //       case 'BILLING.SUBSCRIPTION.RE_ACTIVATED': {
  //         console.log(`▶️ Subscription RE_ACTIVATED: ${resource.id}`);
  //         await this.subscriptionService.resumeSubscription(resource.id);
  //         break;
  //       }

  //       case 'PAYMENT.BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
  //         console.log(`💔 Payment FAILED for subscription: ${resource.id}`);
  //         // await this.telegramService.notifyPaymentFailed(telegramId);
  //         break;
  //       }

  //       default:
  //         console.log(`ℹ️ Event not handled: ${body.event_type}`);
  //     }

  //     return { status: 'success' };
  //   } catch (error: any) {
  //     console.error('❌ Webhook processing error:', error?.message || error);
  //     return { status: 'processed', error: error?.message };
  //   }
  // }

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
          // id: sub.paypalSubscriptionId,
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

      const user = await this.subscriptionService['userModel'].findById(subscription.user);
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
