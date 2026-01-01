
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/* -----------------------------
   Sub-esquemas reutilizables
----------------------------- */

@Schema({ _id: false })
class UsageLimit {
    @Prop({ required: true })
    total: number;

    @Prop({ default: 0 })
    used: number;
}

const UsageLimitSchema = SchemaFactory.createForClass(UsageLimit);

@Schema({ _id: false })
class PerDayLimit {
    @Prop({ type: UsageLimitSchema, required: true })
    per_day: UsageLimit;
}

const PerDayLimitSchema = SchemaFactory.createForClass(PerDayLimit);

/* -----------------------------
   Limits
----------------------------- */

@Schema({ _id: false })
class PlanLimits {
    @Prop({ type: UsageLimitSchema })
    downloads_per_day?: UsageLimit;

    @Prop({ type: UsageLimitSchema })
    ai_requests_per_day?: UsageLimit;

    @Prop({ type: UsageLimitSchema })
    premium_ai_requests_per_day?: UsageLimit;

    @Prop({
        type: {
            per_day: UsageLimitSchema,
            total: UsageLimitSchema,
        },
    })
    alerts?: {
        per_day: UsageLimit;
        total: UsageLimit;
    };

    @Prop({ type: PerDayLimitSchema })
    ssweb?: PerDayLimit;

    @Prop({ type: PerDayLimitSchema })
    qr?: PerDayLimit;

    @Prop()
    file_upload_size_mb?: number;
}

const PlanLimitsSchema = SchemaFactory.createForClass(PlanLimits);

/* -----------------------------
   Other feature blocks
----------------------------- */

@Schema({ _id: false })
class CustomCommands {
    @Prop({ default: false })
    available: boolean;

    @Prop({ default: 0 })
    max_commands: number;
}

const CustomCommandsSchema = SchemaFactory.createForClass(CustomCommands);

@Schema({ _id: false })
class Performance {
    @Prop({
        enum: ['basic', 'normal', 'high', 'ultra'],
        default: 'normal',
    })
    queue_priority: string;

    @Prop({ default: 1 })
    response_speed_multiplier: number;
}

const PerformanceSchema = SchemaFactory.createForClass(Performance);

@Schema({ _id: false })
class Support {
    @Prop({
        enum: ['basic', 'pro', 'ultra'],
        default: 'basic',
    })
    priority: string;

    @Prop({ default: false })
    live_chat_access: boolean;
}

const SupportSchema = SchemaFactory.createForClass(Support);

/* -----------------------------
   Features root
----------------------------- */

@Schema({ _id: false })
class PlanFeatures {
    @Prop({ type: PlanLimitsSchema })
    limits: PlanLimits;

    @Prop({ type: CustomCommandsSchema })
    custom_commands: CustomCommands;

    @Prop({ type: PerformanceSchema })
    performance: Performance;

    @Prop({ type: SupportSchema })
    support: Support;
}

const PlanFeaturesSchema = SchemaFactory.createForClass(PlanFeatures);

/* -----------------------------
   MAIN PLAN SCHEMA
----------------------------- */

@Schema({ collection: 'plans', timestamps: true })
export class Plan extends Document {
    @Prop({ required: true, unique: true, index: true })
    name: string; // basic | pro | ultra

    @Prop({ required: true, unique: true, index: true })
    plan_id: string; // paypal plan id

    @Prop({ required: true })
    price: number;

    @Prop({ type: PlanFeaturesSchema, required: true })
    features: PlanFeatures;

    @Prop({ default: true })
    active: boolean;

    createdAt?: Date;
    updatedAt?: Date;
}

export const PlanSchema = SchemaFactory.createForClass(Plan);
