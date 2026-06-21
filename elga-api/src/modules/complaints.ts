import { Router } from 'express';
import { z } from 'zod';
import { store } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, paginate } from '../utils/response';
import { ApiError } from '../utils/errors';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { pageParams, qstr, matches } from '../utils/query';

const router = Router();
router.use(authenticate, requireRole('super_admin', 'operator', 'moderator'));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit } = pageParams(req);
    const q = qstr(req, 'q');
    const status = qstr(req, 'status');
    const source = qstr(req, 'source');
    const rows = store.complaints.filter(
      (c) => matches(c, q, ['category', 'order', 'who', 'city']) && (!status || c.status === status) && (!source || c.source === source),
    );
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows, meta);
  }),
);

const respondSchema = z.object({ resolution: z.string().min(2) });

router.post(
  '/:id/respond',
  validate(respondSchema),
  asyncHandler(async (req, res) => {
    const c = store.complaints.find((x) => x.id === req.params.id);
    if (!c) throw ApiError.notFound('Shikoyat topilmadi');
    c.status = 'in_review';
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'complaint.respond', entity: 'complaints', entity_id: c.id, detail: 'Javob berildi', ip: req.ip ?? '' });
    return ok(res, c);
  }),
);

router.post(
  '/:id/resolve',
  asyncHandler(async (req, res) => {
    const c = store.complaints.find((x) => x.id === req.params.id);
    if (!c) throw ApiError.notFound('Shikoyat topilmadi');
    c.status = 'resolved';
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'complaint.resolve', entity: 'complaints', entity_id: c.id, detail: 'Hal qilindi', ip: req.ip ?? '' });
    return ok(res, c);
  }),
);

export default router;
