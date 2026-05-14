import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
// {
//   id: 'WH-3T3528715S107350A-7MR01190L5876971M',
//   event_version: '1.0',
//   create_time: '2025-12-23T03:51:25.743Z',
//   resource_type: 'subscription',
//   resource_version: '2.0',
//   event_type: 'BILLING.SUBSCRIPTION.CREATED',
//   summary: 'Subscription created',
//   resource: {
//     start_time: '2025-12-23T03:51:25Z',
//     quantity: '1',
//     create_time: '2025-12-23T03:51:25Z',
//     links: [ [Object], [Object], [Object] ],
//     id: 'I-U4H2D6VLLWWG',
//     plan_overridden: false,
//     plan_id: 'P-1NV0074521568760WNFE3VFQ',
//     status: 'APPROVAL_PENDING'
//   },
//   links: [
//     {
//       href: 'https://api.sandbox.paypal.com/v1/notifications/webhooks-events/WH-3T3528715S107350A-7MR01190L5876971M',
//       rel: 'self',
//       method: 'GET'
//     },
//     {
//       href: 'https://api.sandbox.paypal.com/v1/notifications/webhooks-events/WH-3T3528715S107350A-7MR01190L5876971M/resend',
//       rel: 'resend',
//       method: 'POST'
//     }
//   ]
// }
@Schema({ timestamps: true })
export class Subscription extends Document {

    // 🔑 PayPal
    @Prop({ required: true, unique: true, index: true })
    paypal_subscription_id: string;

    @Prop({ required: true, index: true })
    plan_id: string;

    @Prop()
    start_time?: string;

    @Prop()
    quantity?: string;

    // 📌 Estado
    @Prop({
        type: String,
        enum: [
            'APPROVAL_PENDING',
            'PENDING_ASSOCIATION',
            'ACTIVE',
            'SUSPENDED',
            'CANCELLED',
            'EXPIRED'
        ],
        default: 'APPROVAL_PENDING',
        index: true
    })
    status:
        | 'APPROVAL_PENDING'
        | 'PENDING_ASSOCIATION'
        | 'ACTIVE'
        | 'SUSPENDED'
        | 'CANCELLED'
        | 'EXPIRED';

    // 💳 Pago
    @Prop({ sparse: true })
    paypal_payerId?: string;

    @Prop()
    amount?: number;

    @Prop()
    currency?: string;

    @Prop()
    next_billing_date?: Date;

    @Prop()
    cancelledAt?: Date;

    // Telegram / external ID
    @Prop({ sparse: true, index: true })
    user_id?: string;

    // 🔔 Idempotencia
    @Prop({ default: false, index: true }) // FIX: Índice para queries atómicos
    activation_notified?: boolean;

    @Prop({ type: Boolean, default: false, index: true }) // FIX: Índice para queries atómicos
    features_applied?: boolean;

    @Prop({ type: Boolean, default: false })
    invalid_signature?: boolean;

    createdAt?: Date;
    updatedAt?: Date;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

// ── Índices para atomicidad y performance en operaciones críticas ──────────

// Clave única: previene duplicados de suscripciones en PayPal
// (ya está como @Prop unique:true, pero lo declaramos explícitamente)
SubscriptionSchema.index({ paypal_subscription_id: 1 }, { unique: true });

// Índice compuesto para tryActivateFeatures (query atómica crítica)
SubscriptionSchema.index({
  paypal_subscription_id: 1,
  status: 1,
  features_applied: 1,
});

// Índice para cancelSubscription / updateStatus
SubscriptionSchema.index({ paypal_subscription_id: 1, user_id: 1 });

// B-1 FIX: Índice compuesto para getUserActiveSubscriptions
// Query: { user_id: "xxx", status: "ACTIVE" }
SubscriptionSchema.index({ user_id: 1, status: 1 });

// Índice para búsquedas por plan
SubscriptionSchema.index({ plan_id: 1 });

// Índice para estado (reconciliación, cron jobs)
SubscriptionSchema.index({ status: 1 });

// Índice para detectar suscripciones próximas a vencer (cron de reconciliación)
SubscriptionSchema.index({ next_billing_date: 1, status: 1 });