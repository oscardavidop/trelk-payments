import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class LoggerService {
  private logger = new Logger('AppLogger');

  info(message: string, meta?: Record<string, any>) {
    this.logger.log(`${message}${meta ? ` | ${JSON.stringify(meta)}` : ''}`);
  }

  warn(message: string, meta?: Record<string, any>) {
    this.logger.warn(`${message}${meta ? ` | ${JSON.stringify(meta)}` : ''}`);
  }

  error(message: string, error?: any, meta?: Record<string, any>) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    this.logger.error(`${message}: ${errorMsg}${meta ? ` | ${JSON.stringify(meta)}` : ''}`);
  }

  debug(message: string, meta?: Record<string, any>) {
    this.logger.debug(`${message}${meta ? ` | ${JSON.stringify(meta)}` : ''}`);
  }
}
