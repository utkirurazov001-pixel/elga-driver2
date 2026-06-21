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
      rows = [...rows].sort((a, b) => {
        const x = val(a);
        const y = val(b);
        if (x === y) return 0;
        return (x > y ? 1 : -1) * dir;
      });
    }
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows.map((d) => serialize(d, req.user!.role)), meta);
  }),
);

// GET /drivers/leaderboard — top haydovchilar (ball/buyurtma/balans)
router.get(
  '/leaderboard',
  asyncHandler(async (_req, res) => {
    const rows = store.drivers
      .map((d) => ({ ...store.scoreDriver(d.id), full_name: d.full_name, park_number: d.park_number, city: d.city, balance: d.balance, orders_count: d.orders_count }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    return ok(res, rows);
  }),
);

// GET /drivers/shifts/recent — so'nggi smenalar (online vaqt)
router.get(
  '/shifts/recent',
  asyncHandler(async (_req, res) => {
    const rows = store.shifts.slice(0, 30).map((s) => {
      const d = store.findDriver(s.driver_id);
      return { ...s, full_name: d?.full_name ?? '', park_number: d?.park_number ?? 0, active: s.ended_at == null };
    });
    return ok(res, rows);
  }),
);

// GET /drivers/documents/expiring — muddati yaqin yoki o'tgan hujjatlar
router.get(
  '/documents/expiring',
  requireRole('super_admin', 'operator'),
  asyncHandler(async (_req, res) => {
    const now = new Date(2026, 5, 21).getTime();
    const rows: Array<Record<string, unknown>> = [];
    store.drivers.forEach((d) => {
      d.docs.forEach((doc) => {
        const exp = parseDate(doc.expires_at);
        const days = Math.round((exp - now) / 86400000);
        if (days <= 30) rows.push({ driver_id: d.id, full_name: d.full_name, park_number: d.park_number, type: doc.type, status: doc.status, expires_at: doc.expires_at, days_left: days });
      });
    });
    rows.sort((a, b) => (a.days_left as number) - (b.days_left as number));
    return ok(res, rows);
  }),
);

function parseDate(s: string): number {
  const mm: Record<string, number> = { Yan: 0, Fev: 1, Mar: 2, Apr: 3, May: 4, Iyun: 5, Iyul: 6, Avg: 7, Sen: 8, Okt: 9, Noy: 10, Dek: 11 };
  const m = s.match(/(\d+)-(\w+)\s+(\d+)/);
  if (!m) return Date.now();
  return new Date(Number(m[3]), mm[m[2]!] ?? 0, Number(m[1])).getTime();
}

router.get(
  '/:id',
  requireRole('super_admin', 'operator', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const d = store.findDriver(req.params.id);
    if (!d) throw ApiError.notFound('Haydovchi topilmadi');
    return ok(res, { ...serialize(d, req.user!.role), score: store.scoreDriver(d.id) });
  }),
);

// GET /drivers/:id/score — scoring
router.get(
  '/:id/score',
  asyncHandler(async (req, res) => {
    if (!store.findDriver(req.params.id)) throw ApiError.notFound('Haydovchi topilmadi');
    return ok(res, store.scoreDriver(req.params.id));
  }),
);

// GET /drivers/:id/wallet — hamyon + ledger
router.get(
  '/:id/wallet',
  asyncHandler(async (req, res) => {
    const d = store.findDriver(req.params.id);
    if (!d) throw ApiError.notFound('Haydovchi topilmadi');
    return ok(res, { balance: d.balance, ledger: store.ledger.filter((l) => l.driver_id === d.id) });
  }),
);

// GET /drivers/:id/reviews — sharhlar
router.get(
  '/:id/reviews',
  asyncHandler(async (req, res) => {
    if (!store.findDriver(req.params.id)) throw ApiError.notFound('Haydovchi topilmadi');
    return ok(res, store.reviews.filter((r) => r.driver_id === req.params.id));
  }),
);

// POST /drivers/:id/online — smena boshlash/tugatish (online toggle)
router.post(
  '/:id/online',
  requireRole('super_admin', 'operator', 'dispatcher'),
  asyncHandler(async (req, res) => {
    const d = store.findDriver(req.params.id);
    if (!d) throw ApiError.notFound('Haydovchi topilmadi');
    d.online = !d.online;
    if (d.online) { d.online_since = new Date().toISOString(); if (d.status === 'offline') d.status = 'free'; }
    else { d.online_since = null; if (d.status === 'free') d.status = 'offline'; }
    return ok(res, { id: d.id, online: d.online, status: d.status });
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
