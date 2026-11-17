import axios from 'axios';
import { useTasStore, tasInitialState, type TasStore } from './tasStore';
import { saveDraft, deleteDraft } from './tasApi';
import { MONTH_NAMES_ES } from './dateNames';
import type { DraftView, TasPeriod, TasView } from './tasTypes';

export const DRAFT_SAVE_DEBOUNCE_MS = 500;
export const DRAFT_SAVE_MAX_WAIT_MS = 3000;

const SAVABLE_VIEWS: ReadonlySet<TasView> = new Set<TasView>(['inactiveReview', 'verification', 'review']);

export const PERSISTED_KEYS = [
  'tasView',
  'uploadToken',
  'stateRevision',
  'resolvedSessions',
  'shiftAcceptances',
  'sameDayDoubleResolutions',
  'selectedPeriod',
  'inactiveDecisions',
  'overtimeOverrides',
  'stashedOvertimeOverrides',
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

function send(state: TasStore): Promise<void> {
  return saveDraft({
    uploadToken: state.uploadToken as string,
    stateRevision: state.stateRevision,
    fileName: getFileName() || null,
    view: state.tasView as DraftView,
    periodLabel: formatPeriodLabel(state.selectedPeriod),
    ui: toSnapshot(state) as unknown as Record<string, unknown>,
  }).catch(err => {
    if (axios.isAxiosError(err) && err.response?.status === 409) {
      warnStale(state.stateRevision, err.response.data?.currentRevision);
      return;
    }
    console.warn('No se pudo guardar la sesión en curso.', err);
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
  if (isSavable(state)) void send(state);
}

function flush(explicitState?: TasStore) {
  clearTimer();
  if (suspended) return;
  if (inflight) {
    queued = true;
    if (explicitState) queuedState = explicitState;
    return;
  }
  const state = explicitState ?? useTasStore.getState();
  if (!isSavable(state)) return;
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

// The app is closing: send what is pending and wait until the backend has it.
export async function saveDraftNow(): Promise<void> {
  if (timer !== null && !suspended) flush();
  while (inflight) await inflight;
}

export function startDraftAutosave(fileNameGetter: () => string): () => void {
  getFileName = fileNameGetter;
  const unsubscribe = useTasStore.subscribe((state, prev) => {
    if (suspended) return;
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
  });
  window.addEventListener('pagehide', saveBeforeClose);
  return () => {
    unsubscribe();
    window.removeEventListener('pagehide', saveBeforeClose);
    clearTimer();
  };
}

export async function discardDraftSession(): Promise<void> {
  suspended = true;
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
