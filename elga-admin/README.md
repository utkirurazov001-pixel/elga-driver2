# ELGA TAXI 1226 — Super Admin paneli

`app.elga.uz` uchun boshqaruv paneli. Dizayn namunasi (ELGA_Admin_1.html) asosida
qurilgan, **toza HTML/CSS/JS** (build talab qilmaydi). Backend (`api.elga.uz`) tayyor
bo'lganda `assets/js/data.js` mock qatlami `fetch()` bilan almashtiriladi.

## Ishga tushirish (lokal)

Hech qanday o'rnatish kerak emas — `index.html` ni brauzerda oching, yoki kichik server:

```bash
cd elga-admin
python3 -m http.server 5173
# brauzer: http://localhost:5173
```

**Demo kirish:** login `admin` · parol `elga1226`

## Deploy (Cloudflare Pages — DEP-03)

Bu papka statik — to'g'ridan-to'g'ri Cloudflare Pages ga yuklanadi:
- Build command: (bo'sh)
- Output directory: `elga-admin`

## Professional imkoniyatlar (v2)

- **Real-time dvigatel** (`realtime.js`) — Socket.IO simulyatsiyasi: yangi buyurtmalar
  (`order:new`), holat o'zgarishi (`order:updated`), haydovchi harakati
  (`driver:location`), KPI jonli yangilanishi (`kpi:update`). Event bus orqali
  sahifalar avtomatik yangilanadi. `api.elga.uz` ulanganda haqiqiy socket bilan
  almashtiriladi.
- **Interaktiv xarita** (`map.js`) — Leaflet + CartoDB dark tiles, Surxondaryo
  real koordinatalari, harakatlanuvchi haydovchi markerlari, popup. Internet
  bo'lmasa nafis fallback (panel baribir ishlaydi).
- **Jadval**: ustun sarlavhasini bosib **sortlash**, **CSV eksport** (haqiqiy
  yuklab olish), filtr + qidiruv + paginatsiya.
- **⌘K command palette** — klaviaturadan istalgan bo'limga tez o'tish (↑↓ Enter).
- **Topbar**: ishlaydigan bildirishnoma paneli va profil menyusi (dropdown).
- Dashboard KPI raqamlari va jonli xarita real vaqtda yangilanib turadi.

## Bo'limlar (TZ §16 traceability)

| Bo'lim | Endpoint (kelajakda) |
|--------|----------------------|
| Boshqaruv (KPI/chart) | `GET /stats/dashboard`, `kpi:update` |
| Dispetcher | `GET /orders?status=new`, `POST /orders/:id/assign` |
| Buyurtmalar | `GET /orders` (filter/sort/pagination) |
| Jonli xarita | `driver:location`, `GET /drivers?status=free` |
| Haydovchilar / KYC / Avtopark | `GET /drivers`, `POST /drivers/:id/block`, KYC verify |
| Mijozlar | `GET /clients`, `POST /clients/:id/block` |
| Shikoyatlar | `GET /complaints`, `POST /complaints/:id/resolve` |
| Xodimlar (RBAC) | `GET /admin/users` |
| Moliya hisoboti | `GET /finance/summary` |
| Pul yechish (2-bosqich) | `POST /finance/withdrawals/:id/approve` |
| Tranzaksiyalar | `GET /finance/transactions` |
| Tariflar | `GET/PATCH /tariffs` |
| Ball / Sovg'a / Almashtirish / Promo | `/loyalty/*`, `/rewards`, `/redemptions`, `/promo-codes` |
| Shaharlar | `cities` (RULE-04) |
| Bildirishnomalar | `GET /notifications` |
| Audit jurnali | `GET /audit` (super_admin) |
| Sozlamalar (Umumiy/Rollar/To'lov/Brend) | `brand.config.json`, RBAC §4.2 |

## Fayl tuzilishi

```
elga-admin/
  index.html              # qobiq, skriptlarni yuklaydi
  brand.config.json       # brend manbai (RULE-05/07)
  assets/
    css/styles.css        # to'liq dizayn tizimi
    js/
      icons.js            # SVG ikonalar
      data.js             # MOCK ma'lumotlar bazasi (TZ §3 DATA)
      ui.js               # jadval, modal, toast, chart, paginatsiya
      modals.js           # detal/forma oynalari va amallar
      app.js              # sidebar, router, login, delegatsiya
      pages/              # har bo'lim sahifasi
```

## Brend qoidalari (buzilmaydi)

- **1226** dispetcher raqami — ishonch langari (RULE-03)
- Slogan: **«HAR DOIM YONINGIZDA!»** · ustunlar: TEZ · XAVFSIZ · ISHONCHLI
- Ranglar: `#FFCC00` / `#C9A24B` / `#15171C` · font Manrope
- Shaharlar faqat: Angor, Muzrabot, Jarqo'rg'on, Sherobod, Termiz, Denov (RULE-04)
- Telefon raqamlari maskirovkalangan: `+998 90 *** ** 45` (RULE-06)

> Mock ma'lumotlar faqat ko'rsatish uchun. Maxfiy kalitlar (.env) hech qachon
> repoga commit qilinmaydi (BE-SEC-04).
