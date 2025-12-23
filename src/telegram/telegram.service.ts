import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TelegramService {
  private readonly botToken: string;
  private readonly apiUrl: string;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }

    this.botToken = token;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  /**
   * Envía un mensaje a un usuario de Telegram
   */
  async sendMessage(chatId: number, text: string, parseMode: 'HTML' | 'Markdown' = 'HTML'): Promise<void> {
    try {
      await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      });

      console.log(`📤 Message sent to ${chatId}`);
    } catch (error: any) {
      console.error(`❌ Error sending message to ${chatId}:`, error?.response?.data || error?.message);
    }
  }

  /**
   * Envía un mensaje con botones inline
   */
  async sendMessageWithButtons(
    chatId: number,
    text: string,
    buttons: Array<Array<{ text: string; url?: string; callback_data?: string }>>,
    parseMode: 'HTML' | 'Markdown' = 'HTML',
  ): Promise<void> {
    try {
      await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        reply_markup: {
          inline_keyboard: buttons,
        },
      });

      console.log(`📤 Message with buttons sent to ${chatId}`);
    } catch (error: any) {
      console.error(`❌ Error sending message to ${chatId}:`, error?.response?.data || error?.message);
    }
  }

  /**
   * Envía una notificación de suscripción activada
   */
  async notifySubscriptionActivated(chatId: number, planName: string): Promise<void> {
    const text = `✅ <b>¡Suscripción Activada!</b>\n\n` +
      `Plan: ${planName}\n` +
      `Tu acceso premium está ahora activo.\n\n` +
      `¡Gracias por tu compra!`;

    await this.sendMessage(chatId, text);
  }

  /**
   * Envía una notificación de pago fallido
   */
  async notifyPaymentFailed(chatId: number): Promise<void> {
    const text = `❌ <b>Pago Fallido</b>\n\n` +
      `No pudimos procesar tu pago.\n` +
      `Por favor, intenta nuevamente o contacta a soporte.`;

    await this.sendMessage(chatId, text);
  }

  /**
   * Envía una notificación de suscripción cancelada
   */
  async notifySubscriptionCancelled(chatId: number): Promise<void> {
    const text = `❌ <b>Suscripción Cancelada</b>\n\n` +
      `Tu suscripción ha sido cancelada.\n` +
      `Si fue un error, puedes reactivarla en cualquier momento.`;

    await this.sendMessage(chatId, text);
  }
}
