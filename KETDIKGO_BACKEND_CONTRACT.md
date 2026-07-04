# KetdikGo — Frontend ↔ Backend shartnoma (elga-backend uchun)

> Bu fayl **o'zini-o'zi to'liq** (self-contained) frontend shartnomasi. `elga-backend`ga
> scoped Claude Code sessiyasi `KETDIKGO_AUDIT.md`ni o'qiy olmaydi (u boshqa repoda),
> shuning uchun backend prompt bilan **birga shu faylni ham** tashlang. Bu yerdagi
> endpoint nomlari, payload va event nomlari **haydovchi + mijoz ilovalari haqiqiy kodidan**
> olingan — server aynan shularga 1:1 mos bo'lishi shart.

Manba fayllar (elga-driver2): haydovchi `App.js`, mijoz `elga-mijoz/App.js`.
Socket: `https://api.elga.uz`, `io(BASE, { auth: { token }, transports: ['websocket','polling'] })`.

---

## 0. Status lug'ati (AYNAN shu qiymatlar)

```
searching     -> buyurtma yaratildi, haydovchi qidirilmoqda
assigned      -> haydovchiga OFFER qilindi (hali qabul qilinmagan)   [OFFER]
accepted      -> haydovchi qabul qildi                                [ACTIVE]
arrived       -> haydovchi yetib keldi
in_progress   -> safar ketmoqda
completed     -> yakunlandi        [TERMINAL]
cancelled     -> bekor qilindi     [TERMINAL]
paid          -> to'landi          [TERMINAL]
```

- **OFFER** = `searching` yoki `assigned`. Bu haydovchining server tomonidagi "faol
  buyurtmasi" EMAS — `GET /api/me/active-order` uni QAYTARMASLIGI shart (aks holda
  frontend "buyurtma keldi va yo'qoldi" bug'iga sabab bo'ladi; frontend himoyasi bor,
  lekin server ham to'g'ri qaytarishi kerak).
- **ACTIVE (haydovchi uchun)** = `accepted`/`arrived`/`in_progress`.

---

## 1. `POST /api/me/push-token` — push token ro'yxati (ikkala ilova)

Frontend chaqiruvi (ruxsat berilgach, `registerPushToken`):
```
POST /api/me/push-token
Auth: Bearer <token>           // mavjud auth middleware (haydovchi/mijoz)
Body: {
  "token":    "ExponentPushToken[xxxxxxxx]",   // Expo push token
  "platform": "ios" | "android",
  "deviceId": "<uuid>"                          // qurilma id (AsyncStorage 'device_id')
}
```
- Frontend javobni o'qimaydi (fire-and-forget) — istalgan 2xx yetarli, `retries:1`, timeout 10s.
- **Talab:** token'ni `(user_id, deviceId)` bo'yicha **upsert** (bir foydalanuvchi bir necha qurilma).
  Additive migratsiya: `push_tokens(user_id, device_id, token, platform, updated_at)` yoki
  mavjud `users`/`drivers`ga ustun. `ExponentPushToken[...]` formatini validatsiya qil.

---

## 2. Expo push yuborish (offer + muhim status o'zgarishlari)

