import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Ana süreçteki veri güncellemesinin durumu. Güncelleme otomatik (zamanlayıcı) veya elle
 * başlayabilir; her iki durumda da olaylar buraya gelir. Bitince onFinished çağrılır.
 */
export function useSync(onFinished) {
  const [state, setState] = useState({ running: false, last: null, progress: null, error: null });
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  useEffect(() => {
    api
      .syncStatus()
      .then((s) => setState((p) => ({ ...p, running: s.running, last: s.last })))
      .catch(() => {});
    return api.onSyncEvent((e) => {
      if (e.type === 'started') setState((p) => ({ ...p, running: true, progress: null, error: null }));
      else if (e.type === 'log') setState((p) => ({ ...p, progress: e.message }));
      else if (e.type === 'finished') {
        setState((p) => ({ ...p, running: false, progress: null, last: e.run }));
        finishedRef.current?.();
      } else if (e.type === 'failed') setState((p) => ({ ...p, running: false, progress: null, error: e.error }));
    });
  }, []);

  const run = useCallback(() => {
    api.runSync().catch((err) => setState((p) => ({ ...p, running: false, error: err.message })));
  }, []);

  return { ...state, run };
}
