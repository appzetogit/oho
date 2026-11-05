// node --test src/modules/taxi/milestones/__tests__/milestoneRules.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  appliesToDriver,
  evaluateMilestone,
  istDayStart,
  milestoneProblem,
  normalizeMilestone,
  phoneListProblem,
  toIstDayKey,
  weekOf,
} from '../services/milestoneRules.js';
import { countedSeconds } from '../services/onlineTimeService.js';

const HOURS_6 = 6 * 3600;
const DAY = '2026-11-05'; // a Thursday

const daily = (extra = {}) => normalizeMilestone({
  id: 'm1',
  name: 'Six hours',
  repeat: 'daily',
  required_days: 1,
  active_hours_per_day: 6,
  min_trips: 0,
  payout_amount: 50,
  payout_mode: 'auto',
  ...extra,
});

const run = (milestone, seconds = {}, { trips = {}, payouts = [], day = DAY } = {}) => evaluateMilestone({
  milestone,
  day,
  secondsByDay: new Map(Object.entries(seconds)),
  tripsByDay: new Map(Object.entries(trips)),
  payouts,
});

test('India day boundaries', () => {
  assert.equal(toIstDayKey('2026-11-04T18:29:00Z'), '2026-11-04');
  assert.equal(toIstDayKey('2026-11-04T18:30:00Z'), '2026-11-05');
  assert.equal(istDayStart('2026-11-05').toISOString(), '2026-11-04T18:30:00.000Z');
  assert.equal(addDays('2026-11-01', -1), '2026-10-31');
  assert.equal(weekOf('2026-11-05'), '2026-11-02');
  assert.equal(weekOf('2026-11-08'), '2026-11-02');
  assert.equal(weekOf('2026-11-09'), '2026-11-09');
});

test('the client request: 6 hours today pays today', () => {
  assert.equal(run(daily(), { [DAY]: HOURS_6 }).eligible, true);
  assert.equal(run(daily(), { [DAY]: HOURS_6 - 1 }).reason, 'not_enough_hours');
  assert.equal(run(daily(), {}).reason, 'not_enough_hours');
});

test('daily pays once a day, and again the next day', () => {
  const paidToday = [{ periodKey: DAY, windowEnd: DAY, status: 'paid' }];
  assert.equal(run(daily(), { [DAY]: HOURS_6 }, { payouts: paidToday }).reason, 'already_paid');
  const tomorrow = addDays(DAY, 1);
  assert.equal(run(daily(), { [tomorrow]: HOURS_6 }, { payouts: paidToday, day: tomorrow }).eligible, true);
});

test('several days must be in a row, and a used day is not reused', () => {
  const week = daily({ required_days: 3 });
  const a = addDays(DAY, -2);
  const b = addDays(DAY, -1);
  assert.equal(run(week, { [a]: HOURS_6, [b]: HOURS_6, [DAY]: HOURS_6 }).eligible, true);
  assert.equal(run(week, { [a]: HOURS_6, [DAY]: HOURS_6 }).reason, 'not_enough_hours');

  const paid = [{ periodKey: DAY, windowEnd: DAY, status: 'paid' }];
  const next = addDays(DAY, 1);
  const r = run(week, { [a]: HOURS_6, [b]: HOURS_6, [DAY]: HOURS_6, [next]: HOURS_6 }, { payouts: paid, day: next });
  assert.equal(r.reason, 'days_already_used');
  assert.equal(r.qualifyingDays, 1);
});

test('progress counts a run reaching yesterday while today is unfinished', () => {
  const r = run(daily({ required_days: 7 }), { [addDays(DAY, -1)]: HOURS_6, [addDays(DAY, -2)]: HOURS_6, [DAY]: 60 });
  assert.equal(r.qualifyingDays, 2);
  assert.equal(r.eligible, false);
});

test('once pays one time ever', () => {
  const once = daily({ repeat: 'once' });
  assert.equal(run(once, { [DAY]: HOURS_6 }).periodKey, 'once');
  const later = addDays(DAY, 30);
  const paid = [{ periodKey: 'once', windowEnd: DAY, status: 'paid' }];
  assert.equal(run(once, { [later]: HOURS_6 }, { payouts: paid, day: later }).reason, 'already_paid');
});

test('weekly pays once per Monday-to-Sunday week', () => {
  const weekly = daily({ repeat: 'weekly' });
  const paid = [{ periodKey: weekOf(DAY), windowEnd: DAY, status: 'paid' }];
  const sameWeek = addDays(DAY, 2);
  const nextWeek = addDays(DAY, 4);
  assert.equal(run(weekly, { [sameWeek]: HOURS_6 }, { payouts: paid, day: sameWeek }).reason, 'already_paid');
  assert.equal(run(weekly, { [nextWeek]: HOURS_6 }, { payouts: paid, day: nextWeek }).eligible, true);
});

test('minimum trips count across the required days', () => {
  const trips = daily({ min_trips: 2 });
  assert.equal(run(trips, { [DAY]: HOURS_6 }, { trips: { [DAY]: 1 } }).reason, 'not_enough_trips');
  assert.equal(run(trips, { [DAY]: HOURS_6 }, { trips: { [DAY]: 2 } }).eligible, true);
});

