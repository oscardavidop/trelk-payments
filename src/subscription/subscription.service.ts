import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../database/schemas/user.schema';
import { Subscription } from '../database/schemas/subscription.schema';
import { PaypalService } from '../paypal/paypal.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectModel(User.name, 'mbot')
    private userModel: Model<User>,
    @InjectModel(Subscription.name, 'payments')
    private subscriptionModel: Model<Subscription>,
    private paypalService: PaypalService,
    private telegramService: TelegramService,
  ) { }

  /**
   * Obtiene o crea un usuario por telegram ID
   */
  async getOrCreateUser(telegramId: number, userData?: any): Promise<User> {
    let user = await this.userModel.findOne({ id: telegramId });

    if (!user) {
      user = new this.userModel({
        telegramId,
        telegramUsername: userData?.username,
        firstName: userData?.first_name,
        lastName: userData?.last_name,
        tier: 'free',
        isPremium: false,
        subscriptions: [],
      });

      await user.save();
    }

    return user;
  }

  /**
   * Obtiene un usuario por telegram ID
   */
  async getUserByTelegramId(telegramId: number): Promise<User | null> {
    return this.userModel.findOne({ telegramId }).populate('subscriptions');
  }

  /**
   * Obtiene una suscripción por ID de PayPal
   */
  async getSubscriptionByPaypalId(paypalSubscriptionId: string): Promise<Subscription | null> {
    return this.subscriptionModel.findOne({ id: paypalSubscriptionId }).populate('user');
  }

  /**
   * Activa una suscripción
   */
  async activateSubscription(
    subscriptionId: string
  ): Promise<void> {
    const subscription = await this.subscriptionModel
      .findOne({ id: subscriptionId })
      .populate('user');

    if (!subscription) {
      console.error(`Subscription not found: ${subscriptionId}`);
      return;
    }

    console.log(`Activating subscription ${subscriptionId}...`, subscription);

    

    // Actualizar usuario
    // const user = await this.userModel.findById(subscription.user);
    // if (user) {
    //   user.isPremium = true;
    //   user.tier = 'premium';
    //   user.paypalPayerId = paypalPayerId;
    //   await user.save();

    //   // Notificar al usuario
    //   await this.telegramService.sendMessage(user.telegramId, '✅ ¡Suscripción activada! Ahora tienes acceso Premium.');
    // }

    // console.log(`✅ Subscription activated for user ${(subscription.user as any).telegramId}: ${subscriptionId}`);
  }

  /**
   * Cancela una suscripción
   */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionModel
      .findOne({ paypalSubscriptionId: subscriptionId })
      .populate('user');

    if (!subscription) {
      console.error(`Subscription not found: ${subscriptionId}`);
      return;
    }

    // Actualizar suscripción
    subscription.status = 'CANCELLED';
    subscription.cancelledAt = new Date();

    await subscription.save();

    // Actualizar usuario
    const user = await this.userModel.findById(subscription.user);
    if (user) {
      user.isPremium = false;
      user.tier = 'free';
      await user.save();

      // Notificar al usuario
      await this.telegramService.sendMessage(user.telegramId, '❌ Tu suscripción ha sido cancelada.');
    }

    console.log(`❌ Subscription cancelled for user ${(subscription.user as any).telegramId}: ${subscriptionId}`);
  }

  /**
   * Suspende una suscripción
   */
  async suspendSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionModel
      .findOne({ paypalSubscriptionId: subscriptionId })
      .populate('user');

    if (!subscription) {
      return;
    }

    subscription.status = 'SUSPENDED';
    await subscription.save();

    const user = await this.userModel.findById(subscription.user);
    if (user) {
      user.isPremium = false;
      await user.save();

      await this.telegramService.sendMessage(user.telegramId, '⏸️ Tu suscripción ha sido suspendida.');
    }

    console.log(`⏸️ Subscription suspended for user ${(subscription.user as any).telegramId}: ${subscriptionId}`);
  }

  /**
   * Reanuda una suscripción
   */
  async resumeSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionModel
      .findOne({ paypalSubscriptionId: subscriptionId })
      .populate('user');

    if (!subscription) {
      return;
    }

    // Validar con PayPal
    const paypalSub = await this.paypalService.getSubscription(subscriptionId);

    if (paypalSub.status === 'ACTIVE') {
      subscription.status = 'ACTIVE';
      await subscription.save();

      const user = await this.userModel.findById(subscription.user);
      if (user) {
        user.isPremium = true;
        await user.save();

        await this.telegramService.sendMessage(user.telegramId, '▶️ Tu suscripción ha sido reactivada.');
      }

      console.log(`▶️ Subscription resumed for user ${(subscription.user as any).telegramId}: ${subscriptionId}`);
    }
  }

  /**
   * Crea una nueva suscripción (después de que PayPal aprueba)
   */
  async createSubscription(
    telegramId: number,
    data: any,
  ): Promise<Subscription> {
    // const user = await this.getOrCreateUser(telegramId);

    const subscription = new this.subscriptionModel({
      user_id: telegramId,
      ...data
    });

    await subscription.save();

    // Agregar subscription al usuario
    // user.subscriptions.push(subscription._id);
    // await user.save();

    return subscription;
  }

  /**
   * Obtiene el estado premium del usuario
   */
  async getUserPremiumStatus(telegramId: number): Promise<boolean> {
    const user = await this.userModel.findOne({ telegramId });
    return user?.isPremium || false;
  }

  /**
   * Obtiene todas las suscripciones activas de un usuario
   */
  async getUserActiveSubscriptions(telegramId: number): Promise<Subscription[]> {
    const user = await this.userModel.findOne({ telegramId }).populate('subscriptions');

    if (!user) return [];

    const subscriptions = user.subscriptions as any[];
    return subscriptions.filter((sub) => sub.status === 'ACTIVE');
  }

  async attachSubscriptionToUser(paypalSubscriptionId: string, telegramId: number): Promise<any> {
    console.log(`Attaching subscription ${paypalSubscriptionId} to user ${telegramId}`);
    try {
      const subscription = await this.paypalService.subscriptionsController.getSubscription({ id: paypalSubscriptionId });
      if (!subscription) {
        throw new Error('Subscription not found');
      }
      await this.paypalService.subscriptionsController.patchSubscription({
        id: paypalSubscriptionId,
        body: [
          {
            op: 'replace',
            path: '/custom_id',
            value: telegramId.toString(),
          } as any,
        ]
      })

      return {
        ok: true,
      }

    } catch (error: any) {
      throw error.message;
    }

  }

  async updateSubscription(subscriptionId: string, data: any, otherFilters: any = {}): Promise<void> {
    const subscription = await this.subscriptionModel
      .findOne({ id: subscriptionId, ...otherFilters })
    if (!subscription) {
      console.error(`Subscription not found: ${subscriptionId}`);
      return;
    }

    // Actualizar suscripción
    Object.assign(subscription, data);
    await subscription.save();

    // console.log(`🔄 Subscription updated for user ${(subscription.user as any).telegramId}: ${subscriptionId}`);
  }


}
