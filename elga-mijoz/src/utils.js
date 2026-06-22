// ─── Sof yordamchi funksiyalar (React/state'ga bog'liq emas) ───

// Sonni mahalliy formatda ko'rsatish: 12 500
export const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

// Telefonni butun ilova bo'ylab yagona formatda ko'rsatish: +998 91 981 11 71
export function fmtPhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('998')) d = d.slice(3);
  if (d.length !== 9) return raw; // kutilmagan format — o'zini qaytaramiz
  return `+998 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}
