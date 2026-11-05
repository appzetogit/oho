import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeIndianRupee, ChevronRight, Loader2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

/**
 * Company ride incentive: the company adds money to the driver's wallet for each
 * completed ride, so riders can be charged less without drivers earning less.
 * The amounts here never change what a rider pays; that's set in Set Prices.
 */

const inputClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500';
const labelClass = 'mb-1 block text-xs font-semibold text-gray-700';

const emptyRate = (vehicleTypeId) => ({ vehicleTypeId, amount_per_ride: 0, amount_per_km: 0, max_per_ride: 0 });

// Same sums as the server, so the example always matches what gets paid.
const amountFor = (rate, km) => {
  const raw = Number(rate.amount_per_ride || 0) + Number(rate.amount_per_km || 0) * km;
  const cap = Number(rate.max_per_ride || 0);
  return Math.round((cap > 0 ? Math.min(raw, cap) : raw) * 100) / 100;
};

const RideIncentive = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState(null);
  const [payouts, setPayouts] = useState(null);
  const [exampleFare, setExampleFare] = useState(50);
  const [exampleKm, setExampleKm] = useState(3);

  const applyView = useCallback((view) => {
    const settings = view?.settings || {};
    const list = view?.vehicles || [];
    setVehicles(list);
    setForm({
      enabled: Boolean(settings.enabled),
      rates: list.map((vehicle) => ({
        ...emptyRate(vehicle.id),
        ...(settings.rates || []).find((rate) => rate.vehicleTypeId === vehicle.id),
      })),
      max_rides_per_driver_per_day: settings.max_rides_per_driver_per_day ?? 10,
      min_distance_km: settings.min_distance_km ?? 1,
      only_driver_phones: (settings.only_driver_phones || []).join(', '),
    });
  }, []);

  const loadPayouts = useCallback(async () => {
    try {
      const res = await adminService.getRideIncentivePayouts(30);
      setPayouts(res.data || null);
    } catch (err) {
      console.error('Incentive payments fetch error:', err);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await adminService.getRideIncentiveSettings();
        applyView(res.data);
      } catch (err) {
        console.error('Incentive settings fetch error:', err);
        toast.error('Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
    loadPayouts();
  }, [applyView, loadPayouts]);

  const updateRate = (vehicleTypeId, field, value) => {
    setForm((current) => ({
      ...current,
      rates: current.rates.map((rate) => (rate.vehicleTypeId === vehicleTypeId ? { ...rate, [field]: value } : rate)),
    }));
  };

  const save = async (nextEnabled) => {
    setSaving(true);
    try {
      const res = await adminService.updateRideIncentiveSettings({
        ...form,
        enabled: nextEnabled,
        rates: form.rates.map((rate) => ({
          ...rate,
          amount_per_ride: Number(rate.amount_per_ride || 0),
          amount_per_km: Number(rate.amount_per_km || 0),
          max_per_ride: Number(rate.max_per_ride || 0),
        })),
        max_rides_per_driver_per_day: Number(form.max_rides_per_driver_per_day || 0),
        min_distance_km: Number(form.min_distance_km || 0),
      });
      applyView({ settings: res.data, vehicles });
      toast.success(nextEnabled === form.enabled ? 'Saved' : nextEnabled ? 'Incentive is now ON' : 'Incentive is now OFF');
    } catch (err) {
      // The server says exactly what's wrong, e.g. an invalid phone number.
      toast.error(err?.response?.data?.message || err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const examples = useMemo(() => (form?.rates || [])
    .map((rate) => ({
      name: vehicles.find((vehicle) => vehicle.id === rate.vehicleTypeId)?.name || '',
      amount: amountFor(rate, Number(exampleKm || 0)),
    }))
    .filter((item) => item.amount > 0), [form, vehicles, exampleKm]);

  if (loading || !form) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        {loading ? <Loader2 className="animate-spin text-yellow-600" size={32} /> : <p className="text-sm text-gray-500">Could not load the settings.</p>}
      </div>
    );
  }

  const fare = Number(exampleFare || 0);
  const summary = payouts?.summary || {};

  return (
    <div className="space-y-6 p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
            <span>Promotions</span> <ChevronRight size={12} /> <span className="text-gray-800">Ride Incentive</span>
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><BadgeIndianRupee size={22} className="text-yellow-600" /> Ride Incentive</h1>
          <p className="mt-1 text-sm text-gray-500">The company adds this to the driver's wallet for each completed ride. It doesn't change what the rider pays; set that in Set Prices.</p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => save(!form.enabled)}
          className={`rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-50 ${form.enabled ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
        >
          {form.enabled ? 'Switch OFF' : 'Switch ON'}
        </button>
      </div>

      <p className={`rounded-lg border px-4 py-3 text-sm font-medium ${form.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-700'}`}>
        {form.enabled
          ? 'ON: rides completed from now on earn the incentive.'
          : 'OFF: nothing is being paid. Rides completed while it is off never earn it later.'}
      </p>

      <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-5">
        <h2 className="text-sm font-bold text-gray-900">Amount by vehicle</h2>
        <div className="space-y-4">
          {form.rates.map((rate) => (
            <div key={rate.vehicleTypeId} className="grid grid-cols-1 gap-3 border-b border-gray-100 pb-4 last:border-0 last:pb-0 md:grid-cols-4 md:items-end">
              <p className="text-sm font-bold text-gray-900 md:pb-2">{vehicles.find((vehicle) => vehicle.id === rate.vehicleTypeId)?.name}</p>
              <div>
                <label className={labelClass} htmlFor={`ride-${rate.vehicleTypeId}`}>₹ per ride</label>
                <input id={`ride-${rate.vehicleTypeId}`} type="number" min="0" value={rate.amount_per_ride} onChange={(e) => updateRate(rate.vehicleTypeId, 'amount_per_ride', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor={`km-${rate.vehicleTypeId}`}>₹ per km</label>
                <input id={`km-${rate.vehicleTypeId}`} type="number" min="0" value={rate.amount_per_km} onChange={(e) => updateRate(rate.vehicleTypeId, 'amount_per_km', e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor={`max-${rate.vehicleTypeId}`}>Most from one ride (0 = no limit)</label>
                <input id={`max-${rate.vehicleTypeId}`} type="number" min="0" value={rate.max_per_ride} onChange={(e) => updateRate(rate.vehicleTypeId, 'max_per_ride', e.target.value)} className={inputClass} />
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-yellow-100 bg-yellow-50 p-4">
          <p className="text-xs font-bold text-gray-900">Try an example</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-700">
            <span>Rider pays ₹</span>
            <input aria-label="Example fare" type="number" min="0" value={exampleFare} onChange={(e) => setExampleFare(e.target.value)} className="w-20 rounded border border-gray-200 bg-white px-2 py-1" />
            <span>for</span>
            <input aria-label="Example distance in km" type="number" min="0" value={exampleKm} onChange={(e) => setExampleKm(e.target.value)} className="w-16 rounded border border-gray-200 bg-white px-2 py-1" />
            <span>km</span>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-gray-800">
            {examples.length ? examples.map((item) => (
              <li key={item.name}>{item.name}: company adds ₹{item.amount}, so the driver gets ₹{Math.round((fare + item.amount) * 100) / 100} before commission.</li>
            )) : <li>Set an amount above to see what the driver would get.</li>}
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
        <h2 className="text-sm font-bold text-gray-900">Limits</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="daily-limit">Rides paid per driver per day</label>
            <input id="daily-limit" type="number" min="0" value={form.max_rides_per_driver_per_day} onChange={(e) => setForm({ ...form, max_rides_per_driver_per_day: e.target.value })} className={inputClass} />
            <p className="mt-1 text-[11px] text-gray-500">0 = no limit.</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="min-distance">Minimum trip distance (km)</label>
            <input id="min-distance" type="number" min="0" step="0.1" value={form.min_distance_km} onChange={(e) => setForm({ ...form, min_distance_km: e.target.value })} className={inputClass} />
            <p className="mt-1 text-[11px] text-gray-500">Shorter trips earn nothing, which makes fake rides harder. 0 = no minimum.</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="only-drivers">Only these drivers (optional)</label>
            <input id="only-drivers" type="text" value={form.only_driver_phones} onChange={(e) => setForm({ ...form, only_driver_phones: e.target.value })} placeholder="9876543210, 9876543211" className={inputClass} />
            <p className="mt-1 text-[11px] text-gray-500">Use this to test with one driver. Empty = all approved drivers.</p>
          </div>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => save(form.enabled)}
          className="inline-flex items-center gap-2 rounded-lg bg-yellow-400 px-5 py-2.5 text-sm font-bold text-black hover:bg-yellow-500 disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
        </button>
      </section>

      {payouts ? (
        <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
          <h2 className="text-sm font-bold text-gray-900">Payments</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500">Today</p>
              <p className="mt-1 text-lg font-bold text-gray-900">₹{summary.todayAmount || 0}</p>
              <p className="text-xs text-gray-500">{summary.todayCount || 0} rides</p>
            </div>
            <div className="rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500">This month</p>
              <p className="mt-1 text-lg font-bold text-gray-900">₹{summary.monthAmount || 0}</p>
              <p className="text-xs text-gray-500">{summary.monthCount || 0} rides</p>
            </div>
            <div className={`rounded-xl border p-4 ${summary.needsChecking ? 'border-rose-200 bg-rose-50' : 'border-gray-200'}`}>
              <p className="text-xs text-gray-500">Needs checking</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{summary.needsChecking || 0}</p>
              <p className="text-xs text-gray-500">Not retried by itself. Check the driver's wallet before paying by hand.</p>
            </div>
          </div>

          {payouts.results?.length ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Driver</th>
                    <th className="px-4 py-2 font-semibold">Vehicle</th>
                    <th className="px-4 py-2 font-semibold">Day</th>
                    <th className="px-4 py-2 font-semibold">Fare</th>
                    <th className="px-4 py-2 font-semibold">Distance</th>
                    <th className="px-4 py-2 font-semibold">Incentive</th>
                    <th className="px-4 py-2 font-semibold">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payouts.results.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-2 text-gray-900">{row.driverName || 'Unknown'} <span className="text-gray-500">{row.driverPhone}</span></td>
                      <td className="px-4 py-2 text-gray-700">{row.vehicle}</td>
                      <td className="px-4 py-2 tabular-nums text-gray-700">{row.day}</td>
                      <td className="px-4 py-2 tabular-nums text-gray-700">₹{row.fare}</td>
                      <td className="px-4 py-2 tabular-nums text-gray-700">{row.distanceKm} km</td>
                      <td className="px-4 py-2 tabular-nums font-semibold text-gray-900">₹{row.amount}</td>
                      <td className={`px-4 py-2 font-semibold ${row.status === 'paid' ? 'text-emerald-700' : row.status === 'skipped' ? 'text-gray-500' : 'text-rose-600'}`}>
                        {row.status === 'skipped' ? `Not paid: ${row.reason}` : row.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-gray-500">No rides have been processed yet.</p>
          )}
        </section>
      ) : null}
    </div>
  );
};

export default RideIncentive;
