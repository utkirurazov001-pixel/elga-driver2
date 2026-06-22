// ─── Sof yordamchi funksiyalar (React/state'ga bog'liq emas) ───
// Bu modul hech qanday komponent holatiga bog'liq emas — testlash va qayta
// ishlatish oson.

// UUID v4 — qurilma/navbat identifikatorlari uchun
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sonni mahalliy formatda ko'rsatish: 12 500
export const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

// Matnni xavfsiz string'ga keltirish — obyekt/null kelib qolsa ham React
// "Objects are not valid as a React child" deb qulamaydi (ayniqsa ovozli
// buyurtmada manzil maydonlari to'liq bo'lmasligi mumkin).
export const safeStr = (v, fallback = '') => {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
};

// Haversine masofasi (km)
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Telefonni yagona formatda: +998 91 981 11 71
export function fmtPhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('998')) d = d.slice(3);
  if (d.length !== 9) return raw;
  return `+998 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}
