/**
 * Compatibility routes for the mobile apps.
 *
 * The Flutter apps were ported to this backend incompletely: they log in and
 * run rides through the current API, but a handful of screens still call the
 * old Laravel routes (/user, /mobile-otp, /driver/new-earnings, …) or routes
 * from an earlier version of this backend (/users/banners, …). Every one of
 * those was returning "Route not found".
 *
 * Each route here answers in the shape that screen was written against — the
 * Laravel `{ success, message, data }` envelope where a Laravel contract exists
 * — and does its work by delegating to the handler or service the current app
 * already uses. None of them adds a capability the API did not already expose:
 * the OTP routes call the same OTP services as /users/auth/* and
 * /drivers/auth/*, the profile route calls the same /me handlers, and so on.
 *
 * Mounted last in the taxi router, so a real route always wins.
 *
 * Three of these (/users/vehicle-map-icons, /users/banners, /drivers/heatmap)
 * have no contract anywhere — not in Laravel, not in the web app — so their
 * shapes are a best reading of the name. If a screen still fails on one, its
 * expected fields are the thing to check.
 */

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { loginRateLimit, otpSendRateLimit, otpVerifyRateLimit } from '../middlewares/rateLimitMiddleware.js';
import { getCurrentUser, registerUser } from '../user/controllers/userController.js';
import { getCurrentDriver } from '../driver/controllers/driverController.js';
import { startUserOtp, verifyUserOtp } from '../user/services/userOtpService.js';
import { startDriverLoginOtp, verifyDriverLoginOtp } from '../driver/services/loginOtpService.js';
import { listPublicVehicleCatalog } from '../admin/services/adminService.js';
import { getMailConfigStatus } from '../services/mailService.js';
import { getCustomizationSettings } from '../services/transportSettingsService.js';
import { findZoneByPickup } from '../services/matchingService.js';
import { AdminBusinessSetting } from '../admin/models/AdminBusinessSetting.js';
import { UserPreference } from '../admin/models/UserPreference.js';
import { Banner } from '../admin/promotions/models/Banner.js';
import { Owner } from '../admin/models/Owner.js';
import { Driver } from '../driver/models/Driver.js';
import { User } from '../user/models/User.js';
import { Ride } from '../user/models/Ride.js';

export const legacyCompatRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Every account type /drivers/me accepts.
const DRIVER_ROLES = ['driver', 'owner', 'pooling_driver', 'bus_driver', 'service_center', 'service_center_staff'];
// The roles that sign in through the driver OTP flow rather than the rider one.
const DRIVER_LOGIN_ROLES = ['driver', 'owner'];
const ANY_ACCOUNT = ['user', ...DRIVER_ROLES];

// ── helpers ──────────────────────────────────────────────────────────────────

// Laravel's respondSuccess / respondFailed envelope. Failures are HTTP 200 with
// success:false, which is what these screens were written to check.
const ok = (res, data = null, message = 'success') => res.json({ success: true, message, data });
const failed = (res, message, extra = {}) => res.json({ success: false, message, ...extra });
const invalid = (res, message) => res.status(422).json({ success: false, message });

/** The apps send numbers with and without the country code. */
const tenDigits = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

const flag = (value) => (['1', 1, true, 'true', 'on'].includes(value) ? '1' : '0');

/**
 * Run an existing Express handler and capture what it would have sent, so the
 * compat route reuses its logic exactly and only reshapes the result.
 */
const captureJson = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
        return this;
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });

/** Laravel's transformer field names, alongside the current ones. */
const legacyProfileAliases = (p, isUser) => {
  const base = {
    id: p.id || p._id,
    name: p.name || '',
    email: p.email || '',
    mobile: p.phone || p.mobile || '',
    gender: p.gender || '',
    profile_picture: p.profileImage || p.profile_picture || '',
    refferal_code: p.referralCode || p.refferal_code || '',
    active: p.active !== false,
    country_code: p.countryCode || '+91',
    currency_code: 'INR',
    currency_symbol: '₹',
  };
  if (isUser) return { ...base, role: 'user' };

  return {
    ...base,
    role: p.role || 'driver',
    approve: p.approve !== undefined ? Boolean(p.approve) : p.status === 'approved',
    available: Boolean(p.isOnline ?? p.available),
    service_location_id: p.service_location_id || p.serviceLocationId || null,
    vehicle_type_id: p.vehicleTypeId || p.vehicle_type_id || null,
    vehicle_type_name: p.vehicleType || p.vehicle_type_name || '',
    car_make_name: p.vehicleMake || p.car_make_name || '',
    car_model_name: p.vehicleModel || p.car_model_name || '',
    car_color: p.vehicleColor || p.car_color || '',
    car_number: p.vehicleNumber || p.car_number || '',
    rating: Number(p.rating || 0),
    no_of_ratings: Number(p.ratingCount ?? p.no_of_ratings ?? 0),
  };
};

