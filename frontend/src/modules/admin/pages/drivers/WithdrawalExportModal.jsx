import React, { useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Loader2, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';
import DateRangePicker from '../../components/DateRangePicker';

/**
 * Export driver withdrawal requests as a spreadsheet for a bank bulk payout
 * (HDFC). Exporting changes nothing: no request is approved, no wallet moves.
 *
 * The file has four sheets:
 *   Bank upload    — only the columns a bulk transfer needs, ready rows only
 *   Payout details — every ready row with driver, request and reconciliation info
 *   Cannot pay yet — rows that would bounce, and exactly why
 *   Summary        — counts, totals, filters, when and how it was made
 *
 * The "Bank upload" columns are the common bulk-transfer fields. HDFC's exact
 * template (column order, header names, payment-mode codes) must be confirmed
 * against the sample file the bank gives — BANK_COLUMNS is the one place to
 * change it.
 */

const BANK_COLUMNS = [
  { header: 'Payment Mode', value: (r, mode) => mode },
  { header: 'Beneficiary Name', value: (r) => r.bank.accountHolderName },
  { header: 'Beneficiary Account Number', value: (r) => r.bank.accountNumber },
  { header: 'IFSC Code', value: (r) => r.bank.ifsc },
  { header: 'Amount', value: (r) => r.amount, money: true },
  { header: 'Payment Reference', value: (r) => r.reference },
  { header: 'Narration', value: (r) => `OHO Ride payout ${r.driver.code || ''}`.trim() },
  { header: 'Beneficiary Email', value: (r) => r.driver.email },
  { header: 'Beneficiary Mobile', value: (r) => r.driver.phone },
];

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Waiting to be paid (pending)' },
  { value: 'completed', label: 'Already approved' },
  { value: 'all', label: 'All requests' },
];

const formatDate = (v) => (v ? new Date(v).toLocaleString('en-IN') : '');

const errorText = (error, fallback) => error?.response?.data?.message || error?.message || fallback;

// Every cell is written as text except amounts. Account numbers MUST stay text:
// as numbers, Excel rounds anything over 15 digits and drops leading zeros,
// and the bank would pay the wrong account or reject the row.
const sheetFrom = (header, rows, moneyColumns = []) => {
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let r = 1; r <= range.e.r; r += 1) {
    for (let c = 0; c <= range.e.c; c += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      if (moneyColumns.includes(c) && typeof cell.v === 'number') {
        cell.t = 'n';
        cell.z = '0.00';
      } else {
        cell.t = 's';
        cell.v = String(cell.v ?? '');
      }
    }
  }
  sheet['!cols'] = header.map((h) => ({ wch: Math.max(12, String(h).length + 2) }));
  return sheet;
};

const buildWorkbook = (data, mode) => {
  const ready = data.rows.filter((r) => r.ready);
  const blocked = data.rows.filter((r) => !r.ready);
  const wb = XLSX.utils.book_new();

  const bankMoneyCol = BANK_COLUMNS.findIndex((c) => c.money);
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom(BANK_COLUMNS.map((c) => c.header), ready.map((r) => BANK_COLUMNS.map((c) => c.value(r, mode))), [bankMoneyCol]),
    'Bank upload',
  );

  const detailHeader = [
    'Payment Reference', 'OHO Request ID', 'Requested On', 'Status', 'Amount',
    'Driver Name', 'Driver Code', 'Driver Mobile',
    'Account Holder', 'Account Number', 'IFSC', 'Branch', 'UPI ID',
    'Bank Details Taken From', 'Bank Verified',
  ];
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom(detailHeader, ready.map((r) => [
      r.reference, r.requestId, formatDate(r.requestedAt), r.status, r.amount,
      r.driver.name, r.driver.code, r.driver.phone,
      r.bank.accountHolderName, r.bank.accountNumber, r.bank.ifsc, r.bank.branchName, r.bank.upiId,
      r.bank.source === 'request' ? 'Withdrawal request' : 'Driver profile (request had none)',
      r.bank.verificationStatus || 'Not verified',
    ]), [4]),
    'Payout details',
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom(['Why it cannot be paid', 'Driver Name', 'Driver Mobile', 'Amount', 'Requested On', 'OHO Request ID', 'UPI ID (if any)'],
      blocked.map((r) => [r.problems.join('; '), r.driver.name, r.driver.phone, r.amount, formatDate(r.requestedAt), r.requestId, r.bank.upiId]),
      [3]),
    'Cannot pay yet',
  );

  const s = data.summary;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['OHO Ride — driver payout export'],
    [],
    ['Generated', formatDate(data.generatedAt)],
    ['Requests included', STATUS_OPTIONS.find((o) => o.value === data.filters.status)?.label || data.filters.status],
    ['From', data.filters.from || 'any date'],
    ['To', data.filters.to || 'any date'],
    ['Payment mode', mode],
    [],
    ['Ready to pay', s.ready, 'Amount', s.readyAmount],
    ['Cannot pay yet', s.blocked, 'Amount', s.blockedAmount],
    [],
    ['Exporting does not approve requests or move any money.'],
    ['Pay the "Bank upload" sheet through HDFC, then approve each paid request in the admin panel.'],
  ]), 'Summary');

  return wb;
};

