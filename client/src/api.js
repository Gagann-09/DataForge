import { useState, useEffect, useRef, useCallback } from 'react';

export async function fetchApi(endpoint, options = {}) {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `/api${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });

  if (!response.ok) {
    let payload = null;
    try { payload = await response.json(); } catch { /* ignore */ }
    const error = new Error(payload?.error?.message || `Request failed with HTTP ${response.status}`);
    error.code = payload?.error?.code || 'HTTP_ERROR';
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function usePolling(fetchFn, intervalMs = 5000, enabled = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const inFlightRef = useRef(false);
  const abortCtrlRef = useRef(null);
  const fetchFnRef = useRef(fetchFn);
  const requestIdRef = useRef(0);

  fetchFnRef.current = fetchFn;

  const execute = useCallback(async (isInitial = false) => {
    if (inFlightRef.current || !enabled || document.hidden) return;

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    abortCtrlRef.current = controller;
    inFlightRef.current = true;

    if (isInitial) setLoading(true);

    try {
      const result = await fetchFnRef.current(controller.signal);

      if (
        requestIdRef.current === requestId &&
        !controller.signal.aborted
      ) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (
        requestIdRef.current === requestId &&
        err.name !== 'AbortError'
      ) {
        setError(err);
      }
    } finally {
      if (requestIdRef.current === requestId) {
        inFlightRef.current = false;
        abortCtrlRef.current = null;

        setLoading(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    execute(true);

    const timer = setInterval(() => execute(false), intervalMs);

    const onVisible = () => {
      if (!document.hidden) execute(false);
    };

    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);

      // Invalidate the previous request before aborting it.
      requestIdRef.current += 1;
      inFlightRef.current = false;

      if (abortCtrlRef.current) {
        abortCtrlRef.current.abort();
        abortCtrlRef.current = null;
      }
    };
  }, [execute, intervalMs, enabled]);

  return { data, error, loading, refresh: () => execute(false) };
}