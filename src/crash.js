// ─── Crash / xato monitoringi (Sentry) ───
//
// Sentry FAQAT DSN berilganda yoqiladi. DSN bo'lmasa hamma narsa no-op bo'ladi —
// ilova aynan avvalgidek ishlaydi (mavjud backend reporter /api/client-error
// baribir ishlaydi). Shu sabab Sentry'ni sozlamasdan ham build sinmaydi.
//
// DSN ni qo'shish (faqat bir marta):
//   1. https://sentry.io da loyiha yarating → DSN ni oling
//   2. Build muhitida o'rnating:  EXPO_PUBLIC_SENTRY_DSN="https://....ingest.sentry.io/..."
//      (eas.json -> build.production.env yoki .env faylida)
//   3. To'liq qo'llanma: SENTRY_SETUP.md
import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';
let _enabled = false;

// index.js da ilova ishga tushishidan oldin chaqiriladi
export function initCrash() {
  if (!DSN) return; // DSN yo'q — Sentry o'chiq
  try {
    Sentry.init({
      dsn: DSN,
      // ANR (Android) va native crashlar
      enableNativeCrashHandling: true,
      // Performance tracing — yengil namuna (FPS/CPU ta'sirini minimal saqlash)
      tracesSampleRate: 0.2,
    });
    _enabled = true;
  } catch (e) {}
}

// Mavjud reportCrash() va ErrorBoundary shuni chaqiradi — DSN yo'q bo'lsa jim o'tadi
export function captureException(error, context) {
  if (!_enabled) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch (e) {}
}

// Root komponentni o'rab, render xatolari + profiling Sentry'ga tushsin
export function wrapApp(App) {
  if (!DSN) return App; // o'chiq bo'lsa o'ramaymiz
  try { return Sentry.wrap(App); } catch (e) { return App; }
}
