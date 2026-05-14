import { Controller, Get, HttpException, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';

@Controller('')
export class AppController {
  /**
   * Página de suscripción pública.
   * M-6 FIX: eliminar path hardcodeado absoluto; usar public/ relativo al proyecto.
   */
  @Get('')
  subscribe(@Res() res: Response): void {
    try {
      res.sendFile(join(__dirname, '..', 'public', 'index.html'));
    } catch (error: any) {
      throw new HttpException(
        'Failed to render subscription page',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
