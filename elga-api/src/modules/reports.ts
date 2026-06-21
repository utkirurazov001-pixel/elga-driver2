import { Router } from 'express';
import { store } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { CITIES } from '../config/constants';

const router = Router();
router.use(authenticate, requireRole('super_admin', 'finance_admin', 'operator'));

// GET /reports?type=daily|monthly — agregatsiya hisobot
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const type = String(req.query.type ?? 'daily');
    const paid = store.orders.filter((o) => o.payment_status === 'paid');
    const revenue = paid.reduce((s, o) => s + o.price, 0);
    const commission = paid.reduce((s, o) => s + o.commission, 0);
    const byCity = CITIES.map((city) => {
      const ords = store.orders.filter((o) => o.from_city === city);
      const rev = ords.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + o.price, 0);
      return { city, orders: ords.length, revenue: rev };
    });
    const byTariff = ['ekonom', 'komfort', 'biznes'].map((t) => ({ tariff: t, orders: store.orders.filter((o) => o.tariff === t).length }));
    return ok(res, {
      period: type,
      totals: {
        orders: store.orders.length,
        completed: store.orders.filter((o) => o.status === 'completed').length,
        cancelled: store.orders.filter((o) => o.status === 'cancelled').length,
        revenue, commission, to_drivers: revenue - commission,
        active_drivers: store.drivers.filter((d) => d.status !== 'offline' && d.status !== 'blocked').length,
        new_clients: store.clients.filter((c) => c.registered_at.includes('Iyun')).length,
      },
      by_city: byCity,
      by_tariff: byTariff,
    });
  }),
);

export default router;