// ── profile ──────────────────────────────────────────────────────────────────

// GET /user — Laravel AccountController@me. Delegates to the same handler as
// /users/me or /drivers/me, then flattens it and adds the old field names.
legacyCompatRouter.get(
  '/user',
  authenticate(ANY_ACCOUNT, { allowPending: true }),
  asyncHandler(async (req, res) => {
    const isUser = req.auth?.role === 'user';
    const { status, body } = await captureJson(isUser ? getCurrentUser : getCurrentDriver, req);
    if (status >= 400 || body?.success === false) return res.status(status).json(body);

    const data = body?.data || {};
    const profile = data.user || data.driver || data;
    return res.json({ success: true, message: 'success', data: { ...profile, ...legacyProfileAliases(profile, isUser) } });
  }),
);

// POST /user/update-location — Laravel ProfileController@updateLocation.
legacyCompatRouter.post(
  '/user/update-location',
  authenticate(ANY_ACCOUNT, { allowPending: true }),
  asyncHandler(async (req, res) => {
    const lat = Number(req.body?.current_lat);
    const lng = Number(req.body?.current_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return invalid(res, 'current_lat and current_lng are required');
    }

    if (req.auth?.role === 'driver') {
      const zone = await findZoneByPickup([lng, lat]).catch(() => null);
      await Driver.updateOne(
        { _id: req.auth.sub },
        { $set: { location: { type: 'Point', coordinates: [lng, lat] }, ...(zone?._id ? { zoneId: zone._id } : {}) } },
      );
    }
    // Riders: the current backend keeps no standing location for a rider —
    // pickup travels with each booking — so there is nothing to store.
    return ok(res);
  }),
);

// POST /user/update-my-lang — Laravel ProfileController@updateMyLanguage.
legacyCompatRouter.post(
  '/user/update-my-lang',
  authenticate(ANY_ACCOUNT, { allowPending: true }),
  asyncHandler(async (req, res) => {
    if (!String(req.body?.lang || '').trim()) return invalid(res, 'lang is required');
    // Laravel stored this to choose the language of server-sent notifications.
    // Nothing on the current backend reads a per-account language, so there is
    // nothing to persist; acknowledging keeps the language picker from failing.
    return ok(res);
  }),
);

// ── sign-in helpers ──────────────────────────────────────────────────────────

// POST /mobile-otp — Laravel LoginController@mobileOtp. Same OTP services as
// /users/auth/send-otp and /drivers/auth/send-otp.
legacyCompatRouter.post(
  '/mobile-otp',
  otpSendRateLimit,
  asyncHandler(async (req, res) => {
    const phone = tenDigits(req.body?.mobile);
    const role = String(req.body?.role || '').trim().toLowerCase();
    if (DRIVER_LOGIN_ROLES.includes(role)) await startDriverLoginOtp({ phone, role });
    else await startUserOtp({ phone });
    return ok(res);
  }),
);

// POST /validate-otp — Laravel LoginController@validateSmsOtp, which only
// confirmed the code and echoed it back; signing in was a separate call.
legacyCompatRouter.post(
  '/validate-otp',
  otpVerifyRateLimit,
  asyncHandler(async (req, res) => {
    const phone = tenDigits(req.body?.mobile);
    const otp = String(req.body?.otp || '').trim();
    const role = String(req.body?.role || '').trim().toLowerCase();
    if (!phone || !otp) return invalid(res, 'mobile and otp are required');

    // The Laravel route did not say which kind of account it was for, so try
    // the likely session first and fall through only when there is no session
    // of that kind — a wrong code must not get a second attempt elsewhere.
    const verifyUser = () => verifyUserOtp({ phone, otp });
    const verifyDriver = () => verifyDriverLoginOtp({ phone, otp, role: role || undefined });
    const attempts = DRIVER_LOGIN_ROLES.includes(role) ? [verifyDriver, verifyUser] : [verifyUser, verifyDriver];

    let lastError = null;
    for (const attempt of attempts) {
      try {
        await attempt();
        return ok(res, { otp });
      } catch (error) {
        lastError = error;
        if ((error?.statusCode ?? error?.status) !== 404) break;
      }
    }
    throw lastError;
  }),
);

