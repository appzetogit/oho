import { useCallback, useEffect, useState } from 'react';
import api from '../api/axiosInstance';

/**
 * The cancellation reasons the admin has published for a given audience.
 *
 * The list is managed in the admin panel rather than hardcoded, so wording can
 * change without an app release. Cancelling must never be blocked by this
 * request, so a failure resolves to an empty list and the caller falls back to
 * a plain confirm — a rider stuck in a ride they want out of is a worse outcome
 * than a missing reason.
 */
export const useCancellationReasons = (audience = 'user', { enabled = true } = {}) => {
  const [reasons, setReasons] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await api.get('/users/cancellation-reasons', { params: { audience } });
      const rows = res?.data?.results || res?.results || [];
      setReasons(Array.isArray(rows) ? rows : []);
    } catch {
      setReasons([]);
    } finally {
      setLoading(false);
    }
  }, [audience, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  return { reasons, loading, reload: load };
};

export default useCancellationReasons;
