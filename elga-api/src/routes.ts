import { Router } from 'express';
import auth from './modules/auth';
import stats from './modules/stats';
import drivers from './modules/drivers';
import clients from './modules/clients';
import orders from './modules/orders';
import finance from './modules/finance';
import tariffs from './modules/tariffs';
import complaints from './modules/complaints';
import loyalty from './modules/loyalty';
import system from './modules/system';

const router = Router();

router.use('/auth', auth);
router.use('/stats', stats);
router.use('/drivers', drivers);
router.use('/clients', clients);
router.use('/orders', orders);
router.use('/finance', finance);
router.use('/tariffs', tariffs);
router.use('/complaints', complaints);
router.use('/loyalty', loyalty);
router.use('/', system); // /cities, /places, /audit

export default router;
