import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ collection: 'events', timestamps: true })
export class PayPalEvent extends Document {
    // FIX: Agregar event_id único para idempotencia de webhooks
    @Prop({ unique: true, sparse: true, index: true })
    event_id?: string;

    @Prop({ required: true, index: true })
    eventType: string;

    @Prop({ type: MongooseSchema.Types.Mixed, required: true })
    eventBody: Record<string, any>;

    @Prop({ type: String, sparse: true, index: true })
    subscriptionId?: string;

    @Prop({ type: String, sparse: true })
    payerId?: string;

    @Prop({ type: Boolean, default: false, index: true })
    processed: boolean;

    @Prop({ type: Boolean, default: false })
    invalid_signature: boolean;

    createdAt?: Date;
    updatedAt?: Date;
}

export const PayPalEventSchema = SchemaFactory.createForClass(PayPalEvent);

// FIX: Índice para detectar eventos duplicados
PayPalEventSchema.index({ event_id: 1, eventType: 1 });
