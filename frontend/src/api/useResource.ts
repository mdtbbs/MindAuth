import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';

interface UseResourceResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  /** Re-run the fetcher imperatively (e.g. after a mutation). */
  reload: () => void;
}

interface UseResourceOptions {
  /** When false, the fetcher is not run and loading stays false. */
  enabled?: boolean;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Declarative data fetching over the `api` client.
 *
 * - Re-runs `fetcher` whenever `deps` change (same contract as useEffect deps).
 * - Aborts the in-flight request on dep change / unmount, so a slow earlier
 *   response can never overwrite a newer one (race-free).
 * - Swallows AbortError; real errors surface via `error`.
 *
 * The fetcher receives an AbortSignal — forward it to `api.get(path, { signal })`.
 */
export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  opts: UseResourceOptions = {},
): UseResourceResult<T> {
  const enabled = opts.enabled ?? true;
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);

  // Keep the latest fetcher without making it a dependency (it's a fresh
  // closure each render); `deps` is the source of truth for when to refetch.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);

    fetcherRef.current(controller.signal)
      .then((result) => {
        if (active) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!active || isAbort(err)) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, reloadTick, ...deps]);

  return { data, loading, error, reload };
}
