import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.isProd ? 'info' : 'debug',
  transport: env.isProd
    ? undefined
    : { target: 'pino/file', options: { destination: 1 } },
  base: { service: 'elga-api' },
});
