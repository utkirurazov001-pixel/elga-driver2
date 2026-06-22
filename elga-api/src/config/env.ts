import dotenv from 'dotenv';
dotenv.config();

function str(key: string, def = ''): string {
  return process.env[key] ?? def;
}
function num(key: string, def: number): number {
  const v = process.env[key];
  return v ? Number(v) : def;
}

export const env = {
  port: num('PORT', 3000),
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',

  corsOrigins: str('CORS_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  jwt: {
    accessSecret: str('JWT_SECRET', 'dev-access-secret'),
    refreshSecret: str('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
    accessTtl: str('JWT_ACCESS_TTL', '15m'),
    refreshTtl: str('JWT_REFRESH_TTL', '7d'),
  },

  databaseUrl: str('DATABASE_URL', ''),
  redisUrl: str('REDIS_URL', ''),

  payme: {
    merchantId: str('PAYME_MERCHANT_ID', ''),
    key: str('PAYME_KEY', 'test-payme-key'),
  },
  click: {
    serviceId: str('CLICK_SERVICE_ID', ''),
    merchantId: str('CLICK_MERCHANT_ID', ''),
    secret: str('CLICK_SECRET', 'test-click-secret'),
  },

  seed: {
    adminLogin: str('SEED_ADMIN_LOGIN', 'admin'),
    adminPassword: str('SEED_ADMIN_PASSWORD', 'elga1226'),
  },

  // DATABASE_URL bo'sh bo'lsa — in-memory store (demo/skelet rejimi)
  get usesMemoryStore(): boolean {
    return !this.databaseUrl;
  },
};
