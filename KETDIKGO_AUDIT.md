# KetdikGo — Real-time audit va tuzatishlar hisoboti

**Sana:** 2026-07-03
**Qamrov:** Haydovchi ilovasi (`App.js`), Mijoz ilovasi (`elga-mijoz/App.js`)
**Backend:** `api.elga.uz` (Socket.IO) — bu sessiyada kod bazasiga kirish yo'q; backend talab qilinadigan ishlar alohida belgilangan.

---

## 1. Arxitektura xaritasi (real-time)

```
MIJOZ ilovasi                     BACKEND (api.elga.uz)                 HAYDOVCHI ilovasi
─────────────                     ─────────────────────                 ─────────────────
POST /api/orders  ───────────────►  buyurtma yaratiladi
                                     yaqin haydovchilarga broadcast ───►  socket 'new_order'  (OFFER)
                                                                          orderAction('accept')
socket 'order_update' (accepted) ◄──  assign (atomik bo'lishi kerak) ◄──  POST /api/orders/:id/accept
socket 'driver_location' ◄─────────  har ~2-4s haydovchi joylashuvi ◄──  socket 'location'
socket 'meter'/'wait_update' ◄─────  taksometr / kutish haqi
socket 'order_update' (completed)◄─  yakun  ◄──────────────────────────  orderAction('complete')
```

