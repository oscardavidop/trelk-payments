import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// use other db 
@Schema({ timestamps: true })

export class User extends Document {
    @Prop({ required: true, unique: true, index: true })
    id: number;

    @Prop({ type: Object, default: {} })
    pro_features:Record<string, any>;

    @Prop({ type: Boolean, default: false })
    is_pro: boolean;
}

export const UserSchema = SchemaFactory.createForClass(User);
