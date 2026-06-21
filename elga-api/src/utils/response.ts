import type { Response } from 'express';

/** Standart javob konverti — TZ kod standartlari (DOIMO shu shaklda). */
export interface Envelope<T = unknown> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  meta: { page: number; limit: number; total: number } | null;
}

export function ok<T>(res: Response, data: T, meta: Envelope['meta'] = null, status = 200): Response {
  const body: Envelope<T> = { success: true, data, error: null, meta };
  return res.status(status).json(body);
}

export function fail(res: Response, status: number, code: string, message: string): Response {
  const body: Envelope = { success: false, data: null, error: { code, message }, meta: null };
  return res.status(status).json(body);
}

export function paginate<T>(items: T[], page: number, limit: number) {
  const total = items.length;
  const start = (page - 1) * limit;
  return { rows: items.slice(start, start + limit), meta: { page, limit, total } };
}
