import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const APP_CLOSE_EVENT = 'app-close-requested';

// The desktop shell holds the window open until the frontend says it is done (or ~2 s pass),
// then stops the backend gracefully. Outside the shell (browser, tests) this is a no-op.
export function onAppCloseRequested(beforeClose: () => Promise<void>): () => void {
  let stopped = false;
  let unlisten: (() => void) | null = null;
  listen(APP_CLOSE_EVENT, async () => {
    try {
      await beforeClose();
    } catch (err) {
      console.warn('No se pudo guardar antes de cerrar.', err);
    } finally {
      await invoke('close_ready').catch(() => undefined);
    }
  })
    .then(fn => {
      if (stopped) fn();
      else unlisten = fn;
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    unlisten?.();
  };
}