const WithdrawalExportModal = ({ onClose }) => {
  const [status, setStatus] = useState('pending');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState('NEFT');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const preview = async () => {
    setLoading(true);
    try {
      const res = await adminService.getWithdrawalPayoutExport({ status, from: from || undefined, to: to || undefined });
      setData(res?.data || null);
    } catch (error) {
      toast.error(errorText(error, 'Could not load the requests'));
    } finally {
      setLoading(false);
    }
  };

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const fileBase = () => `OHO_driver_payouts_${status}${from ? `_${from}` : ''}${to ? `_to_${to}` : ''}_${stamp()}`;

  const downloadExcel = () => {
    XLSX.writeFile(buildWorkbook(data, mode), `${fileBase()}.xlsx`);
    toast.success('Spreadsheet downloaded');
  };

  const downloadCsv = () => {
    const ready = data.rows.filter((r) => r.ready);
    const csv = XLSX.utils.sheet_to_csv(
      sheetFrom(BANK_COLUMNS.map((c) => c.header), ready.map((r) => BANK_COLUMNS.map((c) => c.value(r, mode)))),
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${fileBase()}_bank_upload.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success('Bank upload CSV downloaded');
  };

  const summary = data?.summary;
  const reasons = data
    ? Object.entries(data.rows.filter((r) => !r.ready).flatMap((r) => r.problems)
      .reduce((acc, p) => ({ ...acc, [p]: (acc[p] || 0) + 1 }), {}))
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={20} className="text-emerald-600" />
            <div>
              <h2 className="text-lg font-bold text-gray-900">Export for bank payout</h2>
              <p className="text-xs text-gray-500">Spreadsheet for an HDFC bulk transfer. Nothing is approved or paid.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label htmlFor="payout-export-status" className="mb-1 block text-xs font-semibold text-gray-600">Which requests</label>
            <select id="payout-export-status" value={status} onChange={(e) => { setStatus(e.target.value); setData(null); }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-yellow-400">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="payout-export-dates" className="mb-1 block text-xs font-semibold text-gray-600">Requested between</label>
            <DateRangePicker
              id="payout-export-dates"
              from={from}
              to={to}
              onChange={(range) => { setFrom(range.from); setTo(range.to); setData(null); }}
            />
          </div>
          <div>
            <label htmlFor="payout-export-mode" className="mb-1 block text-xs font-semibold text-gray-600">Payment mode</label>
            <select id="payout-export-mode" value={mode} onChange={(e) => setMode(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-yellow-400">
              <option value="NEFT">NEFT — any bank, settles in batches</option>
              <option value="IMPS">IMPS — any bank, instant</option>
              <option value="RTGS">RTGS — ₹2 lakh and above only</option>
            </select>
          </div>

          {!data ? (
            <button type="button" onClick={preview} disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-900 disabled:opacity-50">
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              Check requests
            </button>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Ready to pay</p>
                  <p className="text-xl font-black text-emerald-900 tabular-nums">{summary.ready}</p>
                  <p className="text-xs text-emerald-800 tabular-nums">₹{summary.readyAmount.toFixed(2)}</p>
                </div>
                <div className={`rounded-lg border p-3 ${summary.blocked ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                  <p className={`text-[11px] font-bold uppercase tracking-wider ${summary.blocked ? 'text-amber-700' : 'text-gray-500'}`}>Cannot pay yet</p>
                  <p className="text-xl font-black text-gray-900 tabular-nums">{summary.blocked}</p>
                  <p className="text-xs text-gray-700 tabular-nums">₹{summary.blockedAmount.toFixed(2)}</p>
                </div>
              </div>

              {reasons.length ? (
                <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="mb-1 flex items-center gap-1.5 font-bold"><AlertTriangle size={14} /> Why some can't be paid</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {reasons.map(([reason, n]) => <li key={reason}>{reason} — {n}</li>)}
                  </ul>
                  <p className="mt-1.5">They're listed in the "Cannot pay yet" sheet. The driver needs to add or fix their bank details in the app.</p>
                </div>
              ) : null}

              {summary.requests === 0 ? (
                <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">No requests match these filters.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={downloadExcel}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">
                    <Download size={16} /> Excel (.xlsx)
                  </button>
                  <button type="button" onClick={downloadCsv} disabled={!summary.ready}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                    <Download size={16} /> Bank CSV only
                  </button>
                </div>
              )}
              <button type="button" onClick={() => setData(null)} className="w-full text-center text-xs font-semibold text-gray-500 hover:text-gray-800">
                Change filters
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default WithdrawalExportModal;
