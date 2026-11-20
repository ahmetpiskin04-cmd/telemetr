import { useCallback, useEffect, useState } from 'react';

/**
 * Asenkron veri yükler. Yeniden yüklemede eski veri ekranda kalır (titreme olmaz),
 * yalnızca status 'loading' olur. Bileşen değişirse geç gelen yanıt yok sayılır.
 */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    fn().then(
      (data) => alive && setState({ status: 'ready', data, error: null }),
      (error) => alive && setState((s) => ({ status: 'error', data: s.data, error })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
