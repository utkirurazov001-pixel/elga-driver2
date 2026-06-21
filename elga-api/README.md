# ELGA TAXI 1226 — Backend API (`api.elga.uz`)

Node.js 20 · TypeScript (strict) · Express · Zod · JWT + bcrypt · RBAC · pino.
TZ (`ELGA1226_Backend_TZ.md`) §2–§9 asosida.

## Ishga tushirish

```bash
cd elga-api
npm install
cp .env.example .env      # qiymatlarni to'ldiring (DATABASE_URL bo'sh bo'lsa demo rejimi)
npm run dev               # http://localhost:3000/health
```

`DATABASE_URL` **bo'sh** bo'lsa server **in-memory store** bilan ishlaydi (skelet/demo) —
admin panel darhol ulanib real ishlaydi. To'ldirilsa, Prisma + PostgreSQL ga o'tadi.

## Demo kirish

`POST /v1/auth/login` → `{ "login": "admin", "password": "elga1226" }`

5 rol: `admin` (super_admin), `operator1`, `finance1`, `disp1`, `mod1` — barchasi `elga1226`.

## Asosiy endpointlar (TZ §6)

| Metod | Yo'l | Rol |
|------|------|-----|
| GET | `/health` | public |
| POST | `/v1/auth/login` · `/auth/refresh` · `/auth/me` · `/auth/logout` | — |
| GET | `/v1/stats/dashboard` · `/stats/chart` | barcha |
| GET | `/v1/drivers` (+`/:id`, `/block`, `/unblock`, `/kyc`) | super_admin, operator, dispatcher |
| GET | `/v1/clients` (+`/:id`, `/block`) | super_admin, operator |
| GET/POST | `/v1/orders` (+`/:id`, `/assign`, `/cancel`) | super_admin, operator, dispatcher |
| GET | `/v1/finance/summary` · `/transactions` · `/withdrawals` | super_admin, finance_admin |
| POST | `/v1/finance/withdrawals/:id/approve` (**2-bosqich**) · `/reject` | super_admin, finance_admin |
| GET/PATCH | `/v1/tariffs` (+`/:id`) | finance_admin, super_admin |
| GET | `/v1/complaints` (+`/respond`, `/resolve`) | super_admin, operator, moderator |
| GET | `/v1/loyalty/rewards` · `/promo-codes` · POST `/loyalty/adjust` | turli |
| GET | `/v1/cities` · `/v1/places` (+POST) · `/v1/audit` | turli |

Javob konverti **doimo**: `{ success, data, error, meta }`.

## Xavfsizlik (TZ §9)

- Zod validatsiya (BE-SEC-01), helmet + CORS allowlist + rate-limit (BE-SEC-03)
- Parol bcrypt cost 12 (AUTH-01), JWT access/refresh (AUTH-02)
- RBAC server-side (RBAC-01), ruxsatsiz → 403 + audit (RBAC-02)
- Telefon maskirovka, to'liq raqam faqat super_admin/operator (RULE-06)
- Audit jurnali har muhim amalda (BE-SEC-07)
- Maxfiy kalitlar faqat `.env` (BE-SEC-04)

## Production (PostgreSQL)

```bash
# .env da DATABASE_URL to'ldiring
npm run prisma:generate
npm run prisma:migrate
npm run seed
```

Prisma schema: `prisma/schema.prisma` (TZ §3 — 21 jadval, DATA-01..21 + Place lug'ati).

## Tuzilish

```
src/
  config/      env, constants (1226, shaharlar, brend)
  utils/       response (envelope), jwt, mask, logger, errors, query
  middleware/  auth, rbac, validate, error
  store/       in-memory store (Prisma bilan almashtiriladi)
  modules/     auth, stats, drivers, clients, orders, finance, tariffs,
               complaints, loyalty, system (cities/places/audit)
  app.ts, server.ts, routes.ts
prisma/        schema.prisma, seed.ts
```
