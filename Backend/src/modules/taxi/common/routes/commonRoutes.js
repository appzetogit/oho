import { Router } from 'express';
import * as commonController from '../controllers/commonController.js';
import { authenticate } from '../../middlewares/authMiddleware.js';

export const commonRouter = Router();

// Universal image upload endpoint
commonRouter.post('/common/upload/image', commonController.uploadImage);
commonRouter.get('/common/referrals/translation', commonController.getReferralTranslation);
commonRouter.get('/common/referrals/settings', commonController.getReferralSettingsContent);
commonRouter.get('/common/payment-gateway', commonController.getPaymentGatewayConfig);
commonRouter.post('/common/payment-gateway/phonepe/callback', commonController.acknowledgePhonePeCallback);
commonRouter.get('/common/recharge-api/callback', commonController.acknowledgeRechargeApiCallback);
commonRouter.post('/common/recharge-api/callback', commonController.acknowledgeRechargeApiCallback);

// Authenticated: routing costs real lookups, and only a signed-in rider or
// driver has a leg worth drawing.
commonRouter.get('/route', authenticate(['user', 'driver']), commonController.getRoute);