test('monthly limit stops payouts, and resets next month', () => {
  const capped = daily({ max_payouts_per_month: 2 });
  const payouts = [
    { periodKey: '2026-11-03', windowEnd: '2026-11-03', status: 'paid' },
    { periodKey: '2026-11-04', windowEnd: '2026-11-04', status: 'paid' },
  ];
  assert.equal(run(capped, { [DAY]: HOURS_6 }, { payouts }).reason, 'monthly_limit');
  assert.equal(run(capped, { '2026-12-01': HOURS_6 }, { payouts, day: '2026-12-01' }).eligible, true);
});

test('a failed payout blocks its own period but not the limit or later days', () => {
  const failed = [{ periodKey: DAY, windowEnd: DAY, status: 'failed' }];
  assert.equal(run(daily(), { [DAY]: HOURS_6 }, { payouts: failed }).reason, 'already_paid');
  const next = addDays(DAY, 1);
  const r = run(daily({ max_payouts_per_month: 1 }), { [next]: HOURS_6 }, { payouts: failed, day: next });
  assert.equal(r.eligible, true);
  assert.equal(r.paidThisMonth, 0);
});

test('start and end dates', () => {
  assert.equal(run(daily({ start_date: addDays(DAY, 1) }), { [DAY]: HOURS_6 }).reason, 'before_start');
  assert.equal(run(daily({ end_date: addDays(DAY, -1) }), { [DAY]: HOURS_6 }).reason, 'after_end');
  assert.equal(run(daily({ start_date: DAY, end_date: DAY }), { [DAY]: HOURS_6 }).eligible, true);
  // Days before the start don't count towards a longer run.
  const a = addDays(DAY, -1);
  assert.equal(run(daily({ required_days: 2, start_date: DAY }), { [a]: HOURS_6, [DAY]: HOURS_6 }).reason, 'before_start');
});

test('settings that would give money away are refused', () => {
  assert.match(milestoneProblem(daily({ active_hours_per_day: 0, min_trips: 0 })), /for nothing/);
  assert.match(milestoneProblem(daily({ payout_amount: 0 })), /payout amount/);
  assert.match(milestoneProblem(daily({ start_date: DAY, end_date: addDays(DAY, -1) })), /ends before/);
  assert.equal(milestoneProblem(daily({ enabled: false, payout_amount: 0 })), '');
  assert.equal(milestoneProblem(daily()), '');
  assert.equal(run(daily({ active_hours_per_day: 0, min_trips: 0 }), {}).reason, 'misconfigured');
  assert.equal(run(daily({ enabled: false }), { [DAY]: HOURS_6 }).reason, 'disabled');
});

test('milestones saved before these settings keep their old meaning', () => {
  const zeroWeeks = normalizeMilestone({ id: 'old', enabled: true, active_hours_per_day: 2, required_weeks: 0, min_trips_per_week: 0, payout_amount: 50 });
  assert.equal(zeroWeeks.required_days, 7);
  assert.equal(zeroWeeks.repeat, 'once');
  assert.equal(zeroWeeks.payout_mode, 'claim');
  const twoWeeks = normalizeMilestone({ id: 'old2', required_weeks: 2, min_trips_per_week: 10, payout_amount: 50 });
  assert.equal(twoWeeks.required_days, 14);
  assert.equal(twoWeeks.min_trips, 20);
});

test('limiting to chosen drivers, for testing', () => {
  const only = daily({ only_driver_phones: '+91 96926 39039, 9000000001' });
  assert.deepEqual(only.only_driver_phones, ['9692639039', '9000000001']);
  assert.equal(appliesToDriver(only, '9692639039'), true);
  assert.equal(appliesToDriver(only, '919692639039'), true);
  assert.equal(appliesToDriver(only, '9692639040'), false);
  assert.equal(appliesToDriver(daily(), 'anything'), true);
});

test('a mistyped test number is refused, because an empty list means every driver', () => {
  assert.equal(phoneListProblem('T', ''), '');
  assert.equal(phoneListProblem('T', '9692639039, +91 96926 39039'), '');
  assert.equal(phoneListProblem('T', ['9692639039']), '');
  assert.match(phoneListProblem('T', '969263903'), /invalid phone number: 969263903/);
  assert.match(phoneListProblem('T', '9692639039 9000000001'), /invalid/);
  assert.match(phoneListProblem('T', '9692639039, abc'), /invalid phone number: abc/);
});

test('online time only counts while on duty and heard from', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const ago = (ms) => new Date(now.getTime() - ms);
  assert.equal(countedSeconds({ wasOnline: true, previousSeenAt: ago(60000), now }), 60);
  assert.equal(countedSeconds({ wasOnline: true, previousSeenAt: ago(5 * 60000), now }), 300);
  assert.equal(countedSeconds({ wasOnline: true, previousSeenAt: ago(5 * 60000 + 1), now }), 0);
  assert.equal(countedSeconds({ wasOnline: false, previousSeenAt: ago(60000), now }), 0);
  assert.equal(countedSeconds({ wasOnline: true, previousSeenAt: null, now }), 0);
  assert.equal(countedSeconds({ wasOnline: true, previousSeenAt: new Date(now.getTime() + 1000), now }), 0);
});
