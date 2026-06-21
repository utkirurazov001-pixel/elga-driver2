/**
 * Payme Merchant API (JSON-RPC) — PAY-01.
 * Holat mashinasi `paymeTxns` da. Imzo/auth majburiy (PAY-03), idempotent (PAY-04).
 * ⚠️ Aniq field/qoidalar developer.help.paycom.uz bilan tasdiqlansin (PAY-05).
 */
import { Router } from 'express';
import { store } from '../../store';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

const router = Router();

// Payme xato kodlari
const ERR = {
  AUTH: -32504,
  METHOD: -32601,
  ORDER_NOT_FOUND: -31050,
  INVALID_AMOUNT: -31001,
  CANT_PERFORM: -31008,
  TXN_NOT_FOUND: -31003,
};
function msg(uz: string, ru: string, en: string) {
  return { uz, ru, en };
}
function rpcError(id: unknown, code: number, message: ReturnType<typeof msg>, data?: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}
function rpcOk(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

/** Basic auth: "Paycom:KEY" — kalit env.payme.key bilan solishtiriladi. */
function authOk(header?: string): boolean {
  if (!header || !header.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const key = decoded.split(':')[1] ?? '';
    return key === env.payme.key;
  } catch {
    return false;
  }
}

interface Params {
  id?: string;
  time?: number;
  amount?: number;
  account?: { order_id?: string };
  reason?: number;
  from?: number;
  to?: number;
}

router.post('/', (req, res) => {
  const body = req.body as { id?: unknown; method?: string; params?: Params };
  const rpcId = body?.id;

  if (!authOk(req.headers.authorization)) {
    return res.json(rpcError(rpcId, ERR.AUTH, msg('Avtorizatsiya xatosi', 'Ошибка авторизации', 'Authorization failed')));
  }
  const method = body?.method;
  const p: Params = body?.params ?? {};

  try {
    switch (method) {
      case 'CheckPerformTransaction': {
        const order = findOrder(p.account?.order_id);
        if (!order) return res.json(rpcError(rpcId, ERR.ORDER_NOT_FOUND, msg('Buyurtma topilmadi', 'Заказ не найден', 'Order not found')));
        if (p.amount !== order.price * 100) return res.json(rpcError(rpcId, ERR.INVALID_AMOUNT, msg('Noto\'g\'ri summa', 'Неверная сумма', 'Invalid amount')));
        return res.json(rpcOk(rpcId, { allow: true }));
      }
      case 'CreateTransaction': {
        const order = findOrder(p.account?.order_id);
        if (!order) return res.json(rpcError(rpcId, ERR.ORDER_NOT_FOUND, msg('Buyurtma topilmadi', 'Заказ не найден', 'Order not found')));
        if (p.amount !== order.price * 100) return res.json(rpcError(rpcId, ERR.INVALID_AMOUNT, msg('Noto\'g\'ri summa', 'Неверная сумма', 'Invalid amount')));
        let txn = store.paymeTxns.find((t) => t.paycom_id === p.id);
        if (txn) {
          // idempotent — mavjudini qaytaramiz
          return res.json(rpcOk(rpcId, { create_time: txn.create_time, transaction: txn.id, state: txn.state }));
        }
        txn = { id: `PT${store.paymeTxns.length + 1}`, paycom_id: p.id!, order_id: order.id, amount: p.amount, state: 1, create_time: p.time ?? Date.now(), perform_time: 0, cancel_time: 0, reason: null };
        store.paymeTxns.push(txn);
        return res.json(rpcOk(rpcId, { create_time: txn.create_time, transaction: txn.id, state: txn.state }));
      }
      case 'PerformTransaction': {
        const txn = store.paymeTxns.find((t) => t.paycom_id === p.id);
        if (!txn) return res.json(rpcError(rpcId, ERR.TXN_NOT_FOUND, msg('Tranzaksiya topilmadi', 'Транзакция не найдена', 'Transaction not found')));
        if (txn.state === 2) return res.json(rpcOk(rpcId, { perform_time: txn.perform_time, transaction: txn.id, state: 2 }));
        if (txn.state !== 1) return res.json(rpcError(rpcId, ERR.CANT_PERFORM, msg('Amalni bajarib bo\'lmaydi', 'Невозможно выполнить', 'Unable to perform')));
        txn.state = 2;
        txn.perform_time = Date.now();
        const order = store.findOrder(txn.order_id);
        if (order) order.payment_status = 'paid';
        store.addAudit({ user_id: 'payme', user: 'Payme', role: 'super_admin', action: 'payment.perform', entity: 'payme_transactions', entity_id: txn.id, detail: `${txn.amount / 100} so'm`, ip: req.ip ?? '' });
        return res.json(rpcOk(rpcId, { perform_time: txn.perform_time, transaction: txn.id, state: 2 }));
      }
      case 'CancelTransaction': {
        const txn = store.paymeTxns.find((t) => t.paycom_id === p.id);
        if (!txn) return res.json(rpcError(rpcId, ERR.TXN_NOT_FOUND, msg('Tranzaksiya topilmadi', 'Транзакция не найдена', 'Transaction not found')));
        if (txn.cancel_time === 0) {
          txn.cancel_time = Date.now();
          txn.state = txn.state === 2 ? -2 : -1;
          txn.reason = p.reason ?? null;
          const order = store.findOrder(txn.order_id);
          if (order && order.payment_status === 'paid') order.payment_status = 'refunded';
        }
        return res.json(rpcOk(rpcId, { cancel_time: txn.cancel_time, transaction: txn.id, state: txn.state }));
      }
      case 'CheckTransaction': {
        const txn = store.paymeTxns.find((t) => t.paycom_id === p.id);
        if (!txn) return res.json(rpcError(rpcId, ERR.TXN_NOT_FOUND, msg('Tranzaksiya topilmadi', 'Транзакция не найдена', 'Transaction not found')));
        return res.json(rpcOk(rpcId, { create_time: txn.create_time, perform_time: txn.perform_time, cancel_time: txn.cancel_time, transaction: txn.id, state: txn.state, reason: txn.reason }));
      }
      case 'GetStatement': {
        const rows = store.paymeTxns
          .filter((t) => t.create_time >= (p.from ?? 0) && t.create_time <= (p.to ?? Number.MAX_SAFE_INTEGER))
          .map((t) => ({ id: t.paycom_id, time: t.create_time, amount: t.amount, account: { order_id: t.order_id }, create_time: t.create_time, perform_time: t.perform_time, cancel_time: t.cancel_time, transaction: t.id, state: t.state, reason: t.reason }));
        return res.json(rpcOk(rpcId, { transactions: rows }));
      }
      default:
        return res.json(rpcError(rpcId, ERR.METHOD, msg('Metod topilmadi', 'Метод не найден', 'Method not found')));
    }
  } catch (e) {
    logger.error({ err: e }, 'Payme webhook xatosi');
    return res.json(rpcError(rpcId, ERR.CANT_PERFORM, msg('Server xatosi', 'Ошибка сервера', 'Server error')));
  }
});

function findOrder(orderId?: string) {
  if (!orderId) return null;
  // order_id "#10620" yoki "10620" ko'rinishida bo'lishi mumkin
  return store.findOrder(orderId) ?? store.findOrder(`#${orderId}`) ?? null;
}

export default router;
