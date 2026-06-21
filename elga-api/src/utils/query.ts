import type { Request } from 'express';

/** ?page=1&limit=10 (default 10, max 100) — TZ konvensiyalari. */
export function pageParams(req: Request): { page: number; limit: number } {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
  return { page, limit };
}

export function qstr(req: Request, key: string): string {
  const v = req.query[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** Matnli qidiruv (case-insensitive) bir nechta maydon bo'yicha. */
export function matches(row: object, q: string, fields: string[]): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  const r = row as Record<string, unknown>;
  return fields.some((f) => String(r[f] ?? '').toLowerCase().includes(ql));
}
