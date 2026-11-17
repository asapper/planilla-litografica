import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTasStore } from './tasStore';
import { useToastStore } from './toastStore';
import { saveDraftNow } from './tasDraft';

export const APP_CLOSE_EVENT = 'app-close-requested';
export const APP_CLOSE_BLOCKED_EVENT = 'app-close-blocked';
export const CLOSE_BLOCKED_MESSAGE = 'Hay un envío en curso. Espere a que termine para cerrar la aplicación.';

function showCloseBlocked() {
  useToastStore.getState().showToast(CLOSE_BLOCKED_MESSAGE, 'error');
}

// Closing mid-submission would cut the payroll batch off half-sent: refuse, otherwise save.
export async function prepareToClose(): Promise<boolean> {
  const view = useTasStore.getState().tasView;
  if (view === 'submitting' || view === 'polling') {
    showCloseBlocked();
    return false;
  }
  await saveDraftNow();
  return true;
}

// The desktop shell hides the window and waits for the answer (or ~2 s), then stops the backend
// gracefully; a refusal brings the window back. Outside the shell (browser, tests) this is a no-op.
export function onAppCloseRequested(prepare: () => Promise<boolean>): () => void {
  let stopped = false;
  const unlisteners: (() => void)[] = [];
  const register = (promise: Promise<() => void>) => {
    promise
      .then(fn => {
        if (stopped) fn();
        else unlisteners.push(fn);
      })
      .catch(() => undefined);
  };
  register(listen(APP_CLOSE_EVENT, async () => {
    let proceed = true;
    try {
      proceed = await prepare();
    } catch (err) {
      console.warn('No se pudo guardar antes de cerrar.', err);
    } finally {
      await invoke('close_ready', { proceed }).catch(() => undefined);
    }
  }));
  register(listen(APP_CLOSE_BLOCKED_EVENT, showCloseBlocked));
  return () => {
    stopped = true;
    unlisteners.forEach(fn => fn());
  };
}
