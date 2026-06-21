import type { Request, Response, NextFunction } from 'express';
import { verifyAccess } from '../utils/jwt';
import { ApiError } from '../utils/errors';

/** JWT access token tekshiruvi — req.user ni to'ldiradi. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Token yuborilmadi');
  }
  try {
    req.user = verifyAccess(header.slice(7));
    next();
  } catch {
    throw ApiError.unauthorized('Token yaroqsiz yoki muddati tugagan');
  }
}
