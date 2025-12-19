import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { User, Subscription } from '../database/entities';
import { PaypalService } from '../paypal/paypal.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    private paypalService: PaypalService,
    private telegramService: TelegramService,
  ) {}

  /**
   * Obtiene o crea un usuario por telegram ID
   */
  async getOrCreateUser(telegramId: number, userData?: any): Promise<User> {
    let user = await this.userRepository.findOne({
      where: { telegramId },
    });

    if (!user) {
      user = this.userRepository.create({
        telegramId,
        telegramUsername: userData?.username,
        firstName: userData?.first_name,
        lastName: userData?.last_name,
        tier: 'free',
        isPremium: false,
      });

      await this.userRepository.save(user);
    }

    return user;
  }

  /**
   * Obtiene un usuario por telegram ID
   */
  async getUserByTelegramId(telegramId: number): Promise<User | null> {
    return this.userRepository.findOne({
      where: { telegramId },
      relations: ['subscriptions'],
    });
  }

  /**
   * Obtiene una suscripción por ID de PayPal
   */
  async getSubscriptionByPaypalId(paypalSubscriptionId: string): Promise<Subscription | null> {
    return this.subscriptionRepository.findOne({
      where: { paypalSubscriptionId },
      relations: ['user'],
    });
  }

  /**
   * Activa una suscripción
   */
  async activateSubscription(
    subscriptionId: string,
    paypalPayerId: string,
    amount: number,
    currency: string,
  ): Promise<void> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { paypalSubscriptionId: subscriptionId },
      relations: ['user'],
    });

    if (!subscription) {
      console.error(`Subscription not found: ${subscriptionId}`);
      return;
    }

    // Actualizar suscripción
    subscription.status = 'ACTIVE';
    subscription.paypalPayerId = paypalPayerId;
    subscription.amount = amount;
    subscription.currency = currency;

    await this.subscriptionRepository.save(subscription);

    // Actualizar usuario
    const user = subscription.user;
    user.isPremium = true;
    user.tier = 'premium';
    user.paypalPayerId = paypalPayerId;

    await this.userRepository.save(user);

    // Notificar al usuario
    await this.telegramService.notifySubscriptionActivated(user.telegramId, 'Premium Mensual');

    console.log(`✅ Subscription activated for user ${user.telegramId}: ${subscriptionId}`);
  }

  /**
   * Cancela una suscripción
   */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { paypalSubscriptionId: subscriptionId },
      relations: ['user'],
    });

    if (!subscription) {
      console.error(`Subscription not found: ${subscriptionId}`);
      return;
    }

    // Actualizar suscripción
    subscription.status = 'CANCELLED';
    subscription.cancelledAt = new Date();

    await this.subscriptionRepository.save(subscription);

    // Actualizar usuario
    const user = subscription.user;
    user.isPremium = false;
    user.tier = 'free';

    await this.userRepository.save(user);

    // Notificar al usuario
    await this.telegramService.notifySubscriptionCancelled(user.telegramId);

    console.log(`❌ Subscription cancelled for user ${user.telegramId}: ${subscriptionId}`);
  }

  /**
   * Suspende una suscripción
   */
  async suspendSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { paypalSubscriptionId: subscriptionId },
      relations: ['user'],
    });

    if (!subscription) {
      return;
    }

    subscription.status = 'SUSPENDED';
    await this.subscriptionRepository.save(subscription);

    const user = subscription.user;
    user.isPremium = false;

    await this.userRepository.save(user);

    console.log(`⏸️ Subscription suspended for user ${user.telegramId}: ${subscriptionId}`);
  }

  /**
   * Reanuda una suscripción
   */
  async resumeSubscription(subscriptionId: string): Promise<void> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { paypalSubscriptionId: subscriptionId },
      relations: ['user'],
    });

    if (!subscription) {
      return;
    }

    // Validar con PayPal
    const paypalSub = await this.paypalService.getSubscription(subscriptionId);

    if (paypalSub.status === 'ACTIVE') {
      subscription.status = 'ACTIVE';
      await this.subscriptionRepository.save(subscription);

      const user = subscription.user;
      user.isPremium = true;

      await this.userRepository.save(user);

      console.log(`▶️ Subscription resumed for user ${user.telegramId}: ${subscriptionId}`);
    }
  }

  /**
   * Crea una nueva suscripción (después de que PayPal aprueba)
   */
  async createSubscription(
    telegramId: number,
    paypalSubscriptionId: string,
    planId: string,
    amount: number,
    currency: string,
  ): Promise<Subscription> {
    const user = await this.getOrCreateUser(telegramId);

    const subscription = this.subscriptionRepository.create({
      paypalSubscriptionId,
      planId,
      status: 'APPROVAL_PENDING',
      amount,
      currency,
      user,
    });

    return this.subscriptionRepository.save(subscription);
  }

  /**
   * Obtiene el estado premium del usuario
   */
  async getUserPremiumStatus(telegramId: number): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { telegramId },
    });

    return user?.isPremium || false;
  }

  /**
   * Obtiene todas las suscripciones activas de un usuario
   */
  async getUserActiveSubscriptions(telegramId: number): Promise<Subscription[]> {
    const user = await this.userRepository.findOne({
      where: { telegramId },
      relations: ['subscriptions'],
    });

    if (!user) return [];

    return user.subscriptions.filter((sub) => sub.status === 'ACTIVE');
  }
}
