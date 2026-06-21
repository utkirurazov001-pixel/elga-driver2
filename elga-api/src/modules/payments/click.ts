/**
 * Click Shop API — Prepare/Complete (PAY-02). MD5 sign_string tekshiriladi.
 * ⚠️ Aniq qoidalar docs.click.uz bilan tasdiqlansin (PAY-05).
 */
import { Router } from 'express';
import crypto from 'crypto';
import { store } from '../../store';
import { env } from '../../config/env';

const router = Router();

const CLICK_ERR = {
  SUCCESS: 0,
  SIGN_FAILED: -1,
  BAD_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  ORDER_NOT_FOUND: -5,
  TXN_NOT_FOUND: -6,
  CANCELLED: -9,
};

function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}

interface ClickReq {
  click_trans_id?: string; service_id?: string; merchant_trans_id?: string;
  merchant_prepare_id?: string; amount?: string; action?: string; sign_time?: string; sign_string?: string;
  error?: string; error_note?: string;
}

function findOrder(id?: string) {
  if (!id) return null;
  return store.findOrder(id) ?? store.findOrder(`#${id}`) ?? null;
}

// Prepare (action=0)
router.post('/prepare', (req, res) => {
  const b = req.body as ClickReq;
  const expected = md5(`${b.click_trans_id}${b.service_id}${env.click.secret}${b.merchant_trans_id}${b.amount}${b.action}${b.sign_time}`);
  if (expected !== b.sign_string) {
    return res.json({ error: CLICK_ERR.SIGN_FAILED, error_note: 'SIGN CHECK FAILED' });
  }
  const order = findOrder(b.merchant_trans_id);
  if (!order) return res.json({ error: CLICK_ERR.ORDER_NOT_FOUND, error_note: 'Order not found' });
  if (Math.round(Number(b.amount)) !== order.price) return res.json({ error: CLICK_ERR.BAD_AMOUNT, error_note: 'Incorrect amount' });
  if (order.payment_status === 'paid') return res.json({ error: CLICK_ERR.ALREADY_PAID, error_note: 'Already paid' });

  let txn = store.clickTxns.find((t) => t.click_trans_id === b.click_trans_id);
  if (!txn) {
    txn = { id: `CT${store.clickTxns.length + 1}`, click_trans_id: b.click_trans_id!, order_id: order.id, amount: Number(b.amount), status: 'prepared', prepare_id: `${store.clickTxns.length + 1}`, created_at: Date.now() };
    store.clickTxns.push(txn);
  }
  return res.json({ click_trans_id: b.click_trans_id, merchant_trans_id: b.merchant_trans_id, merchant_prepare_id: txn.prepare_id, error: CLICK_ERR.SUCCESS, error_note: 'Success' });
});

// Complete (action=1)
router.post('/complete', (req, res) => {
  const b = req.body as ClickReq;
  const expected = md5(`${b.click_trans_id}${b.service_id}${env.click.secret}${b.merchant_trans_id}${b.merchant_prepare_id}${b.amount}${b.action}${b.sign_time}`);
  if (expected !== b.sign_string) {
    return res.json({ error: CLICK_ERR.SIGN_FAILED, error_note: 'SIGN CHECK FAILED' });
  }
  const txn = store.clickTxns.find((t) => t.click_trans_id === b.click_trans_id && t.prepare_id === b.merchant_prepare_id);
  if (!txn) return res.json({ error: CLICK_ERR.TXN_NOT_FOUND, error_note: 'Transaction not found' });
  const order = store.findOrder(txn.order_id);
  if (!order) return res.json({ error: CLICK_ERR.ORDER_NOT_FOUND, error_note: 'Order not found' });
  if (Number(b.error) < 0) {
    txn.status = 'cancelled';
    return res.json({ click_trans_id: b.click_trans_id, merchant_trans_id: b.merchant_trans_id, merchant_confirm_id: txn.id, error: CLICK_ERR.CANCELLED, error_note: 'Cancelled' });
  }
  if (txn.status === 'completed') {
    return res.json({ click_trans_id: b.click_trans_id, merchant_trans_id: b.merchant_trans_id, merchant_confirm_id: txn.id, error: CLICK_ERR.SUCCESS, error_note: 'Already completed' });
  }
  txn.status = 'completed';
  order.payment_status = 'paid';
  store.addAudit({ user_id: 'click', user: 'Click', role: 'super_admin', action: 'payment.complete', entity: 'transactions', entity_id: txn.id, detail: `${txn.amount} so'm`, ip: req.ip ?? '' });
  return res.json({ click_trans_id: b.click_trans_id, merchant_trans_id: b.merchant_trans_id, merchant_confirm_id: txn.id, error: CLICK_ERR.SUCCESS, error_note: 'Success' });
});

export default router;
