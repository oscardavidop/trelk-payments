import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ collection: 'events', timestamps: true })
export class PayPalEvent extends Document {
    // Idempotencia: un event_id único por cada webhook de PayPal
    @Prop({ unique: true, sparse: true, index: true })
    event_id?: string;

    @Prop({ required: true, index: true })
    eventType: string;

    @Prop({ type: MongooseSchema.Types.Mixed, required: true })
    eventBody: Record<string, any>;

    @Prop({ type: String, sparse: true, index: true })
    subscriptionId?: string;

    // Nunca loguear emails completos — solo para correlación
    @Prop({ type: String, sparse: true })
    payerId?: string;

    @Prop({ type: Boolean, default: false, index: true })
    processed: boolean;

    @Prop({ type: Boolean, default: false })
    invalid_signature: boolean;

    // Trazabilidad de errores de procesamiento
    @Prop({ type: String })
    processingError?: string;

    @Prop({ type: Number, default: 0 })
    retryCount?: number;

    @Prop({ type: Date })
    processedAt?: Date;

    @Prop({ type: Date })
    lastAttemptAt?: Date;

    createdAt?: Date;
    updatedAt?: Date;
}

export const PayPalEventSchema = SchemaFactory.createForClass(PayPalEvent);

// Índice para anti-duplicados
PayPalEventSchema.index({ event_id: 1, eventType: 1 });

// Índice para cola de reprocesamiento (eventos fallidos no procesados)
PayPalEventSchema.index({ processed: 1, retryCount: 1, lastAttemptAt: 1 });

// TTL: eliminar eventos procesados exitosamente después de 90 días
// Mantiene la colección manejable sin perder auditabilidad reciente
PayPalEventSchema.index(
    { processedAt: 1 },
    {
        expireAfterSeconds: 90 * 24 * 60 * 60, // 90 días
        partialFilterExpression: { processed: true },
    },
);
