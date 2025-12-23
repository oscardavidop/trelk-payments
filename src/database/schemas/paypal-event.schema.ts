import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ collection: 'events', timestamps: true })
export class PayPalEvent extends Document {
  @Prop({ required: true, index: true })
  eventType: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  eventBody: Record<string, any>;

  @Prop({ type: String, sparse: true })
  subscriptionId?: string;

  @Prop({ type: String, sparse: true })
  payerId?: string;

  @Prop({ type: Boolean, default: false })
  processed: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PayPalEventSchema = SchemaFactory.createForClass(PayPalEvent);
