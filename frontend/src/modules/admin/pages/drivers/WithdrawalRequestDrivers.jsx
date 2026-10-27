import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Eye, FileSearch, FileSpreadsheet, QrCode, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';
import WithdrawalExportModal from './WithdrawalExportModal';

const BASE = () => `${globalThis.__LEGACY_BACKEND_ORIGIN__}/api/v1/admin/wallet/drivers/withdrawals`;

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-IN');
};

const WithdrawalRequestDrivers = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [paginator, setPaginator] = useState(null);
  const [loading, setLoading] = useState(true);
  // Which driver row is mid-approval, so its buttons can be disabled.
  const [busyDriverId, setBusyDriverId] = useState(null);
  const [exporting, setExporting] = useState(false);

  const fetchRows = async ({
    nextPage = page,
    nextLimit = itemsPerPage,
    nextSearch = searchTerm,
  } = {}) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: String(nextLimit),
      });
      if (String(nextSearch || '').trim()) {
        params.set('search', String(nextSearch).trim());
      }
      const res = await fetch(`${BASE()}?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRows(data.data?.results || []);
        setPaginator(data.data?.paginator || null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows({ nextPage: 1, nextLimit: itemsPerPage, nextSearch: searchTerm });
    setPage(1);
  }, [itemsPerPage]);

  useEffect(() => {
    const id = setTimeout(() => {
      fetchRows({ nextPage: 1, nextLimit: itemsPerPage, nextSearch: searchTerm });
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [searchTerm]);

  useEffect(() => {
    fetchRows({ nextPage: page, nextLimit: itemsPerPage, nextSearch: searchTerm });
  }, [page]);

  // Approve or reject straight from this list. Staff had to open the detail page
  // and find a menu that only appeared on pending rows, so the list looked as if
  // it had no way to pay anyone.
  const handleDecision = async (item, decision) => {
    const requestId = item.latest_request_id;
    if (!requestId) {
      toast.error('This row has no pending request to act on. Open the details to see its history.');
      return;
    }

    const name = item.driver?.name || 'this driver';
    const amount = Number(item.pending_amount || 0).toFixed(2);
    const payTo =
      item.driver?.bankDetails?.accountHolderName ||
      item.driver?.bankDetails?.upiId ||
      item.driver?.bankDetails?.accountNumber ||
      'the details on file';

    const confirmed = window.confirm(
      decision === 'approve'
        ? `Approve ₹${amount} for ${name}?\n\nPaying out to: ${payTo}\n\nThe amount is taken out of the driver's wallet straight away and this cannot be undone. Make the bank transfer yourself.`
        : `Reject the ₹${amount} request from ${name}?\n\nTheir wallet is not touched and they can ask again.`,
    );
    if (!confirmed) return;

    setBusyDriverId(item.driver_id);
    try {
      if (decision === 'approve') {
        await adminService.approveDriverWithdrawalRequest(requestId);
        toast.success(`Approved ₹${amount} for ${name}`);
      } else {
        await adminService.rejectDriverWithdrawalRequest(requestId);
        toast.success(`Rejected the request from ${name}`);
      }
      await fetchRows({ nextPage: page, nextLimit: itemsPerPage, nextSearch: searchTerm });
    } catch (error) {
      const message = error?.response?.data?.message || error?.message || 'Something went wrong';
      toast.error(`Could not ${decision} this request: ${message}`);
    } finally {
      setBusyDriverId(null);
    }
  };

  const totalPages = useMemo(() => Math.max(1, Number(paginator?.last_page || 1)), [paginator]);
  const safePage = useMemo(() => Math.min(Math.max(1, page), totalPages), [page, totalPages]);
  const totalEntries = useMemo(() => Number(paginator?.total || 0), [paginator]);
  const perPage = useMemo(() => Number(paginator?.per_page || itemsPerPage), [paginator, itemsPerPage]);
  const startIndex = useMemo(() => (safePage - 1) * perPage, [safePage, perPage]);
  const showingFrom = totalEntries === 0 ? 0 : startIndex + 1;
  const showingTo = totalEntries === 0 ? 0 : Math.min(startIndex + rows.length, totalEntries);

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 lg:p-6 font-sans text-gray-900">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Driver Wallet</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Withdrawal Request Drivers</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl text-gray-900 font-bold">Withdrawal Request Drivers</h1>
          <button
            type="button"
            onClick={() => setExporting(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 shadow-sm"
          >
            <FileSpreadsheet size={16} />
            Export for bank
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span>Show</span>
            <select
              value={itemsPerPage}
              onChange={(event) => setItemsPerPage(Number(event.target.value) || 10)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 outline-none transition-colors"
            >
              {[10, 25, 50, 100].map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
            <span>entries</span>
          </div>

          <div className="relative w-full md:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search..."
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-800 bg-white focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400 outline-none transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr className="text-xs font-semibold text-gray-500">
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Name</th>
                <th className="px-6 py-4">Driver Code</th>
                <th className="px-6 py-4">Mobile Number</th>
                <th className="px-6 py-4">Payout</th>
                <th className="px-6 py-4">Requested Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-sm text-gray-400">
                    Loading...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-gray-400">
                      <FileSearch size={44} strokeWidth={1.5} />
                      <p className="text-sm font-medium">No Data Found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((item) => (
                  <tr key={item.driver_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {formatDateTime(item.last_request_at)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-800">
                      {item.driver?.name || 'Unknown'}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium">
                      <span className="font-mono font-bold text-[10px] uppercase tracking-wider text-black bg-yellow-400 px-2 py-0.5 rounded shadow-sm">
                        {item.driver?.driver_code || item.driver?.referralCode || (item.driver?.mobile ? `DRV${String(item.driver.mobile).slice(-4)}${String(item.driver_id || '').slice(-6).toUpperCase()}`.replace(/\W/g, '') : 'N/A')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {item.driver?.mobile || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <div className="space-y-1">
                        <div className="font-semibold text-gray-800">
                          {item.driver?.bankDetails?.accountHolderName || item.driver?.bankDetails?.upiId || item.driver?.bankDetails?.accountNumber || '-'}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          {item.driver?.bankDetails?.accountNumber ? <span>A/C {item.driver.bankDetails.accountNumber}</span> : null}
                          {item.driver?.bankDetails?.ifsc ? <span>{item.driver.bankDetails.ifsc}</span> : null}
                          {item.driver?.bankDetails?.branchName ? <span>{item.driver.bankDetails.branchName}</span> : null}
                          {item.driver?.bankDetails?.qrCodeImage ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700">
                              <QrCode size={12} />
                              QR
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-800">
                      Rs {Number(item.pending_amount || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className="inline-flex rounded-full px-3 py-1 text-xs font-semibold bg-yellow-100 text-yellow-800">
                        Requested
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleDecision(item, 'approve')}
                          disabled={busyDriverId === item.driver_id || !item.latest_request_id}
                          title="Approve and deduct from the driver's wallet"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50 disabled:hover:bg-emerald-600"
                        >
                          <Check size={16} />
                          {busyDriverId === item.driver_id ? 'Working...' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(item, 'reject')}
                          disabled={busyDriverId === item.driver_id || !item.latest_request_id}
                          title="Reject this request; the wallet is not touched"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors shadow-sm disabled:opacity-50"
                        >
                          <X size={16} />
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/admin/drivers/wallet/withdrawals/${item.driver_id}${
                                item.latest_request_id ? `?requestId=${item.latest_request_id}` : ''
                              }`,
                            )
                          }
                          title="Bank details and past requests"
                          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                        >
                          <Eye size={16} />
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-gray-500">
          <div>
            Showing {showingFrom} to {showingTo} of {totalEntries} entries
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage <= 1}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="px-3 py-2 bg-yellow-400 text-black shadow-sm font-bold rounded-lg text-sm">{safePage}</span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={safePage >= totalPages}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      {exporting ? <WithdrawalExportModal onClose={() => setExporting(false)} /> : null}
    </div>
  );
};

export default WithdrawalRequestDrivers;
