import type { Role } from '../config/constants';

/** RULE-06 — telefonni maskirovka: +998901234545 → +998 90 *** ** 45 */
export function maskPhone(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length < 9) return raw;
  const op = d.slice(-9, -7);
  const last = d.slice(-2);
  return `+998 ${op} *** ** ${last}`;
}

/** To'liq raqam faqat ruxsatli rolga (super_admin, operator); aks holda maska. */
export function phoneForRole(raw: string, role: Role): string {
  if (role === 'super_admin' || role === 'operator') return formatFull(raw);
  return maskPhone(raw);
}

function formatFull(raw: string): string {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length < 12) return raw;
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`;
}

/** Butun so'm (float emas) — money util (TZ). */
export function money(n: number): number {
  return Math.round(n);
}
