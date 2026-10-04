import { verifyAccessToken } from '../services/tokenService.js';
import { assignPushTokenToEntity } from '../services/pushTokenService.js';
import { User } from '../user/models/User.js';
import { Driver } from '../driver/models/Driver.js';
import { Owner } from '../admin/models/Owner.js';

/**
 * Save an FCM token sent inside a login or signup request.
 *
 * The apps are expected to call /users/fcm-token or /drivers/fcm-token after
 * signing in, but the rider app sends the token with the sign-in request
 * itself (as the old Laravel API accepted it) and those handlers never read
 * it, so it was silently dropped and riders never got a token.
 *
 * Runs after the real handler: once it responds successfully with an access
 * token, the account is taken from that token — never from the request — and
 * the push token is attached to it. A failure here is logged and ignored; it
 * must never break signing in.
 */

// Every name the apps are known or likely to use.
const TOKEN_FIELDS = [
  'fcmToken', 'fcm_token', 'fcmTokenMobile', 'fcm_token_mobile',
  'deviceToken', 'device_token', 'pushToken', 'push_token',
  'firebaseToken', 'firebase_token', 'notificationToken', 'notification_token',
];

const MODEL_BY_ROLE = { user: User, driver: Driver, owner: Owner };

const pickToken = (body = {}) => {
  for (const key of TOKEN_FIELDS) {
    const value = String(body?.[key] ?? '').trim();
    if (value) return { key, value };
  }
  return null;
};

const findAccessToken = (payload) => {
  const data = payload?.data || {};
  return payload?.token || payload?.access_token || data.token || data.accessToken || data.access_token || null;
};

export const captureFcmTokenOnAuth = (req, res, next) => {
  if (req.method !== 'POST') return next();

  // Field names only — enough to see what the app sends, with no values logged.
  const keys = Object.keys(req.body || {});
  console.log(`[fcm-capture] ${req.originalUrl} body fields: ${keys.join(',') || '(none)'}`);

  const found = pickToken(req.body);
  if (!found) return next();

  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const result = originalJson(payload);

    if (res.statusCode < 300 && payload?.success !== false) {
      (async () => {
        const accessToken = findAccessToken(payload);
        if (!accessToken) return;
        const { sub, role } = verifyAccessToken(accessToken);
        const Model = MODEL_BY_ROLE[String(role || '').toLowerCase()];
        if (!Model || !sub) return;

        const entity = await Model.findById(sub);
        if (!entity) return;

        const platform = String(req.body?.platform || req.body?.device_type || 'mobile').toLowerCase();
        assignPushTokenToEntity(entity, {
          token: found.value,
          platform: ['web', 'android', 'ios', 'mobile'].includes(platform) ? platform : 'mobile',
        });
        await entity.save();
        console.log(`[fcm-capture] saved token from "${found.key}" for ${role} ${sub}`);
      })().catch((error) => console.warn('[fcm-capture] could not save token:', error.message));
    }

    return result;
  };

  return next();
};

// Every route that signs someone in or creates their account.
export const FCM_CAPTURE_PATHS = [
  '/users/signup', '/users/register', '/users/login', '/users/otp-login', '/users/auth/verify-otp',
  '/drivers/login', '/drivers/register', '/drivers/auth/verify-otp',
  '/drivers/onboarding/verify-otp', '/drivers/onboarding/complete',
  '/user/register', '/validate-otp',
];
