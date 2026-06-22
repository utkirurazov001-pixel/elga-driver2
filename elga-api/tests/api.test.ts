import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { store } from '../src/store';
import { totp } from '../src/utils/totp';

let app: ReturnType<typeof createApp>;
let adminToken = '';

async function login(loginName: string, password: string, code?: string) {
  const res = await request(app).post('/v1/auth/login').send({ login: loginName, password, code });
  return res;
}

beforeAll(async () => {
  await store.init();
  app = createApp();
  const res = await login('admin', 'elga1226');
  adminToken = res.body.data.access_token;
});

describe('Health & Auth', () => {
  it('GET /health 200', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.dispatcher).toBe('1226');
  });

  it('login muvaffaqiyatli token beradi', async () => {
    const r = await login('admin', 'elga1226');
    expect(r.body.success).toBe(true);
    expect(r.body.data.access_token).toBeTruthy();
    expect(r.body.data.user.phone).toMatch(/\*\*\*/); // maskirovka
  });

  it('xato parol 401', async () => {
    const r = await login('admin', 'wrong');
    expect(r.status).toBe(401);
    expect(r.body.success).toBe(false);
  });
});

describe('RBAC', () => {
  it('dispatcher finance/summary uchun 403', async () => {
    const d = await login('disp1', 'elga1226');
    const r = await request(app).get('/v1/finance/summary').set('Authorization', `Bearer ${d.body.data.access_token}`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
  });

  it('token siz 401', async () => {
    const r = await request(app).get('/v1/drivers');
    expect(r.status).toBe(401);
  });
});

describe('Pricing & Orders', () => {
  it('narx kalkulyatori hisoblaydi', async () => {
    const r = await request(app).post('/v1/pricing/estimate').set('Authorization', `Bearer ${adminToken}`)
      .send({ tariff: 'komfort', distance_km: 6, duration_min: 15, city: 'Angor' });
    expect(r.body.success).toBe(true);
    expect(r.body.data.price).toBeGreaterThan(0);
    expect(r.body.data.driver_earning).toBeLessThan(r.body.data.price);
  });

  it('buyurtma yaratish va auto-assign', async () => {
    const c = await request(app).post('/v1/orders').set('Authorization', `Bearer ${adminToken}`)
      .send({ client_phone: '998901234567', from_city: 'Termiz', from_place: 'Vokzal', to_city: 'Termiz', to_place: 'Markaz', tariff: 'komfort' });
    expect(c.body.success).toBe(true);
    const id = c.body.data.id;
    const a = await request(app).post(`/v1/orders/${encodeURIComponent(id)}/auto-assign`).set('Authorization', `Bearer ${adminToken}`);
    expect(a.body.success).toBe(true);
    expect(a.body.data.driver).toBeTruthy();
  });
});

describe('Finance — 2-bosqich withdrawal', () => {
  it('confirm yoq → 422', async () => {
    const r = await request(app).post('/v1/finance/withdrawals/WD502/approve').set('Authorization', `Bearer ${adminToken}`).send({});
    expect(r.status).toBe(422);
  });
  it('confirm+code → paid', async () => {
    const r = await request(app).post('/v1/finance/withdrawals/WD502/approve').set('Authorization', `Bearer ${adminToken}`).send({ confirm: true, code: '123456' });
    expect(r.body.success).toBe(true);
    expect(r.body.data.status).toBe('paid');
  });
});

describe('Payments', () => {
  const authHeader = 'Basic ' + Buffer.from('Paycom:test-payme-key').toString('base64');
  it('Payme auth xato → -32504', async () => {
    const r = await request(app).post('/v1/payments/payme').send({ id: 1, method: 'CheckPerformTransaction', params: {} });
    expect(r.body.error.code).toBe(-32504);
  });
  it('Payme CheckPerformTransaction allow', async () => {
    const order = store.orders[0]!;
    const r = await request(app).post('/v1/payments/payme').set('Authorization', authHeader)
      .send({ id: 1, method: 'CheckPerformTransaction', params: { amount: order.price * 100, account: { order_id: order.id.replace('#', '') } } });
    expect(r.body.result.allow).toBe(true);
  });
  it('Payme noto\'g\'ri summa → -31001', async () => {
    const order = store.orders[0]!;
    const r = await request(app).post('/v1/payments/payme').set('Authorization', authHeader)
      .send({ id: 1, method: 'CheckPerformTransaction', params: { amount: 1, account: { order_id: order.id.replace('#', '') } } });
    expect(r.body.error.code).toBe(-31001);
  });

  it('Click imzo xato → -1', async () => {
    const r = await request(app).post('/v1/payments/click/prepare').type('form')
      .send({ click_trans_id: '1', service_id: '1', merchant_trans_id: '10620', amount: '100', action: '0', sign_time: 't', sign_string: 'wrong' });
    expect(r.body.error).toBe(-1);
  });
  it('Click to\'g\'ri imzo → prepare success', async () => {
    const order = store.orders[0]!;
    const merchant_trans_id = order.id.replace('#', '');
    const sign = crypto.createHash('md5').update(`1${1}test-click-secret${merchant_trans_id}${order.price}0t`).digest('hex');
    const r = await request(app).post('/v1/payments/click/prepare').type('form')
      .send({ click_trans_id: '1', service_id: '1', merchant_trans_id, amount: String(order.price), action: '0', sign_time: 't', sign_string: sign });
    expect(r.body.error).toBe(0);
    expect(r.body.merchant_prepare_id).toBeTruthy();
  });
});

describe('2FA & Admin users', () => {
  it('2FA setup + verify', async () => {
    const setup = await request(app).post('/v1/auth/2fa/setup').set('Authorization', `Bearer ${adminToken}`);
    expect(setup.body.data.secret).toBeTruthy();
    const code = totp(setup.body.data.secret);
    const verify = await request(app).post('/v1/auth/2fa/verify').set('Authorization', `Bearer ${adminToken}`).send({ code });
    expect(verify.body.data.two_fa_enabled).toBe(true);
  });

  it('admin_users yaratish (super_admin)', async () => {
    const r = await request(app).post('/v1/admin/users').set('Authorization', `Bearer ${adminToken}`)
      .send({ login: 'op_test', password: 'parol123', full_name: 'Test Operator', phone: '998901112233', role: 'operator' });
    expect(r.body.success).toBe(true);
    expect(r.body.data.role).toBe('operator');
  });

  it('admin_users — operator uchun 403', async () => {
    const op = await login('operator1', 'elga1226');
    const r = await request(app).get('/v1/admin/users').set('Authorization', `Bearer ${op.body.data.access_token}`);
    expect(r.status).toBe(403);
  });
});
