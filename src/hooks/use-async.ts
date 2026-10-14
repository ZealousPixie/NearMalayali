// Loads data when `fn` changes (pass a stable/memoised function), ignores
// results that arrive after unmount, and supports manual reload.
import { useCallback, useEffect, useState } from 'react';

export function useAsync<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    fn().then(
      (result) => {
        if (!active) return;
        setError(null);
        setData(result);
      },
      (e) => {
        if (active) setError(e);
      },
    );
    return () => {
      active = false;
    };
  }, [fn, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, reload, setData };
}
