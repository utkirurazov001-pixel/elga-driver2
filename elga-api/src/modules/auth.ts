import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { store } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';
import { ApiError } from '../utils/errors';
import { signAccess, signRefresh, verifyRefresh } from '../utils/jwt';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/auth';
import { maskPhone } from '../utils/mask';
import { env } from '../config/env';
import { generateSecret, otpauthUrl, verifyTotp } from '../utils/totp';

const router = Router();

const loginSchema = z.object({
  login: z.string().min(2),
  password: z.string().min(4),
  code: z.string().optional(), // 2FA TOTP (yoqilgan bo'lsa)
});

// 5 ta xato urinishdan keyin 15 daqiqa blok (AUTH-05) — soddalashtirilgan in-memory
const attempts: Record<string, { count: number; until: number }> = {};

router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { login, password, code } = req.body as z.infer<typeof loginSchema>;
    const a = attempts[login];
    if (a && a.until > Date.now()) throw ApiError.forbidden('Juda ko\'p urinish — 15 daqiqadan keyin urinib ko\'ring');

    const user = store.adminUsers.find((u) => u.login === login && u.is_active);
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!user || !valid) {
      const rec = attempts[login] ?? { count: 0, until: 0 };
      rec.count++;
      if (rec.count >= 5) rec.until = Date.now() + 15 * 60 * 1000;
      attempts[login] = rec;
      throw ApiError.unauthorized('Login yoki parol xato');
    }
    // 2FA — yoqilgan bo'lsa kod majburiy (AUTH-04)
    if (user.two_fa_enabled && user.two_fa_secret) {
      if (!code) throw new ApiError(401, 'TWOFA_REQUIRED', '2FA kodi talab qilinadi');
      if (!verifyTotp(user.two_fa_secret, code)) throw ApiError.unauthorized('2FA kodi noto\'g\'ri');
    }
    delete attempts[login];
    user.last_login_at = new Date().toISOString();

    const payload = { sub: user.id, login: user.login, role: user.role };
    store.addAudit({ user_id: user.id, user: user.login, role: user.role, action: 'auth.login', entity: 'admin_users', entity_id: user.id, detail: 'Tizimga kirish', ip: req.ip ?? '' });

    res.cookie('refresh_token', signRefresh(payload), { httpOnly: true, sameSite: env.isProd ? 'strict' : 'lax', secure: env.isProd, maxAge: 7 * 24 * 3600 * 1000 });
    return ok(res, {
      access_token: signAccess(payload),
      refresh_token: signRefresh(payload),
      user: { id: user.id, login: user.login, full_name: user.full_name, role: user.role, phone: maskPhone(user.phone) },
    });
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = (req.body?.refresh_token as string) || (req.cookies?.refresh_token as string);
    if (!token) throw ApiError.unauthorized('Refresh token yo\'q');
    try {
      const p = verifyRefresh(token);
      return ok(res, { access_token: signAccess({ sub: p.sub, login: p.login, role: p.role }) });
    } catch {
      throw ApiError.unauthorized('Refresh token yaroqsiz');
    }
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const u = store.adminUsers.find((x) => x.id === req.user!.sub);
    if (!u) throw ApiError.notFound('Foydalanuvchi topilmadi');
    return ok(res, { id: u.id, login: u.login, full_name: u.full_name, role: u.role, phone: maskPhone(u.phone), is_active: u.is_active });
  }),
);

router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'auth.logout', entity: 'admin_users', entity_id: req.user!.sub, detail: 'Chiqish', ip: req.ip ?? '' });
    res.clearCookie('refresh_token');
    return ok(res, { message: 'Chiqildi' });
  }),
);

// 2FA sozlash — secret + otpauth URL (authenticator ilovasiga) (AUTH-04)
router.post(
  '/2fa/setup',
  authenticate,
  asyncHandler(async (req, res) => {
    const u = store.adminUsers.find((x) => x.id === req.user!.sub);
    if (!u) throw ApiError.notFound('Foydalanuvchi topilmadi');
    u.two_fa_secret = generateSecret();
    u.two_fa_enabled = false;
    return ok(res, { secret: u.two_fa_secret, otpauth_url: otpauthUrl(u.two_fa_secret, u.login) });
  }),
);

// 2FA tasdiqlash/yoqish
const twofaSchema = z.object({ code: z.string().length(6) });
router.post(
  '/2fa/verify',
  authenticate,
  validate(twofaSchema),
  asyncHandler(async (req, res) => {
    const u = store.adminUsers.find((x) => x.id === req.user!.sub);
    if (!u || !u.two_fa_secret) throw ApiError.badRequest('Avval 2FA sozlang');
    const { code } = req.body as z.infer<typeof twofaSchema>;
    if (!verifyTotp(u.two_fa_secret, code)) throw ApiError.unauthorized('Kod noto\'g\'ri');
    u.two_fa_enabled = true;
    store.addAudit({ user_id: u.id, user: u.login, role: u.role, action: 'auth.2fa_enabled', entity: 'admin_users', entity_id: u.id, detail: '2FA yoqildi', ip: req.ip ?? '' });
    return ok(res, { two_fa_enabled: true });
  }),
);

export default router;
