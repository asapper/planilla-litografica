import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useTasStore } from './tasStore';
import { useToastStore } from './toastStore';
import type { TasSession, TasUploadResult } from './tasTypes';

// The user's scenario, through the real start screen, verification and review screens: load a file,
// fill in some cards (one only half), walk away for the weekend while the app or the PC restarts,
// come back, finish, press "Revisar" and then "Enviar". Only the network is faked: a backend that
// keeps what the app saves, as the real one does in its database.

vi.mock('./api', () => ({ checkHealth: vi.fn().mockResolvedValue(undefined), checkDbHealth: vi.fn().mockResolvedValue(true) }));
vi.mock('./backendStatus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./backendStatus')>()),
  getBackendStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock('./components/TopAppBar', () => ({ default: () => <div /> }));
vi.mock('./components/ConfigPage', () => ({ default: () => <div /> }));

const backend = vi.hoisted(() => ({
  saved: null as null | { uploadToken: string; view: string; fileName: string | null; periodLabel: string | null; ui: Record<string, unknown> },
  uploads: 0,
  twoPeriods: false,
  flagged: [] as TasSession[],
  resolved: [] as unknown[][],
  submitted: [] as string[],
}));

const PERIOD = { anio: 2026, mes: 10, numeroDequincena: 1 };
// Every upload numbers the sessions afresh, as the backend does.
const day = (id: number, employeeId: string, employeeName: string, overrides: Partial<TasSession>): TasSession => ({
  sessionId: id, employeeId, employeeName, date: '2026-10-03', scans: [], matchedShiftId: 'm', matchedShiftName: 'Mañana',
  assignedShiftId: 'm', assignedShiftName: 'Mañana', effectiveStart: null, lastScan: null, workedMinutes: 0, workedHours: 0,
  crossMidnight: false, needsResolution: true, flags: ['MISSING_EXIT'], ...overrides,
});
const Q2 = { anio: 2026, mes: 10, numeroDequincena: 2 };
const uploadResult = (n: number): TasUploadResult => ({
  uploadToken: `tok-${n}`, stateRevision: 1, resolvedRows: [], inactiveEmployeesFound: [], absentActiveEmployees: [],
  warnings: [], usedFallbackHolidays: false, availableShifts: [], sessionSummaries: {},
  availablePeriods: backend.twoPeriods ? [PERIOD, Q2] : [PERIOD],
  flaggedSessions: backend.twoPeriods ? [
    day(n * 100 + 1, 'E1', 'Ana Ruiz', { scans: ['2026-10-03T07:02:00'], effectiveStart: '2026-10-03T07:02:00' }),
    day(n * 100 + 3, 'E1', 'Ana Ruiz', { date: '2026-10-20', scans: ['2026-10-20T07:05:00'], effectiveStart: '2026-10-20T07:05:00' }),
  ] : [
    day(n * 100 + 1, 'E1', 'Ana Ruiz', { scans: ['2026-10-03T07:02:00'], effectiveStart: '2026-10-03T07:02:00', flags: ['MISSING_EXIT'] }),
    day(n * 100 + 2, 'E2', 'Luis Mora', { flags: ['MISSING_ENTRY', 'MISSING_EXIT'] }),
  ],
} as TasUploadResult);

