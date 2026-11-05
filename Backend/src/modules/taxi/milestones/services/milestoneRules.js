/**
 * The rules for driver milestones, with no database in sight, so they can be
 * tested on their own. Everything here works on India dates ('YYYY-MM-DD').
 *
 * A milestone is whatever an admin configures on the driver incentive screen:
 *
 *   ₹50 every day for 6 hours online:
 *     { repeat: 'daily', required_days: 1, active_hours_per_day: 6,
 *       min_trips: 0, payout_amount: 50, payout_mode: 'auto' }
 *
 * A "qualifying day" is a day with enough online hours. A payout needs
 * required_days of them in a row, plus min_trips completed across those days.
 * A day that earned one payout never counts towards another.
 */

export const REPEAT_OPTIONS = ['once', 'daily', 'weekly'];
export const PAYOUT_MODES = ['auto', 'claim'];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const toIstDayKey = (value = new Date()) =>
  new Date(new Date(value).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export const addDays = (dayKey, days) =>
  new Date(Date.parse(`${dayKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

export const monthOf = (dayKey) => String(dayKey).slice(0, 7);

/** The Monday of the week containing this day. */
export const weekOf = (dayKey) => {
  const weekday = new Date(`${dayKey}T00:00:00.000Z`).getUTCDay();
  return addDays(dayKey, weekday === 0 ? -6 : 1 - weekday);
};

export const istDayStart = (dayKey) => new Date(Date.parse(`${dayKey}T00:00:00.000Z`) - IST_OFFSET_MS);

const nonNegative = (value) => Math.max(0, Number(value) || 0);
const wholeNumber = (value) => Math.floor(nonNegative(value));
const validDate = (value) => (DATE_PATTERN.test(String(value || '')) ? String(value) : '');

const lastTenDigits = (value) => String(value || '').replace(/\D/g, '').slice(-10);

const phoneEntries = (value) =>
  (Array.isArray(value) ? value : String(value || '').split(/[,;\n]+/))
    .map((item) => String(item).trim())
    .filter(Boolean);

const parsePhones = (value) => [
  ...new Set(phoneEntries(value).map(lastTenDigits).filter((phone) => phone.length === 10)),
];

// A valid number is 10 digits, or 12 starting with the country code. Two numbers
// run together, or a typo, must not pass: an empty list means every driver.
const invalidPhones = (value) => phoneEntries(value).filter((item) => {
  const digits = item.replace(/\D/g, '');
  return !(digits.length === 10 || (digits.length === 12 && digits.startsWith('91')));
});

/**
 * Fills in every setting. Milestones saved before these settings existed have
 * no `repeat`; they keep the meaning they always had, which was a one-off the
 * driver claims after a number of full weeks.
 */
export const normalizeMilestone = (raw = {}, index = 0) => {
  const isLegacy = raw.repeat === undefined;
  const legacyWeeks = Math.max(1, wholeNumber(raw.required_weeks));

  return {
    id: String(raw.id || `milestone_${index + 1}`).trim(),
    name: String(raw.name || `Milestone ${index + 1}`).trim(),
    enabled: Boolean(raw.enabled ?? true),
    repeat: REPEAT_OPTIONS.includes(raw.repeat) ? raw.repeat : 'once',
    required_days: isLegacy ? legacyWeeks * 7 : Math.max(1, wholeNumber(raw.required_days)),
    active_hours_per_day: Math.min(24, nonNegative(raw.active_hours_per_day)),
    min_trips: isLegacy ? wholeNumber(raw.min_trips_per_week) * legacyWeeks : wholeNumber(raw.min_trips),
    payout_amount: nonNegative(raw.payout_amount),
    payout_mode: PAYOUT_MODES.includes(raw.payout_mode) ? raw.payout_mode : 'claim',
    max_payouts_per_month: wholeNumber(raw.max_payouts_per_month),
    start_date: validDate(raw.start_date),
    end_date: validDate(raw.end_date),
    only_driver_phones: parsePhones(raw.only_driver_phones),
    notes: String(raw.notes || '').trim(),
  };
};

/** Why the phone list as typed can't be accepted, or '' if it's fine. */
export const phoneListProblem = (name, rawPhones) => {
  const invalid = invalidPhones(rawPhones);
  return invalid.length ? `"${name}" has an invalid phone number: ${invalid.join(', ')}` : '';
};

/** Why a milestone can't be saved switched on, or '' if it's fine. */
export const milestoneProblem = (milestone) => {
  if (!milestone.enabled) return '';
  if (milestone.payout_amount <= 0) return `"${milestone.name}" needs a payout amount above 0`;
  if (milestone.active_hours_per_day <= 0 && milestone.min_trips <= 0) {
    return `"${milestone.name}" needs online hours or minimum trips, or it would pay every driver for nothing`;
  }
  if (milestone.start_date && milestone.end_date && milestone.end_date < milestone.start_date) {
    return `"${milestone.name}" ends before it starts`;
  }
  return '';
};

export const appliesToDriver = (milestone, phone) =>
  milestone.only_driver_phones.length === 0
  || milestone.only_driver_phones.includes(lastTenDigits(phone));

export const periodKeyFor = (milestone, dayKey) => {
  if (milestone.repeat === 'daily') return dayKey;
  if (milestone.repeat === 'weekly') return weekOf(dayKey);
  return 'once';
};

/**
 * Could this milestone pay out for the period ending on `day`?
 *
 *   secondsByDay / tripsByDay  Map of dayKey -> number, for this driver
 *   payouts                    this driver's payouts for this milestone
 *                              ({ periodKey, windowEnd, status })
 *
 * `reason` is empty when eligible, and otherwise says what's missing.
 */
export const evaluateMilestone = ({ milestone, day, secondsByDay, tripsByDay, payouts = [] }) => {
  const requiredSeconds = milestone.active_hours_per_day * 3600;
  const dayQualifies = (key) => (secondsByDay.get(key) || 0) >= requiredSeconds;

  const counted = payouts.filter((item) => item.status !== 'failed');
  const lastWindowEnd = counted.reduce(
    (latest, item) => (String(item.windowEnd || '') > latest ? String(item.windowEnd) : latest),
    '',
  );
  const periodKey = periodKeyFor(milestone, day);
  const windowStart = addDays(day, 1 - milestone.required_days);

  // Every row counts here, failed ones too: the unique index won't take a
  // second row for this period, and a failed payout is for an admin to look at.
  const isClaimed = payouts.some((item) => item.periodKey === periodKey);

  // The current run of qualifying days, for showing progress. Today may simply
  // not be finished yet, so it doesn't break a run that reaches yesterday.
  const earliest = [milestone.start_date, lastWindowEnd ? addDays(lastWindowEnd, 1) : '']
    .reduce((latest, item) => (item > latest ? item : latest), '');
  let qualifyingDays = 0;
  let cursor = dayQualifies(day) ? day : addDays(day, -1);
  while (qualifyingDays < milestone.required_days && cursor >= earliest && dayQualifies(cursor)) {
    qualifyingDays += 1;
    cursor = addDays(cursor, -1);
  }

  let trips = 0;
  for (let offset = 0; offset < milestone.required_days; offset += 1) {
    trips += tripsByDay.get(addDays(day, -offset)) || 0;
  }

  const paidThisMonth = counted.filter((item) => monthOf(item.windowEnd) === monthOf(day)).length;

  const reason = (() => {
    if (!milestone.enabled) return 'disabled';
    if (milestoneProblem(milestone)) return 'misconfigured';
    if (milestone.start_date && windowStart < milestone.start_date) return 'before_start';
    if (milestone.end_date && day > milestone.end_date) return 'after_end';
    if (isClaimed) return 'already_paid';
    if (lastWindowEnd && windowStart <= lastWindowEnd) return 'days_already_used';
    if (milestone.max_payouts_per_month > 0 && paidThisMonth >= milestone.max_payouts_per_month) {
      return 'monthly_limit';
    }
    if (qualifyingDays < milestone.required_days || !dayQualifies(day)) return 'not_enough_hours';
    if (trips < milestone.min_trips) return 'not_enough_trips';
    return '';
  })();

  return {
    eligible: reason === '',
    reason,
    periodKey,
    windowStart,
    windowEnd: day,
    isClaimed,
    qualifyingDays,
    targetDays: milestone.required_days,
    trips,
    requiredTrips: milestone.min_trips,
    onlineSeconds: secondsByDay.get(day) || 0,
    requiredSeconds,
    paidThisMonth,
  };
};
