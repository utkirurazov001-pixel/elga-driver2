import { Router } from 'express';
import { z } from 'zod';
import { store } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok, paginate } from '../utils/response';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { pageParams, qstr, matches } from '../utils/query';
import { CITIES, REGION } from '../config/constants';

const router = Router();
router.use(authenticate);

// Shaharlar / zonalar
router.get(
  '/cities',
  asyncHandler(async (_req, res) =>
    ok(
      res,
      CITIES.map((name) => ({
        name,
        region: REGION,
        is_active: true,
        drivers: store.drivers.filter((d) => d.city === name).length,
        orders: store.orders.filter((o) => o.from_city === name).length,
        places: store.places.filter((p) => p.city === name).length,
      })),
    ),
  ),
);

// Mo'ljallar / manzillar lug'ati (to'planadi)
router.get(
  '/places',
  asyncHandler(async (req, res) => {
    const { page, limit } = pageParams(req);
    const q = qstr(req, 'q');
    const city = qstr(req, 'city');
    const source = qstr(req, 'source');
    const rows = store.places
      .filter((p) => matches(p, q, ['name', 'city']) && (!city || p.city === city) && (!source || p.source === source))
      .sort((a, b) => b.count - a.count);
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows, meta);
  }),
);

const placeSchema = z.object({ city: z.enum(CITIES), name: z.string().min(1) });

router.post(
  '/places',
  requireRole('super_admin', 'operator', 'dispatcher'),
  validate(placeSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof placeSchema>;
    const p = store.regPlace(b.city, b.name, 'kiritilgan');
    return ok(res, p, null, 201);
  }),
);

// Audit jurnali (super_admin) — immutable
router.get(
  '/audit',
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const { page, limit } = pageParams(req);
    const q = qstr(req, 'q');
    const entity = qstr(req, 'entity');
    const rows = store.audit.filter((a) => matches(a, q, ['action', 'user', 'entity_id', 'detail']) && (!entity || a.entity === entity));
    const { rows: pageRows, meta } = paginate(rows, page, limit);
    return ok(res, pageRows, meta);
  }),
);

export default router;
