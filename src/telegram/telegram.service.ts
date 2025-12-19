import { Injectable } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { Context } from 'telegraf/typings/context';

@Injectable()
export class TelegramService {
  private bot: Telegraf<Context>;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }

    this.bot = new Telegraf(token);
    this.setupHandlers();
  }

  /**
   * Configura los handlers del bot
   */
  private setupHandlers() {
    // Handler para el comando /start
    this.bot.command('start', async (ctx) => {
      const userId = ctx.from.id;
      const firstName = ctx.from.first_name || 'Usuario';

      await ctx.reply(
        `¡Hola ${firstName}! 👋\n\n` +
        `Bienvenido a nuestro bot. Aquí puedes acceder a contenido premium.\n\n` +
        `Usa /premium para obtener acceso ilimitado.`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '👑 Ir a Premium',
                  callback_data: 'go_premium',
                },
              ],
            ],
          },
        },
      );
    });

    // Handler para el comando /premium
    this.bot.command('premium', async (ctx) => {
      await this.sendPremiumButton(ctx);
    });

    // Handler para el comando /status
    this.bot.command('status', async (ctx) => {
      const isPremium = (ctx as any)?.session?.isPremium || false;
      const status = isPremium ? '✅ Premium Activo' : '⚠️ Plan Gratuito';

      await ctx.reply(`Tu estado actual: ${status}`);
    });

    // Handler para callbacks
    this.bot.action('go_premium', async (ctx) => {
      await this.sendPremiumButton(ctx);
    });
  }

  /**
   * Inicia el bot
   */
  async start() {
    await this.bot.launch();
    console.log('✅ Telegram bot started');
  }

  /**
   * Detiene el bot
   */
  async stop() {
    await this.bot.stop();
  }

  /**
   * Obtiene la instancia del bot
   */
  getBot(): Telegraf<Context> {
    return this.bot;
  }

  /**
   * Envía un botón de suscripción premium
   */
  async sendPremiumButton(ctx: Context, chatId?: number) {
    const telegramId = chatId || ctx.from?.id;
    const subscriptionUrl = `${process.env.BASE_URL}/paypal/subscribe?tg_id=${telegramId}`;

    await ctx.reply(
      '🎁 Acceso Premium\n\n' +
      '💰 $10 USD / mes\n' +
      '✨ Contenido exclusivo\n' +
      '⚡ Velocidad prioritaria\n' +
      '🎯 Soporte prioritario\n\n' +
      'Haz clic en el botón para suscribirte con PayPal',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '💳 Suscribirme con PayPal',
                url: subscriptionUrl,
              },
            ],
          ],
        },
      },
    );
  }

  /**
   * Envía un mensaje al usuario
   */
  async sendMessage(telegramId: number, text: string, keyboard?: any) {
    try {
      await this.bot.telegram.sendMessage(telegramId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (error: any) {
      console.error(`Error sending message to ${telegramId}:`, error?.message);
    }
  }

  /**
   * Notifica al usuario que su suscripción se activó
   */
  async notifySubscriptionActivated(telegramId: number, planName: string = 'Premium') {
    const message =
      `✅ ¡Suscripción confirmada!\n\n` +
      `🎉 Tu plan "${planName}" está ahora activo.\n` +
      `🗓️ Se renovará automáticamente cada mes.\n\n` +
      `¿Necesitas ayuda? Escribe /help`;

    await this.sendMessage(telegramId, message);
  }

  /**
   * Notifica que la suscripción fue cancelada
   */
  async notifySubscriptionCancelled(telegramId: number) {
    const message =
      `❌ Tu suscripción ha sido cancelada.\n\n` +
      `Lamentamos verte partir. Si cambias de opinión, escribe /premium para reactivar.`;

    await this.sendMessage(telegramId, message);
  }

  /**
   * Notifica que el pago falló
   */
  async notifyPaymentFailed(telegramId: number) {
    const message =
      `⚠️ Error en el pago\n\n` +
      `No pudimos procesar tu pago. Intenta de nuevo.`;

    await this.sendMessage(telegramId, message);
  }

  /**
   * Envía información de ayuda
   */
  async sendHelp(telegramId: number) {
    const message =
      `📚 Ayuda\n\n` +
      `/start - Mostrar bienvenida\n` +
      `/premium - Ver opciones premium\n` +
      `/status - Ver tu estado de suscripción\n` +
      `/help - Mostrar esta ayuda\n\n` +
      `¿Problemas? Contacta a: @soporte`;

    await this.sendMessage(telegramId, message);
  }
}
