import { useEffect, useState } from 'react';

export function useApiData(fetcher, fallback = null) {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result = await fetcher();
        if (!cancelled) {
          setData(result);
          setLive(true);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          setLive(false);
          if (fallback) setData(fallback);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tick]);

  return {
    data,
    loading,
    live,
    error,
    reload: () => setTick((t) => t + 1),
  };
}
