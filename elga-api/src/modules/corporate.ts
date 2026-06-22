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
router.use(authenticate, requireRole('super_admin', 'finance_admin', 'operator'));

// Korporativ (B2B) akkauntlar
router.get('/', asyncHandler(async (_req, res) => ok(res, store.corporate)));

const coSchema = z.object({
  name: z.string().min(2),
  contact: z.string().min(2),
  phone: z.string().min(7),
  balance: z.number().int().nonnegative().default(0),
});

router.post(
  '/',
  validate(coSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof coSchema>;
    const co = { id: `CO${store.corporate.length + 1}`, ...b, employees: 0, rides: 0, is_active: true };
    store.corporate.push(co);
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'corporate.create', entity: 'corporate', entity_id: co.id, detail: co.name, ip: req.ip ?? '' });
    return ok(res, co, null, 201);
  }),
);

// Hisob-faktura (oddiy hisob)
router.get(
  '/:id/invoice',
  asyncHandler(async (req, res) => {
    const co = store.corporate.find((x) => x.id === req.params.id);
    if (!co) throw ApiError.notFound('Korporativ akkaunt topilmadi');
    const amount = co.rides * 22000;
    return ok(res, { corporate: co.name, rides: co.rides, avg_fare: 22000, amount, vat: Math.round(amount * 0.12), total: Math.round(amount * 1.12), period: 'Iyun 2026' });
  }),
);

export default router;
