import React, { useEffect, useState } from 'react';
import { ChevronRight, Loader2, Save, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

/**
 * App Version: what the rider and driver apps check when they open.
 *   - Latest version: older apps see a "new version available" prompt they can skip.
 *   - Minimum version: older apps are blocked until they update (force update).
 *   - Store links: where "Update" sends people, and what Refer & Earn shares.
 */

const APPS = [
  { key: 'user', title: 'User (Rider) App' },
  { key: 'driver', title: 'Driver App' },
];

const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/;

const errorText = (error, fallback) => error?.response?.data?.message || error?.message || fallback;

const Field = ({ label, help, value, onChange, placeholder }) => (
  <label className="block">
    <span className="block text-[13px] font-semibold text-gray-800 mb-1">{label}</span>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
    />
    {help ? <span className="block text-[12px] text-gray-500 mt-1">{help}</span> : null}
  </label>
);

const AppCard = ({ app, initial }) => {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    for (const key of ['latestVersion', 'minVersion']) {
      const value = String(draft[key] || '').trim();
      if (value && !VERSION_PATTERN.test(value)) {
        toast.error(`${key === 'minVersion' ? 'Minimum' : 'Latest'} version must look like 7.3.4`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await adminService.updateAppVersion(app.key, {
        latestVersion: draft.latestVersion,
        minVersion: draft.minVersion,
        androidStoreUrl: draft.androidStoreUrl,
        iosStoreUrl: draft.iosStoreUrl,
        updateMessage: draft.updateMessage,
      });
      setDraft(res?.data || draft);
      toast.success(`${app.title} saved`);
    } catch (error) {
      toast.error(errorText(error, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-[22px] border border-gray-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Smartphone size={18} className="text-[#2D3A6E]" />
        <h2 className="text-[15px] font-bold text-gray-900">{app.title}</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          label="Latest version"
          placeholder="e.g. 7.3.5"
          value={draft.latestVersion || ''}
          onChange={set('latestVersion')}
          help="Apps older than this see a 'new version available' prompt they can skip."
        />
        <Field
          label="Minimum version (force update)"
          placeholder="Leave empty for no force update"
          value={draft.minVersion || ''}
          onChange={set('minVersion')}
          help="Apps older than this cannot be used until updated. Leave empty to turn off."
        />
        <Field
          label="Play Store link"
          placeholder="https://play.google.com/store/apps/details?id=..."
          value={draft.androidStoreUrl || ''}
          onChange={set('androidStoreUrl')}
          help="Used by the Update button and shared by Refer & Earn."
        />
        <Field
          label="App Store link (iPhone)"
          placeholder="https://apps.apple.com/app/..."
          value={draft.iosStoreUrl || ''}
          onChange={set('iosStoreUrl')}
          help="Optional. When set, Refer & Earn shares it too."
        />
      </div>
      <Field
        label="Update message"
        placeholder="We've made rides faster and fixed some bugs."
        value={draft.updateMessage || ''}
        onChange={set('updateMessage')}
        help="Shown on the update prompt. Optional."
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-10 px-6 bg-[#2D3A6E] text-white rounded-lg text-[13px] font-bold hover:bg-[#1d2756] inline-flex items-center gap-2 disabled:opacity-60"
        >
          {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          Save
        </button>
      </div>
    </div>
  );
};

const AppVersionSettings = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminService
      .getAppVersions()
      .then((res) => setData(res?.data || null))
      .catch((error) => toast.error(errorText(error, 'Could not load app versions')))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 p-1 pb-20 font-sans text-gray-950">
      <div>
        <h1 className="text-[17px] font-black text-[#2D3A6E] uppercase tracking-tight italic leading-none mb-1">App Version</h1>
        <div className="flex items-center gap-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest leading-none">
          <span>Settings</span>
          <ChevronRight size={12} className="opacity-50" />
          <span className="text-gray-900">App Version</span>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="animate-spin" size={16} /> Loading…</div>
      ) : data ? (
        APPS.map((app) => <AppCard key={app.key} app={app} initial={data[app.key] || {}} />)
      ) : (
        <p className="text-sm text-gray-500">App versions are not available right now.</p>
      )}
    </div>
  );
};

export default AppVersionSettings;
