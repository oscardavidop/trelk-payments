import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Subscription } from '../database/schemas/subscription.schema';
import { User } from '../database/schemas/user.schema';
import { PaypalService } from '../paypal/paypal.service';

/**
 * ReconciliationService
 *
 * Cron jobs de reconciliación financiera automática.
 *
 * Por qué es crítico este servicio:
 * ─────────────────────────────────
 * Sin reconciliación, los siguientes escenarios pasan SILENCIOSAMENTE:
 *
 * 1. SUSCRIPCION ACTIVA SIN USUARIO (> 24h):
 *    - PayPal cobró al usuario → suscripción ACTIVE en DB
 *    - El webhook de attach llegó tarde o falló
 *    - Usuario pagó pero NUNCA recibió su premium
 *    - Sin reconciliación: nadie lo detecta hasta que el usuario reclama
 *    - Con reconciliación: detectado en máximo 1 hora → alerta + self-heal
 *
 * 2. USUARIO PREMIUM SIN SUSCRIPCION ACTIVA:
 *    - Suscripción cancelada en PayPal pero is_pro sigue true
 *    - Usuario tiene premium gratis sin pagar
 *    - Pérdida de ingresos directa
 *
 * 3. INCONSISTENCIA PAYPAL ↔ MONGODB:
 *    - MongoDB dice ACTIVE, PayPal dice CANCELLED
 *    - Estado corrupto sin detectar
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectModel(Subscription.name, 'payments')
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(User.name, 'mbot')
    private readonly userModel: Model<User>,
    private readonly paypalService: PaypalService,
  ) {}

  // ── Cron 1: Suscripciones ACTIVE sin user_id (huérfanas) ─────────────────
  // Ejecuta cada hora. Detecta webhooks perdidos donde PayPal cobró pero
  // el usuario no recibió su acceso premium.
  @Cron(CronExpression.EVERY_HOUR)
  async detectOrphanedSubscriptions(): Promise<void> {
    const threshold = new Date(Date.now() - 24 * 60 * 60 * 1_000); // 24h atrás

    const orphaned = await this.subscriptionModel
      .find({
        status: 'ACTIVE',
        user_id: { $exists: false },
        createdAt: { $lt: threshold },
      })
      .lean();

    if (orphaned.length === 0) return;

    this.logger.error(
      `[RECONCILIATION] ⚠️  ${orphaned.length} suscripción(es) ACTIVA(S) SIN USUARIO > 24h detectadas:`,
    );

    for (const sub of orphaned) {
      this.logger.error(
        `[RECONCILIATION] Orphaned subscription: ` +
          JSON.stringify({
            paypal_subscription_id: sub.paypal_subscription_id,
            plan_id: sub.plan_id,
            createdAt: sub.createdAt,
            amount: sub.amount,
            currency: sub.currency,
          }),
      );

      // Self-heal: intentar obtener el custom_id de PayPal
      await this.trySelfHealOrphanedSubscription(sub as unknown as Subscription);
    }
  }

  // ── Cron 2: Usuarios premium sin suscripción activa (zombies) ────────────
  // Ejecuta cada 6 horas. Detecta usuarios con is_pro=true pero sin
  // ninguna suscripción ACTIVE → potencial premium fraudulento o desincronizado.
  @Cron(CronExpression.EVERY_6_HOURS)
  async detectZombiePremiumUsers(): Promise<void> {
    // Obtener todos user_id de suscripciones ACTIVE
    const activeSubUserIds = await this.subscriptionModel
      .distinct('user_id', { status: 'ACTIVE', user_id: { $exists: true } });

    // Usuarios premium que NO tienen suscripción activa
    const zombies = await this.userModel
      .find({
        is_pro: true,
        id: { $nin: activeSubUserIds.map((id) => Number(id)) },
      })
      .lean();

    if (zombies.length === 0) return;

    this.logger.warn(
      `[RECONCILIATION] ${zombies.length} usuario(s) con is_pro=true SIN suscripción ACTIVE:`,
    );

    for (const user of zombies) {
      this.logger.warn(
        `[RECONCILIATION] Zombie premium user: id=${user.id} — requires manual review`,
      );
      // NOTA: NO corregir automáticamente is_pro=false sin verificar primero con PayPal.
      // Podría haber un webhook pendiente, un período de gracia, etc.
      // Registrar para revisión manual.
    }
  }

  // ── Cron 3: Verificación de consistencia PayPal ↔ MongoDB ────────────────
  // Ejecuta a medianoche. Toma una muestra de suscripciones ACTIVE y
  // verifica su estado real en PayPal. Detecta estados corruptos.
  @Cron('0 0 * * *') // diariamente a las 00:00
  async verifyPaypalConsistency(): Promise<void> {
    // Muestra de máx 50 suscripciones activas (no verificar todas para evitar
    // rate limit en la PayPal API)
    const sample = await this.subscriptionModel
      .find({ status: 'ACTIVE', user_id: { $exists: true } })
      .sort({ updatedAt: 1 }) // las más antiguas primero (menos verificadas)
      .limit(50)
      .lean();

    if (sample.length === 0) return;

    this.logger.log(
      `[RECONCILIATION] Verifying ${sample.length} subscriptions against PayPal…`,
    );

    let inconsistencies = 0;

    for (const sub of sample) {
      try {
        const paypalSub = await this.paypalService.getSubscription(
          sub.paypal_subscription_id,
        );

        const paypalStatus: string = paypalSub.status?.toUpperCase() ?? 'UNKNOWN';

        if (paypalStatus !== sub.status) {
          inconsistencies++;
          this.logger.error(
            `[RECONCILIATION] ⚠️  INCONSISTENCY DETECTED: ` +
              JSON.stringify({
                paypal_subscription_id: sub.paypal_subscription_id,
                db_status: sub.status,
                paypal_status: paypalStatus,
                user_id: sub.user_id,
              }),
          );

          // Auto-corrección solo para estados irrecuperables (CANCELLED, EXPIRED)
          if (['CANCELLED', 'EXPIRED'].includes(paypalStatus)) {
            await this.subscriptionModel.updateOne(
              { paypal_subscription_id: sub.paypal_subscription_id },
              {
                $set: {
                  status: paypalStatus,
                  cancelledAt: new Date(),
                  reconciliationNote: `Auto-corrected by reconciliation at ${new Date().toISOString()} (PayPal=${paypalStatus}, DB was=${sub.status})`,
                },
              },
            );
            this.logger.warn(
              `[RECONCILIATION] Auto-corrected subscription ${sub.paypal_subscription_id} to ${paypalStatus}`,
            );
          }
        }

        // Rate limit: 100ms entre llamadas a PayPal para no saturar la API
        await new Promise((r) => setTimeout(r, 100));
      } catch (err: any) {
        this.logger.error(
          `[RECONCILIATION] Failed to verify ${sub.paypal_subscription_id}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `[RECONCILIATION] Consistency check complete. Inconsistencies: ${inconsistencies}/${sample.length}`,
    );
  }

  // ── Cron 4: Limpiar suscripciones APPROVAL_PENDING antiguas ──────────────
  // Suscripciones que nunca completaron el flujo de pago > 7 días
  @Cron('0 2 * * *') // diariamente a las 02:00
  async cleanupStaleApprovalPending(): Promise<void> {
    const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000); // 7 días

    const stale = await this.subscriptionModel
      .find({
        status: 'APPROVAL_PENDING',
        createdAt: { $lt: threshold },
      })
      .lean();

    if (stale.length === 0) return;

    this.logger.log(
      `[RECONCILIATION] Found ${stale.length} APPROVAL_PENDING subscriptions > 7 days old`,
    );

    for (const sub of stale) {
      this.logger.log(
        `[RECONCILIATION] Stale APPROVAL_PENDING: ${sub.paypal_subscription_id} (created ${sub.createdAt})`,
      );
    }

    // No eliminar automáticamente — solo reportar para auditoría
    // La eliminación requiere confirmación manual con el equipo de operaciones
  }

  // ── Helper privado: self-heal de suscripción huérfana ────────────────────

  private async trySelfHealOrphanedSubscription(sub: Subscription): Promise<void> {
    try {
      const paypalSub = await this.paypalService.getSubscription(
        sub.paypal_subscription_id,
      );

      // Si PayPal tiene un custom_id asignado, podemos recuperar la asociación
      const customId: string | undefined = paypalSub.custom_id ?? paypalSub.subscriber?.custom_id;

      if (customId) {
        await this.subscriptionModel.updateOne(
          {
            paypal_subscription_id: sub.paypal_subscription_id,
            user_id: { $exists: false }, // solo si aún no tiene user_id
          },
          { $set: { user_id: customId, selfHealedAt: new Date() } },
        );
        this.logger.warn(
          `[RECONCILIATION] Self-healed orphaned subscription: ${sub.paypal_subscription_id} → user ${customId}`,
        );
      } else {
        this.logger.error(
          `[RECONCILIATION] Cannot self-heal ${sub.paypal_subscription_id}: no custom_id in PayPal — MANUAL ACTION REQUIRED`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `[RECONCILIATION] Self-heal failed for ${sub.paypal_subscription_id}: ${err.message}`,
      );
    }
  }
}
