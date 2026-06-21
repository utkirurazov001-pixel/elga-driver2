import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/errors';
import { fail } from '../utils/response';
import { logger } from '../utils/logger';

/** 404 — marshrut topilmadi. */
export function notFound(_req: Request, res: Response): void {
  fail(res, 404, 'NOT_FOUND', 'So\'ralgan resurs topilmadi');
}

/** Markaziy error-handler — aniq HTTP kod + error.code (TZ kod standartlari). */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    fail(res, err.status, err.code, err.message);
    return;
  }
  if (err instanceof ZodError) {
    const first = err.errors[0];
    fail(res, 422, 'VALIDATION_ERROR', first ? `${first.path.join('.')}: ${first.message}` : 'Validatsiya xatosi');
    return;
  }
  logger.error({ err }, 'Kutilmagan xato');
  fail(res, 500, 'INTERNAL_ERROR', 'Ichki server xatosi');
}
