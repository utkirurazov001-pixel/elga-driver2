import { Router } from 'express';
import { z } from 'zod';
import { store } from '../store';
import { asyncHandler } from '../utils/asyncHandler';
import { ok } from '../utils/response';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { CITIES } from '../config/constants';

const router = Router();
router.use(authenticate, requireRole('super_admin', 'operator'));

router.get('/', asyncHandler(async (_req, res) => ok(res, store.campaigns)));

const segSchema = z.object({
  title: z.string().min(2),
  channel: z.enum(['push', 'sms', 'inapp']),
  body: z.string().min(2),
  segment: z.object({ tier: z.string().optional(), city: z.enum(CITIES).optional(), status: z.string().optional() }).default({}),
  send_now: z.boolean().default(false),
});

/** Segment bo'yicha qabul qiluvchilar sonini hisoblash. */
function countRecipients(seg: { tier?: string; city?: string }): number {
  return store.clients.filter((c) => (!seg.tier || c.tier === seg.tier)).length;
}

router.post(
  '/',
  validate(segSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof segSchema>;
    const recipients = countRecipients(b.segment);
    const cp = { id: `CP${store.campaigns.length + 1}`, title: b.title, channel: b.channel, segment: b.segment, body: b.body, status: b.send_now ? 'sent' : 'scheduled', recipients: b.send_now ? recipients : 0, created_at: 'hozir' };
    store.campaigns.unshift(cp);
    store.addAudit({ user_id: req.user!.sub, user: req.user!.login, role: req.user!.role, action: 'campaign.create', entity: 'campaigns', entity_id: cp.id, detail: `${b.title} (${recipients} qabul)`, ip: req.ip ?? '' });
    return ok(res, { ...cp, estimated_recipients: recipients }, null, 201);
  }),
);

export default router;
