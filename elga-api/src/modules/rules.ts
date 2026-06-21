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
router.use(authenticate, requireRole('super_admin', 'finance_admin'));

// GET /work-rules — komissiya qoidalari (tarif + haydovchi override)
router.get(
  '/',
  asyncHandler(async (_req, res) =>
    ok(res, {
      by_tariff: store.tariffs.map((t) => ({ tariff: t.name, commission_percent: t.commission_percent })),
      overrides: store.drivers.filter((d) => d.commission_override != null).map((d) => ({ driver_id: d.id, full_name: d.full_name, commission_override: d.commission_override })),
    }),
  ),
);

const ovSchema = z.object({ commission_override: z.number().min(0).max(50).nullable() });

// PATCH /work-rules/driver/:id — haydovchi komissiya override
router.patch(
  '/driver/:id',
  validate(ovSchema),
  asyncHandler(async (req, res) => {
    const d = store.findDriver(req.params.id);
    if (!d) throw ApiError.notFound('Haydovchi topilmadi');
    d.commission_override = (req.body as z.infer<typeof ovSchema>).commission_override;
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'workrule.override', entity: 'drivers', entity_id: d.id, detail: `Komissiya override: ${d.commission_override}%`, ip: req.ip ?? '' });
    return ok(res, { driver_id: d.id, commission_override: d.commission_override });
  }),
);

export default router;
