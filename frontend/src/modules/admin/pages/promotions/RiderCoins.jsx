import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Coins, History, Loader2, Minus, Plus, Save, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

/**
 * Rider Coins: riders earn coins for every completed ride. This screen turns
 * the programme on and off, sets the earning rules, and lets staff look up a
 * rider's balance and add or remove coins by hand.
 */

const RULE_FIELDS = [
  {
    key: 'coinsPerRide',
    label: 'Coins per ride',
    help: 'Every completed ride earns this many coins.',
    suffix: 'coins',
  },
  {
    key: 'coinsPerHundredRupees',
    label: 'Extra coins per ₹100 of fare',
    help: 'Longer, pricier rides earn more. 0 turns this off.',
    suffix: 'coins',
  },
  {
    key: 'minFareForCoins',
    label: 'Minimum fare to earn',
    help: 'Rides below this fare earn nothing. 0 means every ride qualifies.',
    prefix: '₹',
  },
  {
    key: 'maxCoinsPerRide',
    label: 'Most coins from one ride',
    help: 'A ceiling on a single ride. 0 means no ceiling.',
    suffix: 'coins',
  },
];

// Same rules the server applies, so the preview always matches what riders get.
const coinsForFare = (fare, rules) => {
  const amount = Number(fare) || 0;
  if (amount <= 0) return 0;
  if (Number(rules.minFareForCoins || 0) > 0 && amount < Number(rules.minFareForCoins)) return 0;
  let coins = Math.floor(Number(rules.coinsPerRide) || 0)
    + Math.floor((amount / 100) * (Number(rules.coinsPerHundredRupees) || 0));
  const cap = Math.floor(Number(rules.maxCoinsPerRide) || 0);
  if (cap > 0) coins = Math.min(coins, cap);
  return Math.max(0, coins);
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const errorText = (error, fallback) => error?.response?.data?.message || error?.message || fallback;

const TYPE_LABELS = {
  ride_earn: 'Ride',
  admin_credit: 'Added by staff',
  admin_debit: 'Removed by staff',
};

const StatCard = ({ label, value, hint }) => (
  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
    <p className="mt-1 text-2xl font-black tracking-tight text-gray-900 tabular-nums">{value}</p>
    {hint ? <p className="mt-0.5 text-xs text-gray-500">{hint}</p> : null}
  </div>
);

const AdjustModal = ({ rider, onClose, onDone }) => {
  const [direction, setDirection] = useState('add');
  const [coins, setCoins] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const amount = Math.floor(Number(coins) || 0);
  const after = direction === 'add' ? rider.balance + amount : rider.balance - amount;
  const tooMany = direction === 'remove' && amount > rider.balance;
  const canSave = amount > 0 && note.trim() && !tooMany && !saving;

  const submit = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await adminService.adjustRiderCoins(rider.userId, {
        coins: direction === 'add' ? amount : -amount,
        note: note.trim(),
      });
      toast.success(`${direction === 'add' ? 'Added' : 'Removed'} ${amount} coins ${direction === 'add' ? 'to' : 'from'} ${rider.name}`);
      onDone();
    } catch (error) {
      toast.error(errorText(error, 'Could not change the balance'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Adjust coins</h2>
            <p className="text-sm text-gray-500">{rider.name} · {rider.phone || 'no phone'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Add or remove">
            {[
              { id: 'add', label: 'Add coins', Icon: Plus },
              { id: 'remove', label: 'Remove coins', Icon: Minus },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={direction === id}
                onClick={() => setDirection(id)}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
                  direction === id
                    ? id === 'add' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="coin-adjust-amount" className="mb-1 block text-xs font-semibold text-gray-600">Number of coins</label>
            <input
              id="coin-adjust-amount"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={coins}
              onChange={(e) => setCoins(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-yellow-400"
              placeholder="e.g. 50"
            />
          </div>

          <div>
            <label htmlFor="coin-adjust-note" className="mb-1 block text-xs font-semibold text-gray-600">Reason (required)</label>
            <input
              id="coin-adjust-note"
              type="text"
              maxLength={300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-yellow-400"
              placeholder="e.g. Compensation for a cancelled ride"
            />
          </div>

          <div className={`rounded-lg px-3 py-2.5 text-sm ${tooMany ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-700'}`}>
            {tooMany
              ? `${rider.name} only has ${rider.balance} coins.`
              : <>Balance goes from <strong className="tabular-nums">{rider.balance}</strong> to <strong className="tabular-nums">{amount > 0 ? after : rider.balance}</strong> coins.</>}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 p-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-bold text-white hover:bg-gray-900 disabled:opacity-40"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            {direction === 'add' ? 'Add coins' : 'Remove coins'}
          </button>
        </div>
      </form>
    </div>
  );
};

const HistoryPanel = ({ rider, onClose }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    adminService.getRiderCoinTransactions(rider.userId)
      .then((res) => { if (alive) setData(res?.data || null); })
      .catch((err) => { if (alive) setError(errorText(err, 'Could not load history')); });
    return () => { alive = false; };
  }, [rider.userId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Coin history</h2>
            <p className="text-sm text-gray-500">{rider.name} · balance <strong className="tabular-nums">{data?.balance ?? rider.balance}</strong></p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {error ? <p className="p-5 text-sm text-red-600">{error}</p> : null}
          {!data && !error ? (
            <div className="flex items-center gap-2 p-5 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Loading…</div>
          ) : null}
          {data && data.transactions.length === 0 ? <p className="p-5 text-sm text-gray-500">No coin activity yet.</p> : null}
          {data?.transactions.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">{TYPE_LABELS[t.type] || t.type}</p>
                <p className="truncate text-xs text-gray-500">
                  {t.note}{t.fare ? ` · fare ₹${Number(t.fare).toFixed(2)}` : ''}
                </p>
                <p className="text-[11px] text-gray-400">{formatDate(t.createdAt)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={`text-sm font-bold tabular-nums ${t.coins >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {t.coins >= 0 ? '+' : ''}{t.coins}
                </p>
                {t.balanceAfter !== null && t.balanceAfter !== undefined ? (
                  <p className="text-[11px] text-gray-400 tabular-nums">balance {t.balanceAfter}</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
};

const RiderCoins = () => {
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [summary, setSummary] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  const [rows, setRows] = useState([]);
  const [paginator, setPaginator] = useState({ current_page: 1, last_page: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loadingRows, setLoadingRows] = useState(true);

  const [adjusting, setAdjusting] = useState(null);
  const [viewing, setViewing] = useState(null);

  const loadSettings = useCallback(async () => {
    try {
      const [s, sum] = await Promise.all([adminService.getCoinSettings(), adminService.getCoinSummary()]);
      setSettings(s?.data || null);
      setDraft(s?.data || null);
      setSummary(sum?.data || null);
    } catch (error) {
      toast.error(errorText(error, 'Could not load coin settings'));
    }
  }, []);

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const res = await adminService.getRiderCoinAccounts({ page, limit: 20, search });
      setRows(res?.data?.results || []);
      setPaginator(res?.data?.paginator || { current_page: 1, last_page: 1, total: 0 });
    } catch (error) {
      toast.error(errorText(error, 'Could not load riders'));
    } finally {
      setLoadingRows(false);
    }
  }, [page, search]);

  useEffect(() => { loadSettings(); }, [loadSettings]);
  useEffect(() => { loadRows(); }, [loadRows]);

  useEffect(() => {
    const id = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);

  const dirty = useMemo(() => (
    Boolean(settings && draft) && RULE_FIELDS.some((f) => Number(settings[f.key]) !== Number(draft[f.key]))
  ), [settings, draft]);

  const saveRules = async () => {
    setSaving(true);
    try {
      const payload = Object.fromEntries(RULE_FIELDS.map((f) => [f.key, Number(draft[f.key]) || 0]));
      const res = await adminService.updateCoinSettings(payload);
      setSettings(res?.data);
      setDraft(res?.data);
      toast.success('Earning rules saved');
    } catch (error) {
      toast.error(errorText(error, 'Could not save the rules'));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async () => {
    const turningOn = !settings?.enabled;
    const ok = window.confirm(
      turningOn
        ? 'Switch rider coins ON?\n\nFrom now on every completed ride earns coins under the rules on this page. Rides completed before today do not earn.'
        : 'Switch rider coins OFF?\n\nRides stop earning coins. Coins riders already have are kept.',
    );
    if (!ok) return;
    setToggling(true);
    try {
      const res = await adminService.updateCoinSettings({ enabled: turningOn });
      setSettings(res?.data);
      setDraft((d) => ({ ...(d || {}), enabled: res?.data?.enabled, startsAt: res?.data?.startsAt }));
      toast.success(turningOn ? 'Rider coins are on' : 'Rider coins are off');
      loadSettings();
    } catch (error) {
      toast.error(errorText(error, 'Could not change the setting'));
    } finally {
      setToggling(false);
    }
  };

  const examples = draft ? [50, 150, 400].map((fare) => ({ fare, coins: coinsForFare(fare, draft) })) : [];

  if (!settings || !draft) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-gray-500">
        <Loader2 size={16} className="animate-spin" /> Loading rider coins…
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
            <span>Promotions</span> <ChevronRight size={12} /> <span className="text-gray-800">Rider Coins</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><Coins size={22} className="text-yellow-500" /> Rider Coins</h1>
          <p className="mt-1 text-sm text-gray-500">Riders earn coins for every completed ride.</p>
        </div>

        <button
          type="button"
          onClick={toggleEnabled}
          disabled={toggling}
          role="switch"
          aria-checked={Boolean(settings.enabled)}
          className={`inline-flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-60 ${
            settings.enabled ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${settings.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </span>
          {settings.enabled ? 'Coins are ON' : 'Coins are OFF'}
        </button>
      </div>

      {settings.enabled && settings.startsAt ? (
        <p className="text-xs text-gray-500">Rides completed since {formatDate(settings.startsAt)} earn coins. New rides are rewarded within about a minute.</p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Coins riders hold" value={summary?.coinsInCirculation ?? 0} />
        <StatCard label="Coins ever earned" value={summary?.coinsEverEarned ?? 0} />
        <StatCard label="Riders with coins" value={summary?.ridersWithCoins ?? 0} />
        <StatCard label="Earned in last 24h" value={summary?.earnedLast24h ?? 0} hint={`${summary?.ridesRewardedLast24h ?? 0} rides`} />
      </div>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">Earning rules</h2>
            <p className="text-sm text-gray-500">Changes apply to rides completed after you save.</p>
          </div>
          <button
            type="button"
            onClick={saveRules}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-sm font-bold text-black hover:bg-yellow-500 disabled:opacity-40"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save rules
          </button>
        </div>

        <div className="grid gap-5 p-5 md:grid-cols-2">
          {RULE_FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={`coin-rule-${field.key}`} className="mb-1 block text-sm font-semibold text-gray-800">{field.label}</label>
              <div className="flex items-center rounded-lg border border-gray-200 focus-within:border-yellow-400">
                {field.prefix ? <span className="pl-3 text-sm text-gray-500">{field.prefix}</span> : null}
                <input
                  id={`coin-rule-${field.key}`}
                  type="number"
                  min="0"
                  step={field.key === 'minFareForCoins' ? '1' : '1'}
                  value={draft[field.key] ?? 0}
                  onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                  className="w-full bg-transparent px-3 py-2 text-sm outline-none tabular-nums"
                />
                {field.suffix ? <span className="pr-3 text-sm text-gray-500">{field.suffix}</span> : null}
              </div>
              <p className="mt-1 text-xs text-gray-500">{field.help}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-100 bg-gray-50 px-5 py-3 text-sm text-gray-700">
          With these rules:{' '}
          {examples.map((ex, i) => (
            <span key={ex.fare}>
              a <strong>₹{ex.fare}</strong> ride earns <strong className="tabular-nums">{ex.coins}</strong> coins{i < examples.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-bold text-gray-900">Riders</h2>
          <div className="flex w-full max-w-xs items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 focus-within:border-yellow-400">
            <Search size={15} className="text-gray-400" />
            <input
              id="coin-rider-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name or phone"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-5 py-3">Rider</th>
                <th className="px-5 py-3">Phone</th>
                <th className="px-5 py-3 text-right">Balance</th>
                <th className="px-5 py-3 text-right">Earned from rides</th>
                <th className="px-5 py-3">Last earned</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {loadingRows ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-500"><Loader2 size={18} className="mx-auto animate-spin" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-500">
                  {search ? 'No rider matches that name or phone.' : 'No rider has coins yet. Search for a rider above to give them coins.'}
                </td></tr>
              ) : rows.map((row) => (
                <tr key={row.userId} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-5 py-3 font-semibold text-gray-900">{row.name}</td>
                  <td className="px-5 py-3 text-gray-600 tabular-nums">{row.phone || '—'}</td>
                  <td className="px-5 py-3 text-right font-bold text-gray-900 tabular-nums">{row.balance}</td>
                  <td className="px-5 py-3 text-right text-gray-600 tabular-nums">{row.totalEarned}</td>
                  <td className="px-5 py-3 text-gray-600">{formatDate(row.lastEarnedAt)}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setViewing(row)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                        <History size={14} /> History
                      </button>
                      <button type="button" onClick={() => setAdjusting(row)} className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-900">
                        Adjust
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-sm text-gray-500">
          <span>{paginator.total} rider{paginator.total === 1 ? '' : 's'}{search ? ' found' : ' with coins'}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold disabled:opacity-40">Previous</button>
            <span className="tabular-nums">{paginator.current_page} / {paginator.last_page}</span>
            <button type="button" disabled={page >= paginator.last_page} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold disabled:opacity-40">Next</button>
          </div>
        </div>
      </section>

      {adjusting ? (
        <AdjustModal
          rider={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={() => { setAdjusting(null); loadRows(); loadSettings(); }}
        />
      ) : null}
      {viewing ? <HistoryPanel rider={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
};

export default RiderCoins;