vi.mock('./tasApi', () => ({
  uploadTasFile: vi.fn(async () => {
    const result = uploadResult(++backend.uploads);
    backend.flagged = result.flaggedSessions;
    return result;
  }),
  saveDraft: vi.fn(async (body: { uploadToken: string; view: string; fileName: string | null; periodLabel: string | null; ui: Record<string, unknown> }) => {
    backend.saved = body;
  }),
  getDraftSummary: vi.fn(async () => backend.saved && {
    fileName: backend.saved.fileName, view: backend.saved.view, periodLabel: backend.saved.periodLabel,
    savedAt: '2026-11-21T18:00:00Z', partialSubmit: false, resumable: true,
    uiVersion: backend.saved.ui.uiVersion as number, jobActive: false,
  }),
  resumeDraft: vi.fn(async () => ({ uploadToken: backend.saved!.uploadToken, ui: backend.saved!.ui })),
  deleteDraft: vi.fn(async () => { backend.saved = null; }),
  resolveVerification: vi.fn(async (token: string, resolutions: { sessionId?: number }[]) => {
    backend.resolved.push(resolutions);
    // As the backend does: a resolved day leaves the flagged list.
    const sent = new Set(resolutions.map(r => r.sessionId));
    backend.flagged = backend.flagged.filter(s => !sent.has(s.sessionId));
    return {
      uploadToken: token, stateRevision: 3, flaggedSessions: backend.flagged, usedFallbackHolidays: false, availableShifts: [],
      availablePeriods: backend.twoPeriods ? [PERIOD, Q2] : [PERIOD], sessionSummaries: {},
      resolvedRows: [
        { codigoEmpleado: 'E1', nombreEmpleado: 'Ana Ruiz', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 10, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
        { codigoEmpleado: 'E2', nombreEmpleado: 'Luis Mora', diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0, mes: 10, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true },
      ],
    };
  }),
  checkDuplicates: vi.fn(async () => []),
  getIncompletePeriods: vi.fn(async () => []),
  submitTas: vi.fn(async (token: string) => { backend.submitted.push(token); return { jobId: 'job-1' }; }),
  getTasJobStatus: vi.fn(() => new Promise(() => {})),
  submitInactiveReview: vi.fn(),
  recomputeTas: vi.fn(),
  getAbsentReview: vi.fn(async () => ({ absentEmployees: [] })),
  setAbsentEmployeesActive: vi.fn(),
  retryTasJob: vi.fn(),
}));

const { default: App } = await import('./App');

const SAVE_WAIT = { timeout: 3000 };
const csv = () => new File(['"No.","Fecha y hora","Evento","Nombre de usuario","ID de usuario"\n"1","2026/10/03 07:02","1:N Autenticación exitosa (Rostro)","Ana Ruiz","1"\n'], 'octubre.csv', { type: 'text/csv' });
// The employee's time card (the group header carries the name too).
const card = (name: string) => screen.getAllByText(name)
  .map(el => el.closest('div.rounded-shape-md'))
  .find(el => el?.querySelector('input[type="time"]')) as HTMLElement;

async function workThenWalkAway() {
  const { container, unmount } = render(<App />);
  const input = await waitFor(() => {
    const el = container.querySelector('input[type="file"]');
    expect(el).not.toBeNull();
    return el as HTMLInputElement;
  });
  fireEvent.change(input, { target: { files: [csv()] } });
  await screen.findByText('Verificación de marcaciones');

  fireEvent.change(within(card('Ana Ruiz')).getByLabelText('Salida'), { target: { value: '15:30' } });
  fireEvent.change(within(card('Luis Mora')).getByLabelText('Entrada'), { target: { value: '08:00' } });
  // Autosave runs on its own: no button was pressed to save.
  await waitFor(() => expect(Object.keys(backend.saved?.ui.cardInputs ?? {})).toHaveLength(2), SAVE_WAIT);

  // The weekend: the app is closed or the PC restarts. Nothing in memory survives.
  unmount();
  useTasStore.getState().resetTas();
  useToastStore.setState({ toasts: [] });
}

async function finishAndSend(expectedIds: [number, number]) {
  expect(within(card('Luis Mora')).getByLabelText('Entrada')).toHaveValue('08:00');
  expect(within(card('Luis Mora')).getByLabelText('Salida')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: /Ana Ruiz/ }));
  fireEvent.click(screen.getByRole('button', { name: /Editar Ana Ruiz/ }));
  expect(within(card('Ana Ruiz')).getByLabelText('Salida')).toHaveValue('15:30');

  fireEvent.change(within(card('Luis Mora')).getByLabelText('Salida'), { target: { value: '16:00' } });
  fireEvent.click(screen.getByRole('button', { name: /revisar/i }));
  await waitFor(() => expect(backend.resolved).toHaveLength(1));
  expect(backend.resolved[0]).toEqual(expect.arrayContaining([
    { sessionId: expectedIds[0], resolvedStart: '2026-10-03 07:02', resolvedEnd: '2026-10-03 15:30' },
    { sessionId: expectedIds[1], resolvedStart: '2026-10-03 08:00', resolvedEnd: '2026-10-03 16:00' },
  ]));

  const enviar = await screen.findByRole('button', { name: 'Enviar' });
  await waitFor(() => expect(enviar).not.toBeDisabled(), SAVE_WAIT);
  fireEvent.click(enviar);
  await waitFor(() => expect(backend.submitted).toHaveLength(1));
}

beforeEach(() => {
  localStorage.clear();
  backend.saved = null;
  backend.uploads = 0;
  backend.twoPeriods = false;
  backend.flagged = [];
  backend.resolved = [];
  backend.submitted = [];
  useTasStore.getState().resetTas();
  useToastStore.setState({ toasts: [] });
});

