import axios from 'axios';
import { useTasStore, tasInitialState, type TasStore } from './tasStore';
import { saveDraft, deleteDraft } from './tasApi';
import { useToastStore } from './toastStore';
import { DRAFT_UI_VERSION } from './draftVersion';
import { clearLocalCopy, saveLocalSnapshot, setLocalCopySubmitted } from './localCopy';
import { MONTH_NAMES_ES } from './dateNames';
import type { DraftSummary, DraftView, TasPeriod, TasView } from './tasTypes';

export const DRAFT_SAVE_DEBOUNCE_MS = 500;
export const DRAFT_SAVE_MAX_WAIT_MS = 3000;
// A failed save is retried on its own: the user may have walked away and make no further edit.
export const DRAFT_SAVE_RETRY_MS = 15_000;
export const DRAFT_SAVE_FAILED_MESSAGE =
  'No se pudo guardar el avance. Se reintentará automáticamente; mientras tanto, no cierre la aplicación.';
export const DRAFT_SAVE_RECOVERED_MESSAGE = 'El avance se guardó nuevamente.';

const SAVABLE_VIEWS: ReadonlySet<TasView> = new Set<TasView>(['inactiveReview', 'verification', 'review']);

export const PERSISTED_KEYS = [
  'tasView',
  'uploadToken',
  'stateRevision',
  'resolvedSessions',
  'cardInputs',
  'shiftAcceptances',
  'sameDayDoubleResolutions',
  'selectedPeriod',
  'inactiveDecisions',
  'overtimeDecisions',
  'stashedOvertimeDecisions',
  'nonWorkedDaysOverrides',
  'stashedNonWorkedDaysOverrides',
  'fallbackBannerDismissed',
  'flaggedSessions',
  'resolvedRows',
  'resolvedRowCount',
  'availablePeriods',
  'availableShifts',
  'sessionSummaries',
  'inactiveEmployees',
  'absentEmployees',
  'warnings',
  'usedFallbackHolidays',
] as const satisfies readonly (keyof TasStore)[];

type PersistedKey = (typeof PERSISTED_KEYS)[number];
export type TasSnapshot = Pick<TasStore, PersistedKey>;

export function isDraftView(view: unknown): view is DraftView {
  return typeof view === 'string' && SAVABLE_VIEWS.has(view as TasView);
}

export function canResume(draft: DraftSummary): boolean {
  return draft.resumable && draft.uiVersion === DRAFT_UI_VERSION;
}

export function toSnapshot(state: TasStore): TasSnapshot {
  const snapshot = {} as Record<PersistedKey, unknown>;
  for (const key of PERSISTED_KEYS) snapshot[key] = state[key];
  return snapshot as TasSnapshot;
}

// One setState from the initial state: calling setAvailablePeriods first would re-select
// periods[0] and clobber the saved selectedPeriod, and starting from the initial state
// clears everything that is not persisted (jobId, review selection, ...).
export function applySnapshot(snapshot: Record<string, unknown>): void {
  const picked: Record<string, unknown> = {};
  for (const key of PERSISTED_KEYS) {
    if (key in snapshot) picked[key] = snapshot[key];
  }
  useTasStore.setState({ ...tasInitialState, ...picked } as Partial<TasStore>);
}

