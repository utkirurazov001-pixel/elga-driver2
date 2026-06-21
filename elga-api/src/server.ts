import { createApp } from './app';
import { env } from './config/env';
import { store } from './store';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  if (env.usesMemoryStore) {
    await store.init();
    logger.info('In-memory store tayyor (DATABASE_URL bo\'sh — skelet/demo rejimi)');
  } else {
    // Production: bu yerda Prisma client ulanadi (keyingi faza)
    logger.info('DATABASE_URL berilgan — Prisma ulanishi keyingi fazada');
    await store.init(); // hozircha demo ma'lumot bilan
  }

  const app = createApp();
  app.listen(env.port, () => {
    logger.info(`ELGA API ishga tushdi → http://localhost:${env.port}/health  · 1226`);
  });
}

main().catch((err) => {
  logger.error({ err }, 'Server ishga tushmadi');
  process.exit(1);
});
