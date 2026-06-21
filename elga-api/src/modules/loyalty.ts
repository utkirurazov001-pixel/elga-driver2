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

// Sovg'alar katalogi (RULE-08)
router.get('/rewards', asyncHandler(async (_req, res) => ok(res, store.rewards)));

router.patch(
  '/rewards/:id',
  requireRole('super_admin', 'operator'),
  asyncHandler(async (req, res) => {
    const r = store.rewards.find((x) => x.id === req.params.id);
    if (!r) throw ApiError.notFound('Sovg\'a topilmadi');
    Object.assign(r, req.body as Record<string, unknown>);
    return ok(res, r);
  }),
);

// Promo-kodlar
router.get('/promo-codes', asyncHandler(async (_req, res) => ok(res, store.promos)));

const adjustSchema = z.object({
  client_id: z.string().min(1),
  type: z.enum(['earn', 'redeem']),
  points: z.number().int().positive(),
  reason: z.string().min(2),
});

// Qo'lda ball boshqarish (BE-FR-052/056) — idempotent emas demoda, lekin audit yoziladi
router.post(
  '/adjust',
  requireRole('super_admin'),
  validate(adjustSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof adjustSchema>;
    const c = store.findClient(b.client_id);
    if (!c) throw ApiError.notFound('Mijoz topilmadi');
    c.points = Math.max(0, c.points + (b.type === 'earn' ? b.points : -b.points));
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'loyalty.adjust', entity: 'loyalty_accounts', entity_id: c.id, detail: `${b.type === 'earn' ? '+' : '−'}${b.points}: ${b.reason}`, ip: req.ip ?? '' });
    return ok(res, { client_id: c.id, points: c.points });
  }),
);

export default router;
