import { Router } from 'express';
import { z } from 'zod';
import { store, type Driver } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, paginate } from '../utils/response';
import { ApiError } from '../utils/errors';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { pageParams, qstr, matches } from '../utils/query';
import { phoneForRole } from '../utils/mask';
import type { Role } from '../config/constants';

const router = Router();
router.use(authenticate);

function serialize(d: Driver, role: Role) {
  return { ...d, phone: phoneForRole(d.phone, role) };
}

// GET /drivers — filter + pagination + sort (BE-FR-010)
router.get(
  '/',
  requireRole('super_admin', 'operator', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const { page, limit } = pageParams(req);
    const q = qstr(req, 'q');
    const status = qstr(req, 'status');
    const city = qstr(req, 'city');
    const kyc = qstr(req, 'kyc');
    let rows = store.drivers.filter(
      (d) =>
        matches(d, q, ['full_name', 'phone', 'car_plate', 'car_model']) &&
        (!status || d.status === status) &&
        (!city || d.city === city) &&
        (!kyc || d.kyc_status === kyc),
    );
    const sort = qstr(req, 'sort');
    if (sort) {
      const dir = qstr(req, 'dir') === 'asc' ? 1 : -1;
      const val = (x: Driver) => (x as unknown as Record<string, unknown>)[sort] as string | number;
      rows = [...rows].sort((a, b) => (val(a) > val(b) ? dir : -dir));
    }
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows.map((d) => serialize(d, req.user!.role)), meta);
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const d = store.findDriver(req.params.id);
    if (!d) throw ApiError.notFound('Haydovchi topilmadi');
    return ok(res, serialize(d, req.user!.role));
  }),
);

const blockSchema = z.object({ reason: z.string().min(3, 'Sabab majburiy') });

// POST /drivers/:id/block (BE-FR-012)
router.post(
  '/:id/block',
  requireRole('super_admin', 'operator'),
  validate(blockSchema),
  asyncHandler(async (req, res) => {
    const d = store.findDriver(req.params.id);
    if (!d) throw ApiError.notFound('Haydovchi topilmadi');
    d.status = 'blocked';
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'driver.block', entity: 'drivers', entity_id: d.id, detail: `Bloklandi: ${(req.body as z.infer<typeof blockSchema>).reason}`, ip: req.ip ?? '' });
    return ok(res, serialize(d, req.user!.role));
  }),
);

router.post(
  '/:id/unblock',
  requireRole('super_admin', 'operator'),
  asyncHandler(async (req, res) => {
    const d = store.findDriver(req.params.id);
    if (!d) throw ApiError.notFound('Haydovchi topilmadi');
    d.status = 'free';
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'driver.unblock', entity: 'drivers', entity_id: d.id, detail: 'Blokdan chiqarildi', ip: req.ip ?? '' });
    return ok(res, serialize(d, req.user!.role));
  }),
);

const kycSchema = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().optional() });

// KYC tasdiqlash/rad (BE-FR-011)
router.post(
  '/:id/kyc',
  requireRole('super_admin', 'operator'),
  validate(kycSchema),
  asyncHandler(async (req, res) => {
    const d = store.findDriver(req.params.id);
    if (!d) throw ApiError.notFound('Haydovchi topilmadi');
    const { decision } = req.body as z.infer<typeof kycSchema>;
    d.kyc_status = decision;
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'kyc.verify', entity: 'drivers', entity_id: d.id, detail: `KYC ${decision}`, ip: req.ip ?? '' });
    return ok(res, serialize(d, req.user!.role));
  }),
);

export default router;
