import { Router } from 'express';
import payme from './payme';
import click from './click';

// To'lov webhooklari (public — imzo/auth bilan himoyalangan, BE-FR-021/PAY-03)
const router = Router();
router.use('/payme', payme);
router.use('/click', click);

export default router;
