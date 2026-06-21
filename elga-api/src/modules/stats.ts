import { Router } from 'express';
import { store } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate); // dashboard barcha rollarga (TZ §4.2)

// BE-FR-040 — KPI
router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const today = store.orders;
    const active = store.drivers.filter((d) => d.status === 'free' || d.status === 'busy').length;
    const revenue = store.orders.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + o.price, 0);
    const completed = today.filter((o) => o.status === 'completed').length;
    const cancelled = today.filter((o) => o.status === 'cancelled').length;
    return ok(res, {
      orders_today: today.length,
      active_drivers: active,
      drivers_total: store.drivers.length,
      revenue_today: revenue,
      commission_today: Math.round(revenue * 0.15),
      new_clients: store.clients.filter((c) => c.registered_at.includes('Iyun')).length,
      avg_wait_min: 3.4,
      cancel_rate: today.length ? +((cancelled / today.length) * 100).toFixed(1) : 0,
      status_breakdown: { completed, in_progress: today.filter((o) => o.status === 'in_progress').length, cancelled },
      driver_status: {
        free: store.drivers.filter((d) => d.status === 'free').length,
        busy: store.drivers.filter((d) => d.status === 'busy').length,
        offline: store.drivers.filter((d) => d.status === 'offline').length,
        blocked: store.drivers.filter((d) => d.status === 'blocked').length,
      },
    });
  }),
);

// BE-FR-041 — chart
router.get(
  '/chart',
  asyncHandler(async (req, res) => {
    const period = String(req.query.period ?? '14');
    const n = period === 'week' ? 7 : period === 'month' ? 30 : 14;
    const labels: string[] = [];
    const completed: number[] = [];
    const cancelled: number[] = [];
    for (let i = n - 1; i >= 0; i--) {
      labels.push(String(21 - (i % 28)).padStart(2, '0'));
      completed.push(300 + Math.round(Math.sin(i) * 80 + i * 18));
      cancelled.push(40 + Math.round(Math.cos(i) * 14 + i * 3));
    }
    return ok(res, { labels, completed, cancelled });
  }),
);

export default router;
