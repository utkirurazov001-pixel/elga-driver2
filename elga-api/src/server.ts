import http from 'http';
import { createApp } from './app';
import { env } from './config/env';
import { store } from './store';
import { logger } from './utils/logger';
import { setupSocket, emitEvent } from './realtime/io';

async function main(): Promise<void> {
  await store.init();
  logger.info(
    env.usesMemoryStore
      ? "In-memory store tayyor (DATABASE_URL bo'sh — skelet/demo rejimi)"
      : 'Store tayyor (Prisma ulanishi keyingi fazada)',
  );

  const app = createApp();
  const server = http.createServer(app);
  setupSocket(server); // Socket.IO (WS) — JWT bilan

  // Davriy real-vaqt hodisalar (WS-05 kpi:update 30s + driver:location)
  setInterval(() => {
    // haydovchilarni biroz siljitamiz
    const moved = store.drivers.filter((d) => d.status === 'free' || d.status === 'busy').slice(0, 25);
    moved.forEach((d) => { d.lat += (Math.random() - 0.5) * 0.006; d.lng += (Math.random() - 0.5) * 0.006; });
    emitEvent('driver:location', moved.map((d) => ({ id: d.id, lat: d.lat, lng: d.lng, status: d.status })));
  }, 3000);

  setInterval(() => {
    const active = store.drivers.filter((d) => d.status === 'free' || d.status === 'busy').length;
    const revenue = store.orders.filter((o) => o.payment_status === 'paid').reduce((s, o) => s + o.price, 0);
    emitEvent('kpi:update', { orders_today: store.orders.length, active_drivers: active, revenue_today: revenue });
  }, 30000);

  server.listen(env.port, () => {
    logger.info(`ELGA API ishga tushdi → http://localhost:${env.port}/health  · WS + 1226`);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Server ishga tushmadi');
  process.exit(1);
});
