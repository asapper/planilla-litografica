import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTasStore } from './tasStore';
import { useToastStore } from './toastStore';
import { saveDraftNow } from './tasDraft';

export const APP_CLOSE_EVENT = 'app-close-requested';
export const APP_CLOSE_BLOCKED_EVENT = 'app-close-blocked';
export const CLOSE_BLOCKED_MESSAGE = 'Hay un envío en curso. Espere a que termine para cerrar la aplicación.';
export const CLOSE_UNSAVED_MESSAGE =
  'No se pudo confirmar que el avance se guardó. Si vuelve a cerrar la aplicación en los próximos 30 segundos, se cerrará de todos modos y podría perder los últimos cambios.';
export const CLOSE_ANYWAY_WINDOW_MS = 30_000;
// The shell closes anyway when the frontend hasn't answered within FRONTEND_SAVE_WAIT (2 s, lib.rs), so
// a save that hangs must count as failed before then, or the app closes without the refusal.
export const CLOSE_SAVE_TIMEOUT_MS = 1_500;

function saveWithinCloseWait(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>(resolve => {
    timer = setTimeout(() => resolve(false), CLOSE_SAVE_TIMEOUT_MS);
  });
  return Promise.race([saveDraftNow(), timeout]).finally(() => clearTimeout(timer));
}

// After a refused close, a second close within the window goes ahead: the user was told what is lost.
let closeAnywayUntil = 0;

function showCloseBlocked() {
  useToastStore.getState().showToast(CLOSE_BLOCKED_MESSAGE, 'error');
}

// Closing mid-submission would cut the payroll batch off half-sent: refuse, otherwise save; if the
// save fails, refuse once so the user isn't told "no cierre" while the app closes anyway.
export async function prepareToClose(): Promise<boolean> {
  const view = useTasStore.getState().tasView;
  if (view === 'submitting' || view === 'polling') {
    showCloseBlocked();
    return false;
  }
  if (await saveWithinCloseWait() || Date.now() < closeAnywayUntil) return true;
  closeAnywayUntil = Date.now() + CLOSE_ANYWAY_WINDOW_MS;
  // Up for as long as a second close goes ahead, which is as long as what it says holds.
  useToastStore.getState().showToast(CLOSE_UNSAVED_MESSAGE, 'error', { durationMs: CLOSE_ANYWAY_WINDOW_MS });
  return false;
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
  register(listen<number>(APP_CLOSE_EVENT, async event => {
    let proceed = true;
    try {
      proceed = await prepare();
    } catch (err) {
      console.warn('No se pudo guardar antes de cerrar.', err);
    } finally {
      await invoke('close_ready', { attempt: event.payload, proceed }).catch(() => undefined);
    }
  }));
  register(listen(APP_CLOSE_BLOCKED_EVENT, showCloseBlocked));
  return () => {
    stopped = true;
    unlisteners.forEach(fn => fn());
  };
}
