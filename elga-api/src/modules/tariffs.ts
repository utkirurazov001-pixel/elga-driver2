import { Router } from 'express';
import { z } from 'zod';
import { store } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';
import { ApiError } from '../utils/errors';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (_req, res) => ok(res, store.tariffs)),
);

const updateSchema = z.object({
  base_fare: z.number().int().nonnegative().optional(),
  per_km: z.number().int().nonnegative().optional(),
  per_min: z.number().int().nonnegative().optional(),
  min_fare: z.number().int().nonnegative().optional(),
  surge_multiplier: z.number().min(1).max(5).optional(),
  commission_percent: z.number().min(0).max(50).optional(),
  is_active: z.boolean().optional(),
});

// PATCH /tariffs/:id — surge/komissiya (super_admin, finance_admin)
router.patch(
  '/:id',
  requireRole('super_admin', 'finance_admin'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const t = store.tariffs.find((x) => x.id === req.params.id);
    if (!t) throw ApiError.notFound('Tarif topilmadi');
    Object.assign(t, req.body as z.infer<typeof updateSchema>);
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'tariff.update', entity: 'tariffs', entity_id: t.id, detail: `${t.name} yangilandi`, ip: req.ip ?? '' });
    return ok(res, t);
  }),
);

export default router;
