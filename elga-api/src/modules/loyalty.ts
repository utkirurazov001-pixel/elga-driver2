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

// POST /loyalty/redeem — ballni sovg'aga almashtirish (idempotent emas demo)
const redeemSchema = z.object({ client_id: z.string().min(1), reward_id: z.string().min(1) });
router.post(
  '/redeem',
  requireRole('super_admin', 'operator'),
  validate(redeemSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof redeemSchema>;
    const c = store.findClient(b.client_id);
    if (!c) throw ApiError.notFound('Mijoz topilmadi');
    const r = store.rewards.find((x) => x.id === b.reward_id);
    if (!r || !r.is_active) throw ApiError.notFound('Sovg\'a topilmadi yoki nofaol');
    if (r.stock <= 0) throw ApiError.conflict('Sovg\'a zaxirasi tugagan');
    if (c.points < r.cost_points) throw ApiError.badRequest('Ball yetarli emas');
    c.points -= r.cost_points;
    r.stock -= 1;
    const code = `ELGA-${1000 + Math.floor(Math.random() * 9000)}`;
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'loyalty.redeem', entity: 'redemptions', entity_id: c.id, detail: `${r.title} (−${r.cost_points} ball)`, ip: req.ip ?? '' });
    return ok(res, { client_id: c.id, reward: r.title, points_left: c.points, code });
  }),
);

// Promo-kodlar (super_admin, operator)
router.get('/promo-codes', requireRole('super_admin', 'operator'), asyncHandler(async (_req, res) => ok(res, store.promos)));

// POST /promo-codes/validate — promo-kod tekshirish va qo'llash
const validateSchema = z.object({ code: z.string().min(1), order_amount: z.number().int().nonnegative() });
router.post(
  '/promo-codes/validate',
  validate(validateSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof validateSchema>;
    const p = store.promos.find((x) => x.code.toUpperCase() === b.code.toUpperCase());
    if (!p) throw ApiError.notFound('Promo-kod topilmadi');
    if (!p.is_active) throw ApiError.badRequest('Promo-kod nofaol');
    if (p.used_count >= p.usage_limit) throw ApiError.badRequest('Promo-kod limiti tugagan');
    if (b.order_amount < p.min_order) throw ApiError.badRequest(`Minimal buyurtma ${p.min_order} so'm`);
    let discount = 0;
    let points = 0;
    if (p.type === 'percent') discount = Math.round((b.order_amount * p.value) / 100);
    else if (p.type === 'fixed') discount = p.value;
    else points = p.value;
    return ok(res, { code: p.code, type: p.type, discount, points, final_amount: Math.max(0, b.order_amount - discount) });
  }),
);

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
