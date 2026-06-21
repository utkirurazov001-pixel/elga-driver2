import { Router } from 'express';
import { store, type Client } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, paginate } from '../utils/response';
import { ApiError } from '../utils/errors';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { pageParams, qstr, matches } from '../utils/query';
import { phoneForRole } from '../utils/mask';
import type { Role } from '../config/constants';

const router = Router();
router.use(authenticate, requireRole('super_admin', 'operator'));

const ser = (c: Client, role: Role) => ({ ...c, phone: phoneForRole(c.phone, role) });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit } = pageParams(req);
    const q = qstr(req, 'q');
    const tier = qstr(req, 'tier');
    const blocked = qstr(req, 'blocked');
    const rows = store.clients.filter(
      (c) =>
        matches(c, q, ['full_name', 'phone']) &&
        (!tier || c.tier === tier) &&
        (!blocked || (blocked === 'yes' ? c.is_blocked : !c.is_blocked)),
    );
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows.map((c) => ser(c, req.user!.role)), meta);
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const c = store.findClient(req.params.id);
    if (!c) throw ApiError.notFound('Mijoz topilmadi');
    return ok(res, ser(c, req.user!.role));
  }),
);

// GET /clients/:id/orders — safar tarixi
router.get(
  '/:id/orders',
  asyncHandler(async (req, res) => {
    const c = store.findClient(req.params.id);
    if (!c) throw ApiError.notFound('Mijoz topilmadi');
    return ok(res, store.orders.filter((o) => o.client_id === c.id));
  }),
);

router.post(
  '/:id/block',
  asyncHandler(async (req, res) => {
    const c = store.findClient(req.params.id);
    if (!c) throw ApiError.notFound('Mijoz topilmadi');
    c.is_blocked = !c.is_blocked;
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: c.is_blocked ? 'client.block' : 'client.unblock', entity: 'clients', entity_id: c.id, detail: c.is_blocked ? 'Bloklandi' : 'Blokdan chiqarildi', ip: req.ip ?? '' });
    return ok(res, ser(c, req.user!.role));
  }),
);

export default router;
