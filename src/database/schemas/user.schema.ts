import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// use other db 
@Schema({ timestamps: true })

export class User extends Document {
  @Prop({ required: true, unique: true, index: true })
  telegramId: number;

  @Prop({ type: String, sparse: true })
  telegramUsername?: string;

  @Prop({ type: String, sparse: true })
  firstName?: string;

  @Prop({ type: String, sparse: true })
  lastName?: string;

  @Prop({ type: String, sparse: true })
  paypalPayerId?: string;

  @Prop({ type: String, enum: ['free', 'premium', 'pro'], default: 'free' })
  tier: 'free' | 'premium' | 'pro';

  @Prop({ type: Boolean, default: false })
  isPremium: boolean;

  @Prop({ type: [Types.ObjectId], ref: 'Subscription', default: [] })
  subscriptions: Types.ObjectId[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
