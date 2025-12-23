import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../database/schemas';

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: User.name, schema: UserSchema }],
      'mbot',
    ),
  ],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule { }
