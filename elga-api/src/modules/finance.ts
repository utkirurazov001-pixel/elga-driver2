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
router.use(authenticate, requireRole('super_admin', 'finance_admin'));

// BE-FR-023 — moliya summary
router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const paid = store.orders.filter((o) => o.payment_status === 'paid');
    const revenue = paid.reduce((s, o) => s + o.price, 0);
    const commission = paid.reduce((s, o) => s + o.commission, 0);
    const byProvider = (p: string) => store.transactions.filter((t) => t.provider === p && t.status === 'success').reduce((s, t) => s + t.amount, 0);
    return ok(res, {
      revenue, commission, to_drivers: revenue - commission,
      refunds: store.transactions.filter((t) => t.type === 'refund').reduce((s, t) => s + t.amount, 0),
      by_provider: { payme: byProvider('payme'), click: byProvider('click'), cash: byProvider('cash'), balance: byProvider('balance') },
    });
  }),
);

router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    const { page, limit } = pageParams(req);
    const q = qstr(req, 'q');
    const type = qstr(req, 'type');
    const status = qstr(req, 'status');
    const rows = store.transactions.filter(
      (t) => matches(t, q, ['id', 'order', 'who']) && (!type || t.type === type) && (!status || t.status === status),
    );
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows, meta);
  }),
);

router.get(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const { page, limit } = pageParams(req);
    const status = qstr(req, 'status');
    const provider = qstr(req, 'provider');
    const rows = store.withdrawals.filter((w) => (!status || w.status === status) && (!provider || w.provider === provider));
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows, meta);
  }),
);

const confirmSchema = z.object({ confirm: z.literal(true), code: z.string().min(4) });

// BE-FR-020 — pul yechishni tasdiqlash (IKKI BOSQICHLI: confirm=true + kod majburiy)
router.post(
  '/withdrawals/:id/approve',
  validate(confirmSchema),
  asyncHandler(async (req, res) => {
    const w = store.withdrawals.find((x) => x.id === req.params.id);
    if (!w) throw ApiError.notFound('So\'rov topilmadi');
    if (w.status !== 'pending') throw ApiError.conflict('So\'rov allaqachon ko\'rib chiqilgan');
    w.status = 'paid';
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'withdrawal.approve', entity: 'withdrawals', entity_id: w.id, detail: `2-bosqich tasdiq · ${w.amount} so'm · ${w.provider}`, ip: req.ip ?? '' });
    return ok(res, w);
  }),
);

const rejectSchema = z.object({ reason: z.string().min(3) });

router.post(
  '/withdrawals/:id/reject',
  validate(rejectSchema),
  asyncHandler(async (req, res) => {
    const w = store.withdrawals.find((x) => x.id === req.params.id);
    if (!w) throw ApiError.notFound('So\'rov topilmadi');
    w.status = 'rejected';
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'withdrawal.reject', entity: 'withdrawals', entity_id: w.id, detail: (req.body as z.infer<typeof rejectSchema>).reason, ip: req.ip ?? '' });
    return ok(res, w);
  }),
);

export default router;