/**
 * Laravel's validate-mobile-for-login: does an account exist for this number
 * (and optionally email)? Rate-limited like login, since it answers that
 * question for any number.
 */
const validateMobileForLogin = (kind) =>
  asyncHandler(async (req, res) => {
    const phone = tenDigits(req.body?.mobile);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = String(req.body?.role || kind).trim().toLowerCase();

    const Model = kind === 'user' ? User : role === 'owner' ? Owner : Driver;
    const phoneField = Model === Owner ? 'mobile' : 'phone';
    const live = { deletedAt: null };
    // The driver variant also reported which app modules are enabled.
    const extra = kind === 'driver' ? { enabled_module: 'both' } : {};

    const mobileExists = phone ? Boolean(await Model.exists({ [phoneField]: phone, ...live })) : false;

    if (email) {
      const emailExists = Boolean(await Model.exists({ email, ...live }));
      if (mobileExists && emailExists) return ok(res, null, 'mobile_and_email_exist');
      if (mobileExists) return ok(res, null, 'mobile_exists');
      if (emailExists) return ok(res, null, 'email_exists');
      return failed(res, kind === 'driver' ? 'email_does_not_exist' : 'email_does_not_exists', extra);
    }

    if (!phone) return invalid(res, 'mobile is required');
    if (mobileExists) return ok(res, null, 'mobile_exists');
    return failed(res, 'mobile_does_not_exists', extra);
  });

legacyCompatRouter.post('/user/validate-mobile-for-login', loginRateLimit, validateMobileForLogin('user'));
legacyCompatRouter.post('/driver/validate-mobile-for-login', loginRateLimit, validateMobileForLogin('driver'));

// POST /user/register — Laravel UserRegistrationController@register, mapped
// onto the same handler as /users/register.
legacyCompatRouter.post(
  '/user/register',
  otpSendRateLimit,
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const country = String(b.country || '').trim();

    // Keep the real request's prototype (headers, ip, auth) and swap the body.
    const shimReq = Object.create(req);
    shimReq.body = {
      name: b.name,
      phone: tenDigits(b.mobile),
      email: b.email,
      countryCode: country.startsWith('+') ? country : '+91',
      gender: b.gender,
      referralCode: b.refferal_code || b.referral_code,
    };

    const { status, body } = await captureJson(registerUser, shimReq);
    if (status >= 400 || body?.success === false) return res.status(status).json(body);

    // Laravel returned the token as access_token.
    const token = body?.data?.token || body?.data?.accessToken || body?.token;
    return res
      .status(status)
      .json({ success: true, message: 'success', ...(token ? { access_token: token } : {}), data: body?.data ?? null });
  }),
);

// POST /send-mail-otp — Laravel UserRegistrationController@sendMailOTP.
legacyCompatRouter.post(
  '/send-mail-otp',
  otpSendRateLimit,
  asyncHandler(async (_req, res) => {
    // The current backend has no email OTP flow and SMTP is not configured, so
    // there is nothing to send. /common/modules reports enable_email_otp: '0'
    // for the same reason; this tells a stale screen the truth rather than
    // claiming a mail went out.
    return failed(res, 'Email OTP is not available. Please sign in with your mobile number.');
  }),
);

// ── app configuration ────────────────────────────────────────────────────────

// GET /common/modules — Laravel CarMakeAndModelController@getAppModule. Flat,
// not enveloped, exactly as Laravel returned it.
legacyCompatRouter.get(
  '/common/modules',
  asyncHandler(async (_req, res) => {
    const [customization, business, mail] = await Promise.all([
      getCustomizationSettings(),
      AdminBusinessSetting.findOne({ scope: 'default' }).select('referral').lean(),
      getMailConfigStatus().catch(() => ({ configured: false })),
    ]);

    res.json({
      success: true,
      message: 'success',
      enable_owner_login: flag(customization.enable_owner_module),
      // Only advertise email OTP when mail can actually be delivered; otherwise
      // the app would send people to a screen that cannot work.
      enable_email_otp: mail.configured ? flag(customization.user_email_otp) : '0',
      enable_user_referral_earnings: flag(business?.referral?.user?.enabled),
      enable_driver_referral_earnings: flag(business?.referral?.driver?.enabled),
      firebase_otp_enabled: false,
    });
  }),
);

