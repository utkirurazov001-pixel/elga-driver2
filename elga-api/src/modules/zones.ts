import { Router } from 'express';
import { z } from 'zod';
import { store } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { pointInPolygon } from '../utils/geo';
import { CITIES } from '../config/constants';

const router = Router();
router.use(authenticate);

// GET /zones — geo-zonalar (poligon + surge)
router.get('/', asyncHandler(async (_req, res) => ok(res, store.zones)));

const zoneSchema = z.object({
  name: z.string().min(2),
  city: z.enum(CITIES),
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
  surge: z.number().min(1).max(5).default(1),
});

router.post(
  '/',
  requireRole('super_admin', 'operator'),
  validate(zoneSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof zoneSchema>;
    const zone = { id: `ZN${store.zones.length + 1}`, ...b, is_active: true };
    store.zones.push(zone);
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'zone.create', entity: 'zones', entity_id: zone.id, detail: zone.name, ip: req.ip ?? '' });
    return ok(res, zone, null, 201);
  }),
);

// GET /zones/locate?lat=&lng= — nuqta qaysi zonada (point-in-polygon)
router.get(
  '/locate',
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const found = store.zones.filter((z) => z.is_active && pointInPolygon(lat, lng, z.polygon));
    return ok(res, { zones: found.map((z) => ({ id: z.id, name: z.name, surge: z.surge })), surge: found.reduce((m, z) => Math.max(m, z.surge), 1) });
  }),
);

export default router;
