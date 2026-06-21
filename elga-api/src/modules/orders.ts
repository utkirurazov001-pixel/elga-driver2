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
import { CITIES, TARIFFS, DEFAULT_COMMISSION } from '../config/constants';

const router = Router();
router.use(authenticate);

// GET /orders — filter/sort/pagination
router.get(
  '/',
  requireRole('super_admin', 'operator', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const { page, limit } = pageParams(req);
    const q = qstr(req, 'q');
    const status = qstr(req, 'status');
    const city = qstr(req, 'city');
    const route = qstr(req, 'route');
    const tariff = qstr(req, 'tariff');
    const rows = store.orders.filter(
      (o) =>
        matches(o, q, ['id', 'client', 'driver', 'from_place', 'to_place', 'from_city', 'to_city']) &&
        (!status || o.status === status) &&
        (!city || o.from_city === city || o.to_city === city) &&
        (!route || o.route_type === route) &&
        (!tariff || o.tariff === tariff),
    );
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows, meta);
  }),
);

router.get(
  '/:id',
  requireRole('super_admin', 'operator', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const o = store.findOrder(req.params.id);
    if (!o) throw ApiError.notFound('Buyurtma topilmadi');
    return ok(res, o);
  }),
);

const createSchema = z.object({
  client_phone: z.string().min(7),
  from_city: z.enum(CITIES),
  from_place: z.string().min(1),
  to_city: z.enum(CITIES),
  to_place: z.string().min(1),
  tariff: z.enum(TARIFFS),
  payment: z.enum(['cash', 'payme', 'click', 'balance']).default('cash'),
});

// POST /orders — qo'lda yaratish (BE-FR-003) + manzil lug'atiga qo'shish
router.post(
  '/',
  requireRole('operator', 'dispatcher', 'super_admin'),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    store.regPlace(b.from_city, b.from_place, 'kiritilgan');
    store.regPlace(b.to_city, b.to_place, 'kiritilgan');
    const inter = b.from_city !== b.to_city;
    const tariff = store.tariffs.find((t) => t.name === b.tariff)!;
    const distance = inter ? 35 : 5;
    const price = Math.max(tariff.min_fare, Math.round((tariff.base_fare + tariff.per_km * distance) * tariff.surge_multiplier));
    const order = {
      id: store.nextOrderId(), client: 'Qo\'lda kiritilgan', client_id: '-', client_phone: b.client_phone,
      driver: null, driver_id: null, park: null,
      from_city: b.from_city, from_place: b.from_place, to_city: b.to_city, to_place: b.to_place,
      route_type: (inter ? 'inter' : 'intra') as 'inter' | 'intra', tariff: b.tariff, distance, duration: inter ? 40 : 12,
      price, commission: Math.round(price * (DEFAULT_COMMISSION / 100)), payment: b.payment, payment_status: 'pending',
      status: 'searching', cancel_reason: null, created_at: 'hozir',
    };
    store.orders.unshift(order);
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'order.create', entity: 'orders', entity_id: order.id, detail: `${b.from_city}·${b.from_place} → ${b.to_city}·${b.to_place}`, ip: req.ip ?? '' });
    return ok(res, order, null, 201);
  }),
);

const assignSchema = z.object({ driver_id: z.string().min(1) });

// POST /orders/:id/assign (BE-FR-003)
router.post(
  '/:id/assign',
  requireRole('operator', 'dispatcher', 'super_admin'),
  validate(assignSchema),
  asyncHandler(async (req, res) => {
    const o = store.findOrder(req.params.id);
    if (!o) throw ApiError.notFound('Buyurtma topilmadi');
    const d = store.findDriver((req.body as z.infer<typeof assignSchema>).driver_id);
    if (!d) throw ApiError.notFound('Haydovchi topilmadi');
    if (d.status !== 'free') throw ApiError.conflict('Haydovchi bo\'sh emas');
    o.driver = d.full_name; o.driver_id = d.id; o.park = d.park_number; o.status = 'assigned';
    d.status = 'busy';
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'order.assign', entity: 'orders', entity_id: o.id, detail: `→ ${d.full_name}`, ip: req.ip ?? '' });
    return ok(res, o);
  }),
);

const cancelSchema = z.object({
  cancel_reason: z.string().min(3),
  cancel_by: z.enum(['client', 'driver', 'operator', 'system']).default('operator'),
});

// POST /orders/:id/cancel (BE-FR-004)
router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const o = store.findOrder(req.params.id);
    if (!o) throw ApiError.notFound('Buyurtma topilmadi');
    const b = cancelSchema.parse(req.body);
    o.status = 'cancelled'; o.cancel_reason = b.cancel_reason;
    if (o.driver_id) { const d = store.findDriver(o.driver_id); if (d) d.status = 'free'; }
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'order.cancel', entity: 'orders', entity_id: o.id, detail: `${b.cancel_by}: ${b.cancel_reason}`, ip: req.ip ?? '' });
    return ok(res, o);
  }),
);

export default router;