// GET /common/preferences — Laravel PreferenceController@index.
legacyCompatRouter.get(
  '/common/preferences',
  authenticate(ANY_ACCOUNT, { allowPending: true }),
  asyncHandler(async (_req, res) => {
    const rows = await UserPreference.find({ active: { $in: [1, true] } }).sort({ createdAt: -1 }).lean();
    return ok(
      res,
      rows.map((p) => ({
        id: String(p._id),
        name: p.name || '',
        icon: p.icon || '',
        created_at: p.createdAt || null,
        updated_at: p.updatedAt || null,
      })),
      'preferences_listed',
    );
  }),
);

// GET /users/vehicle-map-icons — no contract anywhere; the vehicle catalog's
// marker icons, which is what the name asks for.
//
// Every type, inactive ones included: this is a lookup for drawing drivers on
// the map, not a menu of what can be booked, and a driver already on the road
// can be on a type that has since been switched off. Filtering would leave
// those drivers without a marker.
legacyCompatRouter.get(
  '/users/vehicle-map-icons',
  asyncHandler(async (_req, res) => {
    const catalog = await listPublicVehicleCatalog();
    const rows = Array.isArray(catalog) ? catalog : catalog?.results || [];
    return ok(
      res,
      rows.map((v) => ({
        id: String(v.id || v._id),
        name: v.name || '',
        icon_types: v.icon_types || 'car',
        map_icon: v.map_icon || '',
        icon: v.map_icon || v.image || '',
      })),
      'vehicle_map_icons_listed',
    );
  }),
);

// GET /users/banners — no contract anywhere; the active promotional banners.
legacyCompatRouter.get(
  '/users/banners',
  asyncHandler(async (_req, res) => {
    const rows = await Banner.find({ active: { $in: [true, 1] } }).sort({ createdAt: -1 }).lean();
    return ok(
      res,
      rows.map((b) => ({
        id: String(b._id),
        title: b.title || '',
        image: b.image || '',
        link_type: b.link_type || '',
        external_link: b.external_link || '',
        deep_link: b.deep_link || '',
        redirect_url: b.redirect_url || '',
      })),
      'banners_listed',
    );
  }),
);

// GET /common/mobile/terms and /common/mobile/privacy — Laravel
// LandingQuickLinkController, which served HTML for an in-app web view. Same
// text as the website's legal pages.
const readLegal = (file) => {
  try {
    return fs.readFileSync(path.join(__dirname, 'content', file), 'utf8');
  } catch {
    return '';
  }
};
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const legalPage = (title, text) => {
  const body = String(text || 'Not available.')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:-apple-system,Roboto,Arial,sans-serif;line-height:1.55;color:#1f2933;margin:0;padding:18px;font-size:15px}h1{font-size:20px;margin:0 0 14px}p{margin:0 0 10px}</style></head><body><h1>${escapeHtml(title)}</h1>\n${body}\n</body></html>`;
};
const TERMS_HTML = legalPage('Terms and Conditions', readLegal('terms-content.txt'));
const PRIVACY_HTML = legalPage('Privacy Policy', readLegal('privacy-content.txt'));

legacyCompatRouter.get('/common/mobile/terms', (_req, res) => res.type('html').send(TERMS_HTML));
legacyCompatRouter.get('/common/mobile/privacy', (_req, res) => res.type('html').send(PRIVACY_HTML));

// ── driver ───────────────────────────────────────────────────────────────────

// GET /drivers/heatmap?lat&lng — no contract anywhere; recent pickup demand
// around the driver, bucketed to roughly 100 m cells.
legacyCompatRouter.get(
  '/drivers/heatmap',
  authenticate(DRIVER_ROLES, { allowPending: true }),
  asyncHandler(async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return invalid(res, 'lat and lng are required');

    const RADIUS_KM = 15;
    const WINDOW_DAYS = 14;
    const rides = await Ride.find({
      createdAt: { $gte: new Date(Date.now() - WINDOW_DAYS * 864e5) },
      pickupLocation: { $geoWithin: { $centerSphere: [[lng, lat], RADIUS_KM / 6378.1] } },
    })
      .select('pickupLocation')
      .limit(2000)
      .lean();

    const cells = new Map();
    for (const r of rides) {
      const [x, y] = r.pickupLocation?.coordinates || [];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const key = `${y.toFixed(3)},${x.toFixed(3)}`;
      cells.set(key, (cells.get(key) || 0) + 1);
    }

    const points = [...cells.entries()]
      .map(([key, weight]) => {
        const [pLat, pLng] = key.split(',').map(Number);
        return { lat: pLat, lng: pLng, weight };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 300);

    return ok(res, points, 'heatmap_listed');
  }),
);

