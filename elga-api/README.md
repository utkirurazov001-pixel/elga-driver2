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

### Operatsion funksiyalar (Uber/Yandex uslubi)

| Metod | Yo'l | Tavsif |
|------|------|--------|
| POST | `/v1/pricing/estimate` | Narx kalkulyatori (base+km+min+surge+tun) |
| GET | `/v1/pricing/surge` | Dinamik surge (talab/taklif) |
| POST | `/v1/orders/:id/auto-assign` | Avtomatik eng yaqin bo'sh haydovchi |
| POST | `/v1/orders/:id/reassign` · `/rate` | Qayta tayinlash · baho+sharh |
| GET | `/v1/drivers/leaderboard` · `/:id/score` | Top haydovchilar · scoring |
| GET | `/v1/drivers/:id/wallet` · `/reviews` · `/shifts/recent` | Hamyon · sharhlar · smenalar |
| POST | `/v1/drivers/:id/online` | Smena (online toggle) |
| GET | `/v1/drivers/documents/expiring` | Hujjat muddati eslatmasi |
| GET/POST | `/v1/zones` · `/zones/locate` | Geo-zona poligonlari (point-in-polygon) |
| GET | `/v1/stats/heatmap` | Talab heatmap |
| GET/POST | `/v1/campaigns` | Segmentlangan push/SMS kampaniya |
| GET | `/v1/reports?type=daily\|monthly` | Agregatsiya hisobot |
| GET/POST | `/v1/corporate` (+`/:id/invoice`) | B2B akkaunt + hisob-faktura |
| GET/PATCH | `/v1/work-rules` | Komissiya qoidalari (tarif/haydovchi) |
| POST | `/v1/loyalty/redeem` · `/promo-codes/validate` | Almashtirish · promo tekshirish |
| GET | `/v1/clients/:id/orders` | Mijoz safar tarixi |

### To'lov · Real-time · Xavfsizlik (yangi)

| Metod | Yo'l | Tavsif |
|------|------|--------|
| POST | `/v1/payments/payme` | Payme Merchant JSON-RPC (Check/Create/Perform/Cancel/Check/Statement) · Basic auth |
| POST | `/v1/payments/click/prepare` · `/complete` | Click Shop API · MD5 imzo tekshiruvi |
| POST | `/v1/auth/2fa/setup` · `/2fa/verify` | TOTP 2FA (otpauth URL) |
| GET/POST | `/v1/admin/users` (+PATCH/DELETE `/:id`) | Xodimlar CRUD (super_admin) |
| WS | `socket.io` (JWT auth) | `order:new`, `order:updated`, `driver:location`, `driver:status`, `kpi:update` |

- **Test**: `npm test` (Vitest + Supertest, 17 ta) — auth, RBAC, narx, auto-assign, 2-bosqich withdrawal, Payme, Click, 2FA, admin CRUD
- **CI**: `.github/workflows/ci.yml` — typecheck + test + build (har PR'da)
- **Deploy**: `render.yaml` (api + PostgreSQL 16 + Redis) · `Dockerfile`

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
