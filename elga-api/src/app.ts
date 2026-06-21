import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { DISPATCHER, BRAND } from './config/constants';
import { logger } from './utils/logger';
import { ok } from './utils/response';
import { notFound, errorHandler } from './middleware/error';
import routes from './routes';

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // origin yo'q (curl/health) yoki allowlistda bo'lsa ruxsat (BE-SEC-03)
        // Ruxsatsiz manba — 500 emas, shunchaki CORS sarlavhasiz (brauzer bloklaydi)
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  // Rate-limit (BE-SEC-03)
  app.use('/v1', rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

  // Health-check (NFR-05) — DB/Redis holati (memory rejimda ham yashil)
  app.get('/health', (_req, res) => {
    ok(res, {
      status: 'ok',
      service: 'api.elga.uz',
      dispatcher: DISPATCHER,
      brand: BRAND.name,
      mode: env.usesMemoryStore ? 'memory (skelet)' : 'postgres',
      uptime: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  });

  app.use('/v1', routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