// GET /driver/new-earnings — Laravel EarningsController@newEarnings. Weekly
// buckets back to the first completed trip in the last three months, each with
// a per-day breakdown. Returned flat, as Laravel did.
const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const pad2 = (n) => String(n).padStart(2, '0');

// Work in IST: a trip at 1 a.m. IST belongs to that day, not the previous one.
const istParts = (date) => {
  const d = new Date(date.getTime() + IST_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), dow: (d.getUTCDay() + 6) % 7 };
};
const istMidnight = (y, m, day) => new Date(Date.UTC(y, m, day) - IST_OFFSET_MS);
const startOfIstWeek = (date) => {
  const { y, m, day, dow } = istParts(date);
  return istMidnight(y, m, day - dow);
};
const fmtCarbonDMY = (date) => {
  const { y, m, day } = istParts(date);
  return `${pad2(day)}-${MONTHS[m]}-${String(y).slice(-2)}`;
};
const fmtHours = (minutes) => {
  const h = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return h > 0 ? `${h} Hr ${mins} Mins` : `${mins} Mins`;
};
const round2 = (n) => Math.round(n * 100) / 100;

legacyCompatRouter.get(
  '/driver/new-earnings',
  authenticate(['driver', 'owner'], { allowPending: true }),
  asyncHandler(async (req, res) => {
    const isOwner = req.auth.role === 'owner';
    const driverIds = isOwner
      ? (await Driver.find({ owner_id: req.auth.sub }).select('_id').lean()).map((d) => d._id)
      : [req.auth.sub];

    const now = new Date();
    const { y, m } = istParts(now);
    const threeMonthsAgo = istMidnight(y, m - 3, 1);

    const rides = await Ride.find({
      driverId: { $in: driverIds },
      status: 'completed',
      completedAt: { $gte: threeMonthsAgo },
    })
      .select('driverEarnings paymentMethod completedAt startedAt')
      .lean();

    const tripTime = (r) => new Date(r.completedAt || r.startedAt);
    const firstTrip = rides.reduce((min, r) => (!min || tripTime(r) < min ? tripTime(r) : min), null);

    // Today's online minutes are the only availability history kept, so they
    // are credited to the current week and earlier weeks report none.
    let todayMinutes = 0;
    if (!isOwner) {
      const me = await Driver.findById(req.auth.sub).select('todaySummary').lean();
      todayMinutes = Number(me?.todaySummary?.activeMinutes || 0);
    }

    const earnings = [];
    const oldestWeek = startOfIstWeek(firstTrip || now);
    for (let weekStart = startOfIstWeek(now); weekStart >= oldestWeek; weekStart = new Date(weekStart.getTime() - 7 * 864e5)) {
      const weekEnd = new Date(weekStart.getTime() + 7 * 864e5 - 1);
      const inWeek = rides.filter((r) => {
        const t = tripTime(r);
        return t >= weekStart && t <= weekEnd;
      });

      const sum = (list) => round2(list.reduce((a, r) => a + Number(r.driverEarnings || 0), 0));
      const dates = {};
      for (let i = 0; i < 7; i += 1) {
        const dayStart = new Date(weekStart.getTime() + i * 864e5);
        const dayEnd = new Date(dayStart.getTime() + 864e5 - 1);
        const label = `${DAYS[i]}-${pad2(istParts(dayStart).day)}`;
        dates[label] = sum(inWeek.filter((r) => tripTime(r) >= dayStart && tripTime(r) <= dayEnd));
      }

      const isCurrentWeek = now >= weekStart && now <= weekEnd;
      earnings.push({
        from_date: fmtCarbonDMY(weekStart),
        to_date: fmtCarbonDMY(weekEnd),
        total_amount: sum(inWeek),
        total_trips: inWeek.length,
        total_wallet_amount: sum(inWeek.filter((r) => r.paymentMethod === 'online')),
        total_cash_amount: sum(inWeek.filter((r) => r.paymentMethod === 'cash')),
        total_logged_in_hours: fmtHours(isCurrentWeek ? todayMinutes : 0),
        dates,
      });
    }

    res.json({ success: true, message: 'earnings_listed_successfully', currency_symbol: '₹', earnings });
  }),
);
