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
    @Prop({ required: true, unique: true, index: true })
    id: string;

    @Prop({ required: true })
    plan_id: string;

    @Prop({ required: true })
    start_time: string;

    @Prop({ required: true })
    quantity: string;

    @Prop({ type: String, enum: ['APPROVAL_PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED', 'PENDING_ASSOCIATION'], default: 'APPROVAL_PENDING' })
    status: 'APPROVAL_PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED' | 'PENDING_ASSOCIATION';

    @Prop({ type: String, sparse: true })
    paypal_payerId?: string;

    @Prop({ type: Number, required: false })
    amount: number;

    @Prop({ type: String, required: false })
    currency: string;

    @Prop({ type: Date, sparse: false })
    next_billing_date?: string;

    @Prop({ type: Date, sparse: false })
    cancelledAt?: Date;

    @Prop({ type: Types.ObjectId, ref: 'User', required: false })
    user: Types.ObjectId;

    @Prop({ type: String, sparse: true })
    user_id?: string;

    createdAt?: Date;
    updatedAt?: Date;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
