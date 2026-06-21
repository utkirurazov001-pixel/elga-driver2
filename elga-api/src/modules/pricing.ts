import { Router } from 'express';
import { z } from 'zod';
import { store } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';
import { ApiError } from '../utils/errors';
import { authenticate } from '../middleware/auth';
import { CITIES, TARIFFS } from '../config/constants';

const router = Router();
router.use(authenticate);

/** Talab/taklif nisbatidan surge koeffitsienti (shahar bo'yicha). */
export function surgeForCity(city: string): number {
  const demand = store.orders.filter((o) => (o.status === 'searching' || o.status === 'new') && o.from_city === city).length;
  const supply = store.drivers.filter((d) => d.status === 'free' && d.city === city).length;
  const ratio = supply > 0 ? demand / supply : demand > 0 ? 3 : 0;
  if (ratio >= 2) return 2.0;
  if (ratio >= 1.2) return 1.6;
  if (ratio >= 0.8) return 1.3;
  if (ratio >= 0.4) return 1.1;
  return 1.0;
}

/** Vaqt koeffitsienti — tun (22:00–06:00) 1.2. */
export function timeMultiplier(date = new Date()): number {
  const h = date.getHours();
  return h >= 22 || h < 6 ? 1.2 : 1.0;
}

/** Narx hisoblash (BE-FR-005). */
export function estimateFare(tariffName: string, distanceKm: number, durationMin: number, city: string) {
  const tariff = store.tariffs.find((t) => t.name === tariffName);
  if (!tariff) throw ApiError.badRequest('Tarif topilmadi');
  const surge = Math.max(surgeForCity(city), tariff.surge_multiplier);
  const time = timeMultiplier();
  const raw = tariff.base_fare + tariff.per_km * distanceKm + tariff.per_min * durationMin;
  const price = Math.max(tariff.min_fare, Math.round(raw * surge * time));
  const commission = Math.round(price * (tariff.commission_percent / 100));
  return {
    tariff: tariffName, distance_km: +distanceKm.toFixed(1), duration_min: durationMin,
    base_fare: tariff.base_fare, surge_multiplier: surge, time_multiplier: time,
    price, commission, driver_earning: price - commission,
  };
}

const estSchema = z.object({
  tariff: z.enum(TARIFFS),
  distance_km: z.number().positive(),
  duration_min: z.number().positive(),
  city: z.enum(CITIES),
});

// POST /pricing/estimate — narx kalkulyatori
router.post(
  '/estimate',
  asyncHandler(async (req, res) => {
    const b = estSchema.parse(req.body);
    return ok(res, estimateFare(b.tariff, b.distance_km, b.duration_min, b.city));
  }),
);

// GET /pricing/surge — barcha shaharlar surge koeffitsienti
router.get(
  '/surge',
  asyncHandler(async (_req, res) => {
    return ok(
      res,
      CITIES.map((city) => ({
        city,
        surge: surgeForCity(city),
        demand: store.orders.filter((o) => (o.status === 'searching' || o.status === 'new') && o.from_city === city).length,
        free_drivers: store.drivers.filter((d) => d.status === 'free' && d.city === city).length,
      })),
    );
  }),
);

export default router;
