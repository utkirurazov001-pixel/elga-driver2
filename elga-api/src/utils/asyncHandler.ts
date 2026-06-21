import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Async route'larni try/catch'siz yozish uchun wrapper (TZ kod standartlari). */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