describe('walking away for the weekend', () => {
  it('comes back to every value typed, half-filled cards included, and can still Revisar and Enviar', async () => {
    await workThenWalkAway();

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    await screen.findByText('Verificación de marcaciones');
    expect(backend.uploads).toBe(1);

    await finishAndSend([101, 102]);
    expect(backend.submitted).toEqual(['tok-1']);
  }, 20_000);

  it('comes back even when the backend lost its saved session, from the copy kept on this PC', async () => {
    await workThenWalkAway();
    backend.saved = null;

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    await screen.findByText('Verificación de marcaciones');
    expect(backend.uploads).toBe(2);

    await finishAndSend([201, 202]);
    expect(backend.submitted).toEqual(['tok-2']);
  }, 20_000);

  it('walks away after Revisar; with the backend session lost, the copy brings every decision back', async () => {
    const { container, unmount } = render(<App />);
    const input = await waitFor(() => {
      const el = container.querySelector('input[type="file"]');
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.change(input, { target: { files: [csv()] } });
    await screen.findByText('Verificación de marcaciones');
    fireEvent.change(within(card('Ana Ruiz')).getByLabelText('Salida'), { target: { value: '15:30' } });
    fireEvent.change(within(card('Luis Mora')).getByLabelText('Entrada'), { target: { value: '08:00' } });
    fireEvent.change(within(card('Luis Mora')).getByLabelText('Salida'), { target: { value: '16:00' } });
    fireEvent.click(screen.getByRole('button', { name: /revisar/i }));
    await screen.findByRole('button', { name: 'Enviar' });
    // "Revisar" answered with the resolved days gone from the flagged list, as the backend does.
    await waitFor(() => expect(backend.saved?.view).toBe('review'), SAVE_WAIT);

    unmount();
    useTasStore.getState().resetTas();
    backend.saved = null;
    backend.resolved = [];

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    await screen.findByText('Verificación de marcaciones');
    expect(backend.uploads).toBe(2);
    expect(useToastStore.getState().toasts.map(t => t.variant)).toEqual(['success']);
    expect(screen.queryByText(/por resolver/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /revisar/i }));
    await waitFor(() => expect(backend.resolved).toHaveLength(1));
    expect(backend.resolved[0]).toEqual(expect.arrayContaining([
      { sessionId: 201, resolvedStart: '2026-10-03 07:02', resolvedEnd: '2026-10-03 15:30' },
      { sessionId: 202, resolvedStart: '2026-10-03 08:00', resolvedEnd: '2026-10-03 16:00' },
    ]));
    const enviar = await screen.findByRole('button', { name: 'Enviar' });
    await waitFor(() => expect(enviar).not.toBeDisabled(), SAVE_WAIT);
    fireEvent.click(enviar);
    await waitFor(() => expect(backend.submitted).toEqual(['tok-2']));
  }, 20_000);

  it('a two-fortnight file: Revisar Q1, Cambiar quincena, fill Q2, walk away, backend lost: both come back', async () => {
    backend.twoPeriods = true;
    const { container, unmount } = render(<App />);
    const input = await waitFor(() => {
      const el = container.querySelector('input[type="file"]');
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.change(input, { target: { files: [csv()] } });
    await screen.findByText('Verificación de marcaciones');
    fireEvent.change(within(card('Ana Ruiz')).getByLabelText('Salida'), { target: { value: '15:30' } });
    fireEvent.click(screen.getByRole('button', { name: /revisar/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cambiar quincena' }));
    await screen.findByText('Verificación de marcaciones');
    fireEvent.change(screen.getByLabelText('Periodo'), { target: { value: '2026-10-2' } });
    fireEvent.change(within(card('Ana Ruiz')).getByLabelText('Salida'), { target: { value: '16:00' } });
    await waitFor(() => expect(JSON.stringify(backend.saved?.ui.cardInputs)).toContain('16:00'), SAVE_WAIT);

    unmount();
    useTasStore.getState().resetTas();
    backend.saved = null;

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    await screen.findByText('Verificación de marcaciones');
    expect(useToastStore.getState().toasts.map(t => t.variant)).toEqual(['success']);
    expect(useTasStore.getState().resolvedSessions).toEqual({
      201: { resolvedStart: '07:02', resolvedEnd: '15:30' },
      203: { resolvedStart: '07:05', resolvedEnd: '16:00' },
    });
    expect(useTasStore.getState().selectedPeriod).toEqual(Q2);
  }, 20_000);
});
