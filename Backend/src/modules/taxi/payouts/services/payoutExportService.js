import mongoose from 'mongoose';
import { ApiError } from '../../../../utils/ApiError.js';
import { WithdrawalRequest } from '../../admin/models/WithdrawalRequest.js';
import { Driver } from '../../driver/models/Driver.js';

/**
 * Driver withdrawal requests, shaped for a bank bulk-payout file.
 *
 * Read-only: exporting never changes a request or a wallet. The admin panel
 * turns these rows into the spreadsheet finance uploads to HDFC.
 *
 * Bank details come from the snapshot saved on the request when the driver
 * asked to be paid. Only if that snapshot is empty do we fall back to the
 * driver's current profile, and the row says so — paying to an account other
 * than the one on the request is something finance should notice.
 */

// Indian Financial System Code: 4 letters, a zero, then 6 letters or digits.
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const STATUSES = new Set(['pending', 'completed', 'cancelled']);

const clean = (v) => String(v ?? '').trim();

const pickBank = (snapshot = {}, profile = {}) => {
  const fromSnapshot = clean(snapshot.accountNumber) || clean(snapshot.ifsc);
  const source = fromSnapshot ? snapshot : profile;
  return {
    source: fromSnapshot ? 'request' : (clean(profile.accountNumber) ? 'profile' : 'none'),
    accountHolderName: clean(source.accountHolderName),
    accountNumber: clean(source.accountNumber).replace(/\s+/g, ''),
    ifsc: clean(source.ifsc).toUpperCase(),
    branchName: clean(source.branchName),
    upiId: clean(snapshot.upiId) || clean(profile.upiId),
    verificationStatus: clean(profile.verificationStatus),
  };
};

/** Why a row can't go into a bank transfer file, in words finance can act on. */
const problemsFor = (row) => {
  const problems = [];
  if (!(row.amount > 0)) problems.push('Amount is zero or missing');
  if (!row.bank.accountNumber) problems.push('No bank account number');
  else if (!/^\d{6,18}$/.test(row.bank.accountNumber)) problems.push('Account number is not 6–18 digits');
  if (!row.bank.ifsc) problems.push('No IFSC code');
  else if (!IFSC_PATTERN.test(row.bank.ifsc)) problems.push('IFSC code is not valid');
  if (!row.bank.accountHolderName) problems.push('No account holder name');
  return problems;
};

const parseDay = (value, endOfDay) => {
  if (!value) return null;
  const d = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:30`);
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `Invalid date: ${value}`);
  return d;
};

export const getWithdrawalPayoutRows = async ({ status = 'pending', from, to } = {}) => {
  const wanted = String(status || 'pending').toLowerCase();
  if (wanted !== 'all' && !STATUSES.has(wanted)) {
    throw new ApiError(400, 'status must be pending, completed, cancelled or all');
  }

  // Driver payouts only — fleet-owner withdrawals are a separate flow.
  const filter = { driver_id: { $ne: null } };
  if (wanted !== 'all') filter.status = wanted;

  const fromDate = parseDay(from, false);
  const toDate = parseDay(to, true);
  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = fromDate;
    if (toDate) filter.createdAt.$lte = toDate;
  }

  const requests = await WithdrawalRequest.find(filter).sort({ createdAt: 1 }).lean();
  const driverIds = [...new Set(requests.map((r) => String(r.driver_id)))]
    .filter((id) => mongoose.isValidObjectId(id));
  const drivers = await Driver.find({ _id: { $in: driverIds } })
    .select('name phone email driver_code referralCode bankDetails')
    .lean();
  const byId = new Map(drivers.map((d) => [String(d._id), d]));

  const rows = requests.map((r) => {
    const driver = byId.get(String(r.driver_id)) || {};
    const row = {
      requestId: String(r._id),
      // Short, bank-safe reference to put on the transfer and match the bank
      // statement back to this request: letters and digits only, 16 max.
      reference: `OHO${String(r._id).slice(-12).toUpperCase()}`,
      transactionId: clean(r.transactionId),
      requestedAt: r.createdAt,
      status: r.status,
      amount: Math.round(Number(r.amount || 0) * 100) / 100,
      paymentMethod: clean(r.payment_method),
      driver: {
        id: String(r.driver_id),
        name: clean(driver.name),
        phone: clean(driver.phone),
        email: clean(driver.email),
        code: clean(driver.driver_code || driver.referralCode),
      },
      bank: pickBank(r.bank_details_snapshot || {}, driver.bankDetails || {}),
    };
    row.problems = problemsFor(row);
    row.ready = row.problems.length === 0;
    return row;
  });

  const ready = rows.filter((r) => r.ready);
  return {
    filters: { status: wanted, from: from || null, to: to || null },
    generatedAt: new Date(),
    summary: {
      requests: rows.length,
      ready: ready.length,
      readyAmount: Math.round(ready.reduce((n, r) => n + r.amount, 0) * 100) / 100,
      blocked: rows.length - ready.length,
      blockedAmount: Math.round(rows.filter((r) => !r.ready).reduce((n, r) => n + r.amount, 0) * 100) / 100,
    },
    rows,
  };
};