export function formatPeriodLabel(period: TasPeriod | null): string | null {
  if (!period) return null;
  const month = MONTH_NAMES_ES[period.mes] ?? '';
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${period.anio} - Quincena ${period.numeroDequincena}`;
}

// No re-sync on purpose: adopting the server's revision without its data would pair this UI
// snapshot with a backend state it doesn't match. The next mutating response carries the
// revision and saves resume; a lasting drift shows up here.
function warnStale(localRevision: number, serverRevision: unknown) {
  if (typeof serverRevision === 'number') {
    console.warn(`Guardado de la sesión rechazado: revisión local ${localRevision}, del servidor ${serverRevision}.`);
  } else {
    console.warn('Guardado de la sesión rechazado: el servidor ya no tiene esta sesión.');
  }
}

// What the copy on this PC keeps for a session in progress, or null outside one.
export function localSnapshotOf(state: TasStore): Record<string, unknown> | null {
  return isSavable(state) ? { ...toSnapshot(state), uiVersion: DRAFT_UI_VERSION } : null;
}

function isSubmission(view: TasView): boolean {
  return view === 'submitting' || view === 'polling';
}

function isSavable(state: TasStore): boolean {
  return SAVABLE_VIEWS.has(state.tasView) && !!state.uploadToken;
}

function persistedChanged(state: TasStore, prev: TasStore): boolean {
  return PERSISTED_KEYS.some(key => state[key] !== prev[key]);
}

let getFileName: () => string = () => '';
let timer: ReturnType<typeof setTimeout> | null = null;
let burstStartedAt: number | null = null;
let inflight: Promise<void> | null = null;
let queued = false;
let queuedState: TasStore | null = null;
let suspended = false;
let failing = false;
// The failure warning stays up while saving fails, and comes down once that run of failures ends.
let failureToastId: number | null = null;
let active = false;
// The state whose save failed, kept so a retry can still send it after the view moved on
// (review -> submitting). An edit replaces it; going back to idle drops it.
let retryState: TasStore | null = null;

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  burstStartedAt = null;
}

// Debounced, but a steady stream of edits still saves at least every DRAFT_SAVE_MAX_WAIT_MS:
// a crash or a forced close can happen at any moment.
function schedule() {
  const now = Date.now();
  burstStartedAt ??= now;
  if (timer !== null) clearTimeout(timer);
  const untilMaxWait = DRAFT_SAVE_MAX_WAIT_MS - (now - burstStartedAt);
  timer = setTimeout(() => flush(), Math.max(0, Math.min(DRAFT_SAVE_DEBOUNCE_MS, untilMaxWait)));
}

// One warning per run of failures, and one notice once saving works again.
function reportFailure() {
  if (failing) return;
  failing = true;
  failureToastId = useToastStore.getState().showToast(DRAFT_SAVE_FAILED_MESSAGE, 'warning', { durationMs: null });
}

function dismissFailureToast() {
  if (failureToastId !== null) useToastStore.getState().dismissToast(failureToastId);
  failureToastId = null;
}

function reportSaved() {
  if (!failing) return;
  failing = false;
  dismissFailureToast();
  useToastStore.getState().showToast(DRAFT_SAVE_RECOVERED_MESSAGE, 'success');
}

// Retries stop without a save (stale revision, discard, stop, back to idle): end the run quietly,
// so a later good save does not announce a recovery that never happened.
function endFailureRun() {
  failing = false;
  retryState = null;
  dismissFailureToast();
}

function retryLater(failed: TasStore) {
  if (timer !== null || suspended || !active) return;
  retryState = failed;
  timer = setTimeout(() => flush(), DRAFT_SAVE_RETRY_MS);
}

// The copy on this PC needs no network: it is written as soon as a save is due, even while an
// earlier backend save is still in flight, and is what is left if the backend fails.
function writeLocal(state: TasStore) {
  const snapshot = localSnapshotOf(state);
  if (snapshot) saveLocalSnapshot(snapshot);
}

function send(state: TasStore): Promise<void> {
  return saveDraft({
    uploadToken: state.uploadToken as string,
    stateRevision: state.stateRevision,
    fileName: getFileName() || null,
    view: state.tasView as DraftView,
    periodLabel: formatPeriodLabel(state.selectedPeriod),
    ui: { ...toSnapshot(state), uiVersion: DRAFT_UI_VERSION },
  }).then(reportSaved, err => {
    if (axios.isAxiosError(err) && err.response?.status === 409) {
      warnStale(state.stateRevision, err.response.data?.currentRevision);
      endFailureRun();
      return;
    }
    console.warn('No se pudo guardar la sesión en curso.', err);
    reportFailure();
    retryLater(state);
  });
}

// The page is going away, so a save queued behind an in-flight one would never run:
// send the latest state now. The backend's revision check keeps an out-of-order pair consistent.
function saveBeforeClose() {
  if (timer === null || suspended) return;
  if (!inflight) {
    flush();
    return;
  }
  clearTimer();
  const state = useTasStore.getState();
  if (isSavable(state)) {
    writeLocal(state);
    void send(state);
  }
}

function flush(explicitState?: TasStore) {
  clearTimer();
  if (suspended) return;
  const current = useTasStore.getState();
  const state = explicitState
    ?? (retryState && !isSavable(current) && current.tasView !== 'idle' ? retryState : current);
  writeLocal(state);
  if (inflight) {
    queued = true;
    if (explicitState) queuedState = explicitState;
    return;
  }
  retryState = null;
  if (!isSavable(state)) {
    endFailureRun();
    return;
  }
  inflight = send(state)
    .finally(() => {
      inflight = null;
      if (queued) {
        const next = queuedState ?? undefined;
        queued = false;
        queuedState = null;
        flush(next);
      }
    });
}

// The app is closing: send what is pending and wait until the backend has it. False when the
// last save failed, so closing now would lose work.
export async function saveDraftNow(): Promise<boolean> {
  if (timer !== null && !suspended) flush();
  while (inflight) await inflight;
  return !failing;
}

export function startDraftAutosave(fileNameGetter: () => string): () => void {
  getFileName = fileNameGetter;
  active = true;
  endFailureRun();
  const unsubscribe = useTasStore.subscribe((state, prev) => {
    if (suspended) return;
    if (isSubmission(state.tasView) && !isSubmission(prev.tasView)) {
      // Pending edits go out first; after that the backend owns the session.
      if (timer !== null && isSavable(prev)) flush(prev);
      setLocalCopySubmitted(true);
      return;
    }
    // The submit request failed before any job started: the session is back in the user's hands.
    if (prev.tasView === 'submitting' && state.tasView === 'review') setLocalCopySubmitted(false);
    if (isSavable(state)) {
      if (!persistedChanged(state, prev)) return;
      schedule();
      return;
    }
    // Leaving review for submitting must not drop edits made in the last debounce window.
    // Going back to idle (a discarded session) must drop them.
    if (timer !== null && isSavable(prev) && state.tasView !== 'idle') {
      flush(prev);
      return;
    }
    clearTimer();
    if (state.tasView === 'idle') {
      endFailureRun();
      // Leaving a session ends its local copy; a failed upload or recovery (from processing) keeps it.
      if (prev.tasView !== 'idle' && prev.tasView !== 'processing') clearLocalCopy();
    }
  });
  window.addEventListener('pagehide', saveBeforeClose);
  return () => {
    active = false;
    unsubscribe();
    window.removeEventListener('pagehide', saveBeforeClose);
    clearTimer();
    endFailureRun();
  };
}

export async function discardDraftSession(): Promise<void> {
  suspended = true;
  endFailureRun();
  clearLocalCopy();
  clearTimer();
  queued = false;
  queuedState = null;
  try {
    if (inflight) await inflight;
    await deleteDraft();
  } catch (err) {
    console.warn('No se pudo descartar la sesión guardada.', err);
  } finally {
    useTasStore.getState().resetTas();
    suspended = false;
  }
}