**Ikkala ilovada umumiy ishonchlilik qatlamlari (allaqachon mavjud):**
- Socket.IO `reconnection: Infinity`, exponential backoff (1s→30s), `randomizationFactor` (thundering herd yo'q).
- `connectSocket()` eski soketni `removeAllListeners()+disconnect()` bilan tozalaydi — dublikat event / memory leak yo'q.
- `resumeActiveOrder()` — server = yagona haqiqat manbai; connect/reconnect/foreground/internet qaytganda REST orqali holat tiklanadi.
- Backup REST polling socket uzilganda; reachability heartbeat (`/health`).
- Faol buyurtma `AsyncStorage`da saqlanadi — crash/kill/OS-restartда tiklanadi.
- Haydovchida: offline amal navbati (`OfflineQueue`), 409 konflikt boshqaruvi.

---

## 2. Priority 1 — root-cause: "buyurtma keldi va ~5s'da yo'qoldi"

**Ildiz sabab.** Haydovchi ilovasi har 5 soniyada `resumeActiveOrder()` orqali `/api/me/active-order` ni so'raydi. Hali **qabul qilinmagan OFFER** (status `searching`/`assigned`) server tomonда haydovchining "faol buyurtmasi" emas — server `null` qaytaradi. Eski kod esa `ACTIVE_STATUSES` (unда `searching`/`assigned` ham bor edi) ичидаги **istalgan** buyurtmani null qilardi. Natijada taklif ekranда ~5s ko'rinib, keyingi polling'da yo'qolardi.

**Tuzatish** (`App.js`, commit `8272c4f`, main'ga merge qilindi #26):
- `OFFER_STATUSES` (`searching`,`assigned`) va `ACCEPTED_STATUSES` (`accepted`,`arrived`,`in_progress`) ajratildi (`App.js:45`, `App.js:48`).
- Polling faqat `ACCEPTED_STATUSES` dagi buyurtmani tozalaydi — taklifga tegmaydi (`App.js:999`).
- Taklif uchun alohida TTL taymer: server bergan `offer_ttl_ms` yoki 30s (`App.js:921-927`).
- `order_taken` handleri — boshqa haydovchi olganда taklif darrov yopiladi (`App.js:970`).

---

## 3. Haydovchi ilovasi — topilmalar jadvali

| # | Topilma | Joy (`fayl:qator`) | Jiddiylik | Holat |
|---|---------|--------------------|-----------|-------|
| D1 | OFFER polling bilan tozalanib "keldi va yo'qoldi" | `App.js:999` | 🔴 Kritik | ✅ Tuzatildi (P1) |
| D2 | Kechikkan `order_update` holatni orqaga qaytaradi (masalan `accepted`→`assigned`) | `App.js:975` | 🟠 Yuqori | ✅ Tuzatildi (`isForwardUpdate`) |
| D3 | Chat xabari socket uzilganда jim yo'qoladi (mijozga bormaydi), UI'da esa "yuborildi" | `App.js:sendChat` | 🟠 Yuqori | ✅ Tuzatildi (chat outbox + reconnect flush) |
| D4 | Remote push yo'q — ilova yopiq/fonда yangi buyurtma push kelmaydi (faqat local notif) | `App.js` (yo'q edi) | 🟠 Yuqori | ✅ Klient qismi qo'shildi; **backend Expo push yuborishi kerak** |
| D5 | Offer TTL — qabul qilinmagan taklif abadiy osilib qolishi mumkin edi | `App.js:921` | 🟠 Yuqori | ✅ Tuzatildi (TTL taymer) |
| D6 | Atomik assignment — ikki haydovchi bir buyurtmani olishi | server-side | 🟠 Yuqori | ⚠️ Klientда 409 ko'rib tiklanadi (`App.js:orderAction`); **atomiklik backendда kafolatlanishi kerak** |
| D7 | Bir joyда turgan haydovchida "GPS signal yo'q", joylashuv muzlashi | `App.js:startTracking` | 🟠 Yuqori | ✅ Oldин tuzatilgan (`distanceInterval:0`, threshold 45s) |
| D8 | Ovozli buyurtmada oq ekran / crash | `App.js` OrderPanel | 🟠 Yuqori | ✅ Oldин tuzatilgan (ErrorBoundary + safe voice) |
| D9 | Reconnectда faol buyurtma sinxronlanmasligi | `App.js:onUp` | 🟡 O'rta | ✅ Mavjud (`resumeActiveOrder` on connect/reconnect) |
| D10 | Reconnectда soket listenerlari ikkilanib, dublikat `new_order` | `App.js:connectSocket` | 🟡 O'rta | ✅ Mavjud (`removeAllListeners` on reconnect) |
| D11 | Offline amal (accept/complete) internet yo'qда yo'qolishi | `App.js:OfflineQueue` | 🟡 O'rta | ✅ Mavjud (offline queue + flush) |
| D12 | `order_update` yakunlangan buyurtmani qayta tiriltirishi (kechikkan event) | `App.js:975` | 🟡 O'rta | ⚠️ Qisman: forward-guard bor; to'liq resurrect-guard mijozda qo'shildi, haydovchida buyurtma yakunда `null`, past xavf |

**Yakuniy holat:** 12 topilma; kritik+yuqori barchasi klient tomonда yopildi. D4/D6 backend hamkorligini talab qiladi.

---

## 4. Mijoz ilovasi — topilmalar jadvali

| # | Topilma | Joy (`fayl:qator`) | Jiddiylik | Holat |
|---|---------|--------------------|-----------|-------|
| M1 | Kechikkan `order_update` holatni orqaga qaytaradi | `elga-mijoz/App.js:918` | 🟠 Yuqori | ✅ Tuzatildi (`isForwardUpdate`) |
| M2 | Yakunlangan buyurtма kechikkan `completed` event bilan qayta ochilib, rate modal takror chiqishi | `elga-mijoz/App.js:918` | 🟠 Yuqori | ✅ Tuzatildi (`finishedOrderIdRef`) |
| M3 | Chat xabari socket uzilganда yo'qoladi (haydovchiga bormaydi) | `elga-mijoz/App.js:sendTripChat` | 🟠 Yuqori | ✅ Tuzatildi (chat outbox + reconnect flush) |
| M4 | Remote push yo'q — "Haydovchi topildi/yetib keldi" ilova yopiqда kelmaydi | `elga-mijoz/App.js` | 🟠 Yuqori | ✅ Klient qismi qo'shildi; **backend Expo push yuborishi kerak** |
| M5 | Adres qidiruv scroll ishlamasligi | `elga-mijoz/App.js` | 🟡 O'rta | ✅ Oldин tuzatilgan (flex/maxHeight) |
| M6 | Tarif ro'yxati scroll + "Tejamkor" ko'rinmasligi | `elga-mijoz/App.js` | 🟡 O'rta | ✅ Oldин tuzatilgan |
| M7 | 409 (faol buyurtма bor)да ekran ochilmasligi | `elga-mijoz/App.js:openActiveOrder` | 🟡 O'rta | ✅ Oldин tuzatilgan |
| M8 | Haydovchi ma'lumoti mijozga kech kelishi | `elga-mijoz/App.js:705` polling | 🟡 O'rta | ✅ Oldин tuzatilgan (5s polling + xavfsiz merge) |
| M9 | "Qayerga borasiz?" maydoni ko'rinmasligi | `elga-mijoz/App.js` | 🟡 O'rta | ✅ Oldин tuzatilgan (prominent field) |
| M10 | Reconnect/foreground/internet qaytganда holat tiklanishi | `elga-mijoz/App.js:ensureSocketConnected` | 🟡 O'rta | ✅ Mavjud |
| M11 | Reconnectда dublikat `driver_location`/`meter` (listener leak) | `elga-mijoz/App.js:connectSocket` | 🟡 O'rta | ✅ Mavjud (`removeAllListeners`) |
| M12 | Crash recovery — faol buyurtma lokal saqlanishi | `elga-mijoz/App.js:672` | 🟡 O'rta | ✅ Mavjud |
| M13 | "Haydovchi qidirilmoqda" — timeout/radius kengaytirish (bosqichma-bosqich) | server-side | 🟡 O'rta | ⚠️ **Backend:** radius eskalatsiya + timeout kerak |

**Yakuniy holat:** 13 topilma; yuqori jiddiylikdagilar klientда yopildi. M4/M13 backend hamkorligini talab qiladi.

---

## 5. Real-time yetkazish kafolatlari (holat)

| Kafolat | Holat |
|---------|-------|
| Reconnect → faol buyurtма qayta sinxron | ✅ Ikkala ilovада (`resumeActiveOrder` on connect/reconnect) |
| Reconnect → chat outbox flush | ✅ Qo'shildi (ikkalasида) |
| Reconnect → oxirgi joylashuvni darrov emit | ✅ Haydovchида (`onUp`) |
| Buyurtma persist (crash/kill) | ✅ Ikkалаsида (`AsyncStorage`) |
| Offline amal navbati + retry | ✅ Haydovchида (`OfflineQueue`) |
| Status regress himoyasi | ✅ Qo'shildi (ikkалаsида, `isForwardUpdate`) |
| Push (socket + remote) | ⚠️ Klient token registratsiyasi qo'shildi; **backend Expo push yuborishi kerak** |
| Socket ACK + retry (chat) | 🟡 Outbox bilan best-effort; to'liq ACK backend qo'llabini talab qiladi |

---

## 6. Backend uchun qoladigan ishlar (elga-backend — bu sessiyada kirish yo'q)

1. **`POST /api/me/push-token`** endpointi — `{ token, platform, deviceId }` ni saqlash.
2. **Expo push yuborish** — hodisalarда socket bilan bir qatorда:
   - Haydovchи: `new_order` → push "🚖 Yangi buyurtma".
   - Mijoz: `accepted` → "Haydovchi topildi", `arrived` → "Haydovchи yetib keldi".
   - Expo push API: `https://exp.host/--/api/v2/push/send`.
3. **Atomik assignment** — buyurtмани faqat bitta haydovchiga (DB transaction / `UPDATE ... WHERE status='searching'`); boshqalarga `order_taken` emit.
4. **`order_update` ga `updated_at`/`seq`** qo'shish — klient regress-guard'i yanада aniq bo'lishi uchun.
5. **"Qidirilmoqda" radius eskalatsiyasi** + timeout (masalan 60s dan keyin radiusni kengaytirish yoki bekor qilish).
6. **Ovozli buyurtma** (`POST /api/voice/parse`) — `backend/voiceParse.js` moduli tayyor; integratsiya `backend/README_VOICE.md`.

---

## 7. Play Store'ga tayyorlik

| Element | Holat |
|---------|-------|
| Crash/runtime himoya | ✅ ErrorBoundary, keng `try/catch`, xavfsiz voice/audio |
| Ruxsatlar (location, notifications) | ✅ `app.json`да e'lon qilingan; foreground so'raladi |
| Aniq joylashuv (2026 Google qoidasi) | ⚠️ `ACCESS_FINE_LOCATION` bor; Data Safety formада aniq joylashuv sababini yozish kerak |
| Data Safety deklaratsiyasi | ⚠️ Play Console'да to'ldirilishi kerak (joylashuv, push token) |
| Offline ishlash | ✅ Banner, offline queue, saqlangan holat |
| Memory/listener leak | ✅ Effekt cleanup, `removeAllListeners`, timer clear |
| versionCode/versionName | ⚠️ Har build oldidан oshirilishi kerak (haydovchи `versionCode:3`, mijoz `:2`) |
| Push token | ✅ Klient qo'shildi; backend yuborishi kerak |

---

## 8. Qolgan risklar

- **Backend hamkorligисиз** push va atomik assignment to'liq kafolatlanmaydi (klient qismi tayyor).
- **Brend:** hozирги kod "Ketdik" (nom) ishlatadi. Spetsifikatsия "KetdikGo" + slogan "Belgila. Ko'r. Ketdik." + domen `ketdikgo.uz` talab qiladi — bu foydalanuvchи tasdig'idан keyin qo'llaniladi (pastдаги eslatma).
- **Tekshirish:** o'zgarishlар `@babel/parser` bilan sintaksis + aniqlanmagан-havolа tekshiruvидан o'tди; jonli qurilmада (EAS build) yakuniy sinov tavsiya etiladi.
