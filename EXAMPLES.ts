/**
 * Ejemplo de cómo usar TelegramService y SubscriptionService
 * en un proyecto externo
 */

import { TelegramService } from './src/telegram/telegram.service';
import { SubscriptionService } from './src/subscription/subscription.service';

/**
 * EJEMPLO 1: Enviar botón de suscripción a un usuario
 */
export async function sendPremiumButtonToUser(
  telegramService: TelegramService,
  userId: number,
) {
  console.log(`📤 Enviando botón premium a usuario ${userId}...`);
  await telegramService.sendPremiumButton(null, userId);
  console.log('✅ Botón enviado');
}

/**
 * EJEMPLO 2: Verificar si usuario es premium
 */
export async function checkUserPremium(
  subscriptionService: SubscriptionService,
  userId: number,
): Promise<boolean> {
  const isPremium = await subscriptionService.getUserPremiumStatus(userId);
  console.log(`User ${userId} premium status: ${isPremium ? '✅' : '❌'}`);
  return isPremium;
}

/**
 * EJEMPLO 3: Obtener suscripciones activas de usuario
 */
export async function getUserSubscriptions(
  subscriptionService: SubscriptionService,
  userId: number,
) {
  const subscriptions = await subscriptionService.getUserActiveSubscriptions(userId);
  console.log(`User ${userId} has ${subscriptions.length} active subscription(s)`);

  subscriptions.forEach((sub) => {
    console.log(`  - ${sub.paypalSubscriptionId} (${sub.status})`);
  });

  return subscriptions;
}

/**
 * EJEMPLO 4: Verificar permiso premium antes de permitir comando
 */
export async function requirePremium(
  subscriptionService: SubscriptionService,
  userId: number,
  callbackIfPremium: () => void,
  callbackIfNotPremium: () => void,
) {
  const isPremium = await subscriptionService.getUserPremiumStatus(userId);

  if (isPremium) {
    console.log('✅ Usuario es premium, ejecutando comando...');
    callbackIfPremium();
  } else {
    console.log('❌ Usuario no es premium, negando acceso');
    callbackIfNotPremium();
  }
}

/**
 * EJEMPLO 5: Cancelar suscripción de usuario
 */
export async function cancelUserSubscription(
  subscriptionService: SubscriptionService,
  paypalService: any,
  telegramService: TelegramService,
  userId: number,
  subscriptionId: string,
) {
  try {
    console.log(`❌ Cancelando suscripción ${subscriptionId}...`);

    // Cancelar en PayPal
    await paypalService.cancelSubscription(subscriptionId);

    // Actualizar en base de datos
    await subscriptionService.cancelSubscription(subscriptionId);

    console.log('✅ Suscripción cancelada');
  } catch (error) {
    console.error('Error cancelando suscripción:', error);
  }
}

/**
 * EJEMPLO 6: Notificar eventos a usuario
 */
export async function sendUserNotification(
  telegramService: TelegramService,
  userId: number,
  message: string,
) {
  console.log(`📢 Enviando notificación a usuario ${userId}...`);
  await telegramService.sendMessage(userId, message);
  console.log('✅ Notificación enviada');
}

/**
 * EJEMPLO 7: Crear o actualizar usuario
 */
export async function ensureUserExists(
  subscriptionService: SubscriptionService,
  userId: number,
  userData?: { username?: string; first_name?: string; last_name?: string },
) {
  const user = await subscriptionService.getOrCreateUser(userId, userData);
  console.log(`✅ Usuario ${user.id} existe en BD`);
  return user;
}

/**
 * EJEMPLO 8: Obtener suscripciones por ID de PayPal
 */
export async function getSubscriptionDetails(
  subscriptionService: SubscriptionService,
  paypalSubscriptionId: string,
) {
  const subscription = await subscriptionService.getSubscriptionByPaypalId(paypalSubscriptionId);

  if (!subscription) {
    console.log('❌ Suscripción no encontrada');
    return null;
  }

  console.log(`✅ Suscripción encontrada:`);
  console.log(`  - Usuario: ${subscription.user.telegramId}`);
  console.log(`  - Status: ${subscription.status}`);
  console.log(`  - Monto: ${subscription.amount} ${subscription.currency}`);
  console.log(`  - Creada: ${subscription.createdAt}`);

  return subscription;
}

// ============================================
// USO EN TU BOT EXISTENTE
// ============================================

/**
 * Ejemplo de handler para comando /premium en bot existente
 */
export async function handlePremiumCommand(
  ctx: any, // contexto de Telegraf
  telegramService: TelegramService,
  subscriptionService: SubscriptionService,
) {
  const userId = ctx.from.id;

  // Verificar si ya es premium
  const isPremium = await subscriptionService.getUserPremiumStatus(userId);

  if (isPremium) {
    await ctx.reply('✅ Ya eres premium! Disfrutalo al máximo 👑');
  } else {
    // Enviar botón de suscripción
    await telegramService.sendPremiumButton(ctx);
  }
}

/**
 * Ejemplo de middleware para verificar premium
 */
export function premiumMiddleware(subscriptionService: SubscriptionService) {
  return async (ctx: any, next: any) => {
    const userId = ctx.from.id;
    const isPremium = await subscriptionService.getUserPremiumStatus(userId);

    ctx.isPremium = isPremium;

    if (!isPremium) {
      await ctx.reply(
        '⚠️ Este comando requiere ser premium.\n' +
        'Escribe /premium para suscribirte 👑',
      );
      return;
    }

    await next();
  };
}

/**
 * Ejemplo de uso del middleware
 */
export function setupPremiumCommands(
  bot: any,
  subscriptionService: SubscriptionService,
) {
  // Comando que solo funciona para premium
  bot.command('exclusive', premiumMiddleware(subscriptionService), async (ctx: any) => {
    if (ctx.isPremium) {
      await ctx.reply('🎁 Contenido exclusivo para premium');
    }
  });
}

export default {
  sendPremiumButtonToUser,
  checkUserPremium,
  getUserSubscriptions,
  requirePremium,
  cancelUserSubscription,
  sendUserNotification,
  ensureUserExists,
  getSubscriptionDetails,
  handlePremiumCommand,
  premiumMiddleware,
  setupPremiumCommands,
};
