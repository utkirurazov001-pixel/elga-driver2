# 🔔 Push kelmasligi — SABAB va TUZATISH (FCM sozlash)

## Muammo
Marketing/buyurtma push xabarlari **hech kimga** kelmayapti — mijozga ham,
haydovchiga ham, ilova ochiq ham, yopiq ham.

## Sabab (aniqlangan)
Android'da push ishlashi uchun **FCM (Firebase Cloud Messaging)** kaliti kerak.
Hozir loyihada u **umuman sozlanmagan**:
- `google-services.json` fayli yo'q
- `app.json` da `googleServicesFile` yo'q
- Firebase loyihasi ulanmagan

Natijada ilova ishga tushganda `getExpoPushTokenAsync()` **xato beradi** →
qurilma push tokeni **serverga yozilmaydi** → `push_tokens` jadvali bo'sh →
server push yuborsa ham, yuboradigan manzil yo'q. Shu sabab push hech kimga
bormaydi.

> Bu OTA (tezkor yangilanish) bilan tuzatilmaydi — **yangi build** shart,
> chunki FCM nativ qism.

---

## TUZATISH — 5 qadam (bir marta qilinadi)

### 1) Firebase loyihasi yarating
1. https://console.firebase.google.com → **Add project** → nom: `KetdikGo`
2. Google Analytics — **shart emas** (o'chirsa ham bo'ladi).

### 2) Ikkala ilova uchun Android app qo'shing
Firebase loyihasida **Add app → Android** ni IKKI marta bajaring:
| Ilova | Package name (app.json'dan) |
|-------|------------------------------|
| Haydovchi | `uz.ketdik.driver` |
| Mijoz | `uz.ketdik.mijoz` |

Har biri uchun **`google-services.json`** yuklab olinadi.

### 3) Fayllarni loyihaga qo'ying
- Haydovchi fayli → `elga-driver2/google-services.json`
- Mijoz fayli → `elga-driver2/elga-mijoz/google-services.json`

`app.json` ga (ikkalasida ham) `android` blokiga qo'shing:
```json
"android": {
  "package": "uz.ketdik.driver",
  "googleServicesFile": "./google-services.json",
  ...
}
```

### 4) FCM V1 kalitini Expo'ga bering
1. Firebase → ⚙️ **Project settings** → **Service accounts** →
   **Generate new private key** → JSON yuklab oling.
2. Terminalда (har ikkala ilova papkasida):
   ```
   eas credentials
   ```
   → platforma **Android** → **Push Notifications: Manage** →
   **Google Service Account Key** → yuqoridagi JSON'ni yuklang.

### 5) Ikkala ilovani QAYTA build qiling
```
# haydovchi
cd elga-driver2
eas build --platform android --profile preview

# mijoz
cd elga-mijoz
eas build --platform android --profile preview
```
Yangi APK'ni o'rnatib, ilovaga kiring va bildirishnomaga **ruxsat** bering.

---

## Tekshirish (deploydan keyin)
Panel super_admin: `GET https://api.elga.uz/api/admin/push-diag`
```json
{ "active_tokens": 12, "customers": 8, "drivers": 4,
  "recent_sends": [ { "result": "ok 1/1" } ],
  "hint": "Token bor..." }
```
- `active_tokens > 0` → qurilmalar ro'yxatdan o'tdi ✅
- Keyin panel **Kampaniyalar → Push** bilan test yuboring.
- `recent_sends` da `MismatchSenderId` chiqsa → FCM kaliti mos emas (4-qadamni qayta).
- `active_tokens = 0` bo'lsa → build eski yoki ruxsat berilmagan.

## Nega ilova ochiqda ham kelmayapti?
Marketing push — Expo orqali **masofaviy** push. U token orqali boradi. Token
yo'q bo'lsa, ilova ochiq bo'lса ham xabar bormaydi. FCM sozlangach, ikkala
holatда ham (ochiq/yopiq) ishlaydi.
