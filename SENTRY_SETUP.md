# Sentry (crash / xato monitoringi) — sozlash

Kod **allaqachon ulangan**. Sentry **DSN berilganda avtomatik yoqiladi**, aks holda
no-op bo'ladi (ilova aynan avvalgidek ishlaydi, mavjud `/api/client-error` reporter
baribir ishlayveradi). Shu sabab DSN qo'shilmaguncha ham hech narsa sinmaydi.

## Nima ulangan
- `src/crash.js` — `initCrash()`, `captureException()`, `wrapApp()`.
- `index.js` — ishga tushishda `initCrash()` chaqiriladi, ildiz komponent `wrapApp(App)` bilan o'raladi.
- `App.js` → mavjud `reportCrash()` ichida `captureException()` chaqiriladi
  (fatal/async/socket/render xatolari avtomatik Sentry'ga tushadi).
- `@sentry/react-native` → `package.json` ga qo'shilgan.

## Yoqish (3 qadam, ~5 daqiqa)

### 1. Sentry loyihasi yarating
- https://sentry.io → yangi loyiha → platforma **React Native** → **DSN** ni nusxalang
  (`https://xxxx@oooo.ingest.sentry.io/1234567` ko'rinishida).

### 2. DSN ni build muhitiga qo'shing
DSN `EXPO_PUBLIC_SENTRY_DSN` env o'zgaruvchisidan o'qiladi.

**EAS build uchun** — `eas.json`:
```json
{
  "build": {
    "production": {
      "env": { "EXPO_PUBLIC_SENTRY_DSN": "https://xxxx@oooo.ingest.sentry.io/1234567" }
    },
    "preview": {
      "env": { "EXPO_PUBLIC_SENTRY_DSN": "https://xxxx@oooo.ingest.sentry.io/1234567" }
    }
  }
}
```

**Lokal sinov uchun** — loyiha ildizida `.env`:
```
EXPO_PUBLIC_SENTRY_DSN=https://xxxx@oooo.ingest.sentry.io/1234567
```

### 3. To'g'ri versiyani tasdiqlang va build qiling
```bash
npx expo install @sentry/react-native   # Expo SDK 54 ga mos versiyani aniqlaydi
npx expo prebuild --clean               # native loyihani qayta yaratadi
eas build -p android --profile preview  # yoki ios
```

> ℹ️ Hozir `@sentry/react-native@^8.15.1` o'rnatilgan. `npx expo install` agar SDK 54
> uchun boshqa versiyani tavsiya qilsa, uni avtomatik moslaydi.

## (Ixtiyoriy) O'qiladigan stack trace — source maps
Minifikatsiyalanmagan stack trace uchun `app.json` plugins ga qo'shing:
```json
["@sentry/react-native/expo", {
  "organization": "SENTRY_ORG_SLUG",
  "project": "SENTRY_PROJECT_SLUG"
}]
```
va build muhitida `SENTRY_AUTH_TOKEN` ni o'rnating (sentry.io → Settings → Auth Tokens).
Auth token bo'lmasa build sinmaydi — shunchaki source map yuklash o'tkazib yuboriladi.

## Tekshirish
Ilovada ataylab xato chiqaring (masalan test tugmasi) yoki crash qiling →
Sentry dashboard'da 1-2 daqiqada **Issue** paydo bo'lishi kerak.

## Nimalar kuzatiladi
- ✅ JS exception lar (async/timer/socket ichidagi fatal xatolar — global handler orqali)
- ✅ Render xatolari (ErrorBoundary → componentDidCatch → reportCrash)
- ✅ Native crashlar va ANR (Android) — `enableNativeCrashHandling: true`
- ✅ Yengil performance tracing (`tracesSampleRate: 0.2`)
