import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

/**
 * A date range picker: quick presets beside a month calendar.
 *
 *   <DateRangePicker from="2026-10-01" to="2026-10-27" onChange={({ from, to }) => …} />
 *
 * Values are plain 'YYYY-MM-DD' strings ('' = no limit on that side), the same
 * shape a native date input gives, so it drops in where one was used. Days are
 * taken in the browser's own time zone — the admins are in India.
 *
 * Click a day to start a range, a second day to end it (either order works),
 * or pick a preset. Future days can't be chosen.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const pad = (n) => String(n).padStart(2, '0');
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const label = (k) => {
  const d = fromKey(k);
  return `${d.getDate()} ${MONTHS.at(d.getMonth()).slice(0, 3)} ${d.getFullYear()}`;
};

const presets = () => {
  const today = new Date();
  const t = toKey(today);
  const firstThis = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstLast = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endLast = new Date(today.getFullYear(), today.getMonth(), 0);
  return [
    { id: 'today', name: 'Today', from: t, to: t },
    { id: 'yesterday', name: 'Yesterday', from: toKey(addDays(today, -1)), to: toKey(addDays(today, -1)) },
    { id: 'last7', name: 'Last 7 days', from: toKey(addDays(today, -6)), to: t },
    { id: 'last30', name: 'Last 30 days', from: toKey(addDays(today, -29)), to: t },
    { id: 'thisMonth', name: 'This month', from: toKey(firstThis), to: t },
    { id: 'lastMonth', name: 'Last month', from: toKey(firstLast), to: toKey(endLast) },
    { id: 'all', name: 'All time', from: '', to: '' },
  ];
};

const DateRangePicker = ({ from = '', to = '', onChange, id = 'date-range', placeholder = 'All time' }) => {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(''); // first click of a custom range
  const [hover, setHover] = useState('');
  const [view, setView] = useState(() => {
    const base = to ? fromKey(to) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const ref = useRef(null);

  // Close on a click outside or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const todayKey = toKey(new Date());
  // Recomputed each time it opens, so "Today" stays right on a page left open overnight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const presetList = useMemo(() => presets(), [open]);
  const activePreset = presetList.find((p) => p.from === from && p.to === to);

  const shown = !from && !to
    ? placeholder
    : activePreset && activePreset.id !== 'all'
      ? `${activePreset.name} · ${from === to ? label(from) : `${label(from)} – ${label(to)}`}`
      : from === to
        ? label(from)
        : `${from ? label(from) : 'Start'} – ${to ? label(to) : 'today'}`;

  const choose = (range) => {
    onChange?.(range);
    setAnchor('');
    setHover('');
    setOpen(false);
  };

  const clickDay = (key) => {
    if (!anchor) {
      setAnchor(key);
      return;
    }
    const [a, b] = anchor <= key ? [anchor, key] : [key, anchor];
    choose({ from: a, to: b });
  };

  // Cells for the month in view, Monday first.
  const days = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const count = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    return [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: count }, (_, i) => toKey(new Date(view.getFullYear(), view.getMonth(), i + 1))),
    ];
  }, [view]);

  // While choosing, preview the range under the pointer; otherwise show the value.
  const lo = anchor ? (hover && hover < anchor ? hover : anchor) : from;
  const hi = anchor ? (hover && hover > anchor ? hover : anchor) : to;
  const nextMonthDisabled = new Date(view.getFullYear(), view.getMonth() + 1, 1) > new Date();

  return (
    <div className="relative" ref={ref}>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm outline-none hover:bg-gray-50 focus-visible:border-yellow-400"
      >
        <CalendarDays size={16} className="shrink-0 text-gray-500" />
        <span className={`flex-1 truncate ${from || to ? 'text-gray-900' : 'text-gray-500'}`}>{shown}</span>
        {from || to ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear dates"
            onClick={(e) => { e.stopPropagation(); onChange?.({ from: '', to: '' }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange?.({ from: '', to: '' }); } }}
            className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          >
            <X size={14} />
          </span>
        ) : null}
      </button>

      {open ? (
        <div role="dialog" aria-label="Choose dates" className="absolute left-0 z-50 mt-2 flex w-[min(29rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl sm:flex-row">
          <div className="flex gap-1 overflow-x-auto border-b border-gray-100 p-2 sm:w-40 sm:flex-col sm:border-b-0 sm:border-r">
            {presetList.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => choose({ from: p.from, to: p.to })}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-left text-xs font-semibold transition-colors ${
                  activePreset?.id === p.id ? 'bg-yellow-400 text-black' : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          <div className="flex-1 p-3">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Previous month">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-bold text-gray-900">{MONTHS.at(view.getMonth())} {view.getFullYear()}</span>
              <button type="button" disabled={nextMonthDisabled} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-white" aria-label="Next month">
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-1 text-center">
              {WEEKDAYS.map((w) => <span key={w} className="py-1 text-[11px] font-semibold text-gray-400">{w}</span>)}
              {days.map((key, i) => {
                if (!key) return <span key={`blank-${i}`} />;
                const future = key > todayKey;
                const isEnd = key === lo || key === hi;
                const inRange = lo && hi && key > lo && key < hi;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={future}
                    onClick={() => clickDay(key)}
                    onMouseEnter={() => anchor && setHover(key)}
                    aria-label={label(key)}
                    aria-pressed={isEnd}
                    className={`mx-auto h-8 w-full text-xs tabular-nums transition-colors disabled:cursor-not-allowed disabled:text-gray-300 ${
                      isEnd
                        ? 'rounded-lg bg-black font-bold text-white'
                        : inRange
                          ? 'bg-yellow-100 text-gray-900'
                          : `rounded-lg text-gray-700 hover:bg-gray-100 ${key === todayKey ? 'font-bold underline' : ''}`
                    }`}
                  >
                    {Number(key.slice(8))}
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-[11px] text-gray-500">
              {anchor ? `From ${label(anchor)} — now pick the end date.` : 'Pick a start date, then an end date.'}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DateRangePicker;
