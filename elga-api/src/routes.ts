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
import pricing from './modules/pricing';
import zones from './modules/zones';
import campaigns from './modules/campaigns';
import reports from './modules/reports';
import corporate from './modules/corporate';
import rules from './modules/rules';

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
router.use('/pricing', pricing);
router.use('/zones', zones);
router.use('/campaigns', campaigns);
router.use('/reports', reports);
router.use('/corporate', corporate);
router.use('/work-rules', rules);
router.use('/', system); // /cities, /places, /audit

export default router;
