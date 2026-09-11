import { Router } from 'express';
import { chatModuleRouter } from '../chat/routes/index.js';
import { adminModuleRouter } from '../admin/routes/index.js';
import { driverModuleRouter } from '../driver/routes/index.js';
import { supportModuleRouter } from '../support/routes/index.js';
import { userModuleRouter } from '../user/routes/index.js';
import { commonRouter } from '../common/routes/commonRoutes.js';
import { careerRouter } from '../career/routes/careerRoutes.js';
import { legacyCompatRouter } from '../compat/legacyCompatRoutes.js';

export const taxiRouter = Router();

taxiRouter.use(chatModuleRouter);
taxiRouter.use(adminModuleRouter);
taxiRouter.use(userModuleRouter);
taxiRouter.use(driverModuleRouter);
taxiRouter.use(supportModuleRouter);
taxiRouter.use(commonRouter);
taxiRouter.use(careerRouter);
// Last on purpose: these only answer paths no real route claims, so they can
// never shadow the current API.
taxiRouter.use(legacyCompatRouter);
