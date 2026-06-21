import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { store, type AdminUser } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';
import { ApiError } from '../utils/errors';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { maskPhone } from '../utils/mask';
import { ROLES } from '../config/constants';

const router = Router();
router.use(authenticate, requireRole('super_admin')); // faqat super_admin (TZ §4.2)

function pub(u: AdminUser) {
  return { id: u.id, login: u.login, full_name: u.full_name, phone: maskPhone(u.phone), role: u.role, is_active: u.is_active, last_login_at: u.last_login_at };
}

router.get('/', asyncHandler(async (_req, res) => ok(res, store.adminUsers.map(pub))));

const createSchema = z.object({
  login: z.string().min(3),
  password: z.string().min(6),
  full_name: z.string().min(2),
  phone: z.string().min(7),
  role: z.enum(ROLES),
});

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof createSchema>;
    if (store.adminUsers.some((u) => u.login === b.login)) throw ApiError.conflict('Bunday login mavjud');
    const u: AdminUser = { id: `AU${store.adminUsers.length + 1}`, login: b.login, password_hash: await bcrypt.hash(b.password, 12), full_name: b.full_name, phone: b.phone.replace(/\D/g, ''), role: b.role, is_active: true, last_login_at: null };
    store.adminUsers.push(u);
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'admin_user.create', entity: 'admin_users', entity_id: u.id, detail: `${u.login} (${u.role})`, ip: req.ip ?? '' });
    return ok(res, pub(u), null, 201);
  }),
);

const patchSchema = z.object({
  full_name: z.string().min(2).optional(),
  phone: z.string().min(7).optional(),
  role: z.enum(ROLES).optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

router.patch(
  '/:id',
  validate(patchSchema),
  asyncHandler(async (req, res) => {
    const u = store.adminUsers.find((x) => x.id === req.params.id);
    if (!u) throw ApiError.notFound('Xodim topilmadi');
    const b = req.body as z.infer<typeof patchSchema>;
    if (b.full_name) u.full_name = b.full_name;
    if (b.phone) u.phone = b.phone.replace(/\D/g, '');
    if (b.role) u.role = b.role;
    if (typeof b.is_active === 'boolean') u.is_active = b.is_active;
    if (b.password) u.password_hash = await bcrypt.hash(b.password, 12);
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'admin_user.update', entity: 'admin_users', entity_id: u.id, detail: u.login, ip: req.ip ?? '' });
    return ok(res, pub(u));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const idx = store.adminUsers.findIndex((x) => x.id === req.params.id);
    if (idx < 0) throw ApiError.notFound('Xodim topilmadi');
    const u = store.adminUsers[idx]!;
    if (u.id === req.user!.sub) throw ApiError.badRequest('O\'zingizni o\'chira olmaysiz');
    const superAdmins = store.adminUsers.filter((x) => x.role === 'super_admin' && x.is_active);
    if (u.role === 'super_admin' && superAdmins.length <= 1) throw ApiError.badRequest('Oxirgi super_admin o\'chirilmaydi');
    store.adminUsers.splice(idx, 1);
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'admin_user.delete', entity: 'admin_users', entity_id: u.id, detail: u.login, ip: req.ip ?? '' });
    return ok(res, { deleted: u.id });
  }),
);

export default router;
