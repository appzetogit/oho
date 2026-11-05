import mongoose from 'mongoose';
import { Router } from 'express';
import { authenticate } from '../middlewares/authMiddleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { ApiError } from '../../../utils/ApiError.js';

/**
 * App versions and store links for the rider and driver apps, set from the
 * admin panel.
 *
 * The apps read this on launch:
 *   - below minVersion  -> a blocking "please update" screen (force update)
 *   - below latestVersion -> a dismissible "new version available" prompt
 *   - the store links are what Refer & Earn shares, so a new listing never
 *     needs an app release
 * An empty minVersion means no force update, which is the default.
 */

const APPS = ['user', 'driver'];

const DEFAULTS = {
  user: {
    androidStoreUrl: 'https://play.google.com/store/apps/details?id=com.ohoride.appzeto',
    iosStoreUrl: '',
  },
  driver: {
    androidStoreUrl: 'https://play.google.com/store/apps/details?id=com.ohoridepartner.appzeto',
    iosStoreUrl: '',
  },
};

const appVersionSchema = new mongoose.Schema(
  {
    app: { type: String, enum: APPS, required: true, unique: true },
    latestVersion: { type: String, default: '', trim: true },
    minVersion: { type: String, default: '', trim: true },
    androidStoreUrl: { type: String, default: '', trim: true },
    iosStoreUrl: { type: String, default: '', trim: true },
    updateMessage: { type: String, default: '', trim: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

export const AppVersionSetting =
  mongoose.models.TaxiAppVersionSetting || mongoose.model('TaxiAppVersionSetting', appVersionSchema);

const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;

const normalizeApp = (value) => {
  const app = String(value || '').trim().toLowerCase();
  if (!APPS.includes(app)) throw new ApiError(400, 'app must be "user" or "driver"');
  return app;
};

const normalizeVersion = (value, field) => {
  const version = String(value ?? '').trim();
  if (version && !VERSION_PATTERN.test(version)) {
    throw new ApiError(400, `${field} must look like 7.3.4`);
  }
  return version;
};

const normalizeUrl = (value, field) => {
  const url = String(value ?? '').trim();
  if (url && !/^https:\/\/\S+$/i.test(url)) throw new ApiError(400, `${field} must be an https:// link`);
  return url;
};

const serialize = (app, doc) => ({
  app,
  latestVersion: doc?.latestVersion || '',
  minVersion: doc?.minVersion || '',
  androidStoreUrl: doc?.androidStoreUrl || DEFAULTS[app].androidStoreUrl,
  iosStoreUrl: doc?.iosStoreUrl || DEFAULTS[app].iosStoreUrl,
  updateMessage: doc?.updateMessage || '',
  updatedAt: doc?.updatedAt || null,
});

export const getAppVersion = async (appValue) => {
  const app = normalizeApp(appValue);
  const doc = await AppVersionSetting.findOne({ app }).lean();
  return serialize(app, doc);
};

export const updateAppVersion = async (appValue, payload = {}, adminId = null) => {
  const app = normalizeApp(appValue);
  const update = { updatedBy: adminId || null };
  if (payload.latestVersion !== undefined) update.latestVersion = normalizeVersion(payload.latestVersion, 'latestVersion');
  if (payload.minVersion !== undefined) update.minVersion = normalizeVersion(payload.minVersion, 'minVersion');
  if (payload.androidStoreUrl !== undefined) update.androidStoreUrl = normalizeUrl(payload.androidStoreUrl, 'androidStoreUrl');
  if (payload.iosStoreUrl !== undefined) update.iosStoreUrl = normalizeUrl(payload.iosStoreUrl, 'iosStoreUrl');
  if (payload.updateMessage !== undefined) update.updateMessage = String(payload.updateMessage || '').trim().slice(0, 300);

  const doc = await AppVersionSetting.findOneAndUpdate(
    { app },
    { $set: update, $setOnInsert: { app } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
  return serialize(app, doc);
};

export const appVersionRouter = Router();

// Public: the apps call this before anyone has signed in.
appVersionRouter.get('/common/app-version', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await getAppVersion(req.query?.app) });
}));

const admin = authenticate(['admin']);

appVersionRouter.get('/admin/app-version', admin, asyncHandler(async (_req, res) => {
  const [user, driver] = await Promise.all([getAppVersion('user'), getAppVersion('driver')]);
  res.json({ success: true, data: { user, driver } });
}));

appVersionRouter.patch('/admin/app-version/:app', admin, asyncHandler(async (req, res) => {
  res.json({ success: true, data: await updateAppVersion(req.params.app, req.body || {}, req.auth?.sub) });
}));