Socket'ga **qo'shimcha** ravishda Expo push (ilova background/killed bo'lsa ham yetsin):

| Qachon | Kimga | Sarlavha / matn (taxminiy) |
|--------|-------|-----------------------------|
| `new_order` (OFFER) yuborilganda | Haydovchi(lar)ga | "🚖 Yangi buyurtma" · manzil → narx |
| `accepted` | Mijozga | "Haydovchi topildi! 🚗" · ism · mashina |
| `arrived` | Mijozga | "Haydovchi yetib keldi ✅" |

- Expo push API: `POST https://exp.host/--/api/v2/push/send`.
- `DeviceNotRegistered` → token'ni nofaol qil/o'chir.
- Push **async**, socket oqimini bloklamasin; push xatosi buyurtmani to'xtatmasin.
- Frontend push bosilganda `resumeActiveOrder()` chaqiradi — data payload'da `orderId` bo'lsa foydali.

---

## 3. Haydovchi — offer oqimi (socket + REST)

**Server → haydovchi socket event'lari:**
```
new_order      -> order obyekti. Frontend o'qiydigan maydonlar:
                  id, status ('searching'|'assigned'), offer_ttl_ms (ixtiyoriy, ms),
                  from_address, price, from_lat, from_lng, to_lat, to_lng,
                  commission, announce_audio | voice_url (ixtiyoriy, ovozli e'lon)
                  * offer_ttl_ms berilmasa frontend 30s ishlatadi. Berilsa, server bilan mos bo'lsin.
order_taken    -> (payload shart emas) boshqa haydovchi oldi YOKI offer muddati tugadi.
                  Frontend OFFER'ni yopadi.
order_cancelled-> mijoz bekor qildi. Frontend tozalaydi.
order_update   -> qisman order (status + boshqa maydonlar). Frontend faqat OLDINGA
                  (forward) status'ni qabul qiladi (regress himoyasi bor).
chat_message   -> { sender_role, text }
meter          -> { km, minutes, fare }
wait_update    -> { waitFee, totalFare }
paid_wait_started -> (payload shart emas)
```

**Haydovchi → server (REST, auth):**
```
POST /api/orders/:id/accept    -> muvaffaqiyat: { order }.  BAND bo'lsa: HTTP 409.
POST /api/orders/:id/reject
POST /api/orders/:id/arrived
POST /api/orders/:id/start
POST /api/orders/:id/complete  -> { order } (price, commission bilan)
GET  /api/me/active-order      -> { order } yoki { order: null }
                                  * faqat ACCEPTED+ (accepted/arrived/in_progress) qaytar.
                                  * OFFER (searching/assigned) ni QAYTARMA.
GET  /api/me/earnings, /api/me/trips, POST /api/me/rate-customer/:id { stars }
```

**Haydovchi → server socket:**
```
emit('location', { lat, lng })     // adaptiv, server ~1/s cheklashi mumkin
emit('chat', { orderId, text })
```

---

## 4. Mijoz — buyurtma oqimi (socket + REST)

**Mijoz → server (REST, auth):**
```
POST /api/orders                 -> yangi buyurtma. Faol buyurtma bo'lsa: HTTP 409
                                    body: { active_order_id, active_order }
GET  /api/orders/active           -> { order }
GET  /api/me/active-order         -> { order }   (zaxira endpoint)
```

**Server → mijoz socket event'lari:**
```
order_update   -> { status, driver_name, driver_car, driver_plate, price, ... }
                  statuslar: searching, assigned, accepted, arrived, in_progress,
                  completed, cancelled
driver_location-> { lat, lng }        // haydovchi jonli joylashuvi
meter          -> { km, minutes, fare }
wait_update    -> { waitSec, waitFee, freeLeft, totalFare }
chat_message   -> { role|sender_role, text }
```

**Mijoz → server socket:**
```
emit('chat', { orderId, text })
```

---

## 5. Atomik biriktirish (Endpoint 2) — frontend kutgan xulq

`POST /api/orders/:id/accept`:
- **Shartli atomik UPDATE**: `... WHERE id=$id AND status='searching' AND driver_id IS NULL`.
- `RETURNING` bo'sh → boshqa haydovchi olgan → **HTTP 409** (frontend buni maxsus ko'radi:
  `resumeActiveOrder()` chaqirib holatni tiklaydi, xato ko'rsatmaydi).
- Yutgan haydovchiga → `{ order }` (status `accepted`); qolgan haydovchilarga `order_taken` emit.
- Mijozga → `order_update` { status:'accepted', driver_name, driver_car, driver_plate }.
- **Idempotent**: aynan shu haydovchi ikki marta bossa — bir xil `{ order }`, xato emas.

---

## 6. Radius eskalatsiya + timeout (Endpoint 3) — terminal holat MAJBURIY

- `POST /api/orders` → `status='searching'`, dispatch loop boshlanadi.
- Boshlang'ich radius ichidagi bo'sh haydovchilarga `new_order` (OFFER) + Expo push.
- Belgilangan vaqt (masalan 15–30s) ichida qabul bo'lmasa → radiusni kengaytir → qayta offer.
- Maks radius/vaqtdan keyin ham topilmasa → **aniq terminal holat**. Buyurtma "jim yo'qolmasin".
  - ⚠️ **Frontend eslatmasi:** mijoz ilovasi hozir `order_update` da `cancelled` ni ishlaydi
    ("Buyurtma bekor qilindi"). Agar backend YANGI status kiritsa (masalan `no_drivers`),
    mijoz `App.js` ga uni ko'rsatish uchun kichik follow-up kerak bo'ladi. **Eng oson yo'l:**
    `order_update { status:'cancelled', cancel_reason:'no_drivers' }` yuboring — frontend
    darrov ishlaydi, sabab maydonini keyin ko'rsatish mumkin.
- Loop holati **DB'da** saqlansin (xotirada emas) — node restart'da buyurtma tiklanadi.
- Haydovchi qabul qilsa → loop to'xtaydi.

---

## 7. Frontend tomon TAYYOR (server shu contract'ni to'ldirsa ishlaydi)

- Push token registratsiyasi: ikkala ilova `POST /api/me/push-token` yuboradi (§1).
- 409 boshqaruvi: haydovchi accept 409 → tiklash; mijoz create 409 → faol buyurtma ekrani.
- `order_taken` handleri: haydovchi OFFER'ni yopadi.
- Status regress + order-resurrect himoyasi: kechikkan event holatni buzmaydi.
- `GET /api/me/active-order` OFFER'ni qaytarmasligiga tayangan (P1 bug tuzatildi).

Batafsil audit: elga-driver2 repo `KETDIKGO_AUDIT.md`.
