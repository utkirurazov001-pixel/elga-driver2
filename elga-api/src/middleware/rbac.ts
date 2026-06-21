import type { Request, Response, NextFunction } from 'express';
import type { Role } from '../config/constants';
import { ApiError } from '../utils/errors';
import { store } from '../store';

/**
 * RBAC — server-side majburlash (RBAC-01).
 * Ruxsatsiz so'rov 403 + audit yozuvi (RBAC-02).
 */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) throw ApiError.unauthorized();
    if (!allowed.includes(user.role)) {
      store.addAudit({
        user_id: user.sub,
        user: user.login,
        role: user.role,
        action: 'rbac.denied',
        entity: 'auth',
        entity_id: req.path,
        detail: `Ruxsatsiz urinish: ${req.method} ${req.originalUrl}`,
        ip: req.ip ?? '',
      });
      throw ApiError.forbidden('Bu amal uchun ruxsatingiz yo\'q');
    }
    next();
  };
}
