import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

type Source = 'body' | 'query' | 'params';

/** Zod validatsiya middleware (BE-SEC-01 — har endpoint kirishi tekshiriladi). */
export function validate(schema: ZodSchema, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.parse(req[source]);
    // tozalangan/transform qilingan qiymatni qaytarib qo'yamiz
    (req as unknown as Record<Source, unknown>)[source] = parsed;
    next();
  };
}
