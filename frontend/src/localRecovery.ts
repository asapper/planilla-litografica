import { submitInactiveReview, uploadTasFile } from './tasApi';
import { tasInitialState, useTasStore, type CardInput, type ResolvedSessionEntry } from './tasStore';
import type { DoubleChoice, InactiveDecision, TasPeriod, TasSession, TasUploadResult, TasView } from './tasTypes';
import { localCopyFile, type LocalCopy } from './localCopy';

export interface Recovery {
  view: TasView;
  // Decisions whose day is no longer in the rebuilt session (the shifts or the employee list changed).
  dropped: number;
  // The saved session had reached "Revisar": the user presses it again to see the totals.
  wasInReview: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

// The backend numbers sessions afresh on every upload; a day is the same day by employee, date and scans.
function dayKey(session: TasSession): string {
  return `${session.employeeId}|${session.date}|${session.scans.join(',')}`;
}

function samePeriod(a: TasPeriod, b: unknown): boolean {
  const p = record(b);
  return a.anio === p.anio && a.mes === p.mes && a.numeroDequincena === p.numeroDequincena;
}

// Rebuilds a session from the copy kept on this PC: uploads the same file again, replays the
// inactive-employee choices, and carries every decision over to the new session's days.
export async function rebuildFromLocalCopy(copy: LocalCopy): Promise<Recovery> {
  const saved = copy.snapshot ?? {};
  let result: TasUploadResult = await uploadTasFile(localCopyFile(copy));

  const decisions = record(saved.inactiveDecisions) as Record<string, InactiveDecision>;
  const savedView = saved.tasView;
  if (result.inactiveEmployeesFound.length > 0 && savedView !== 'inactiveReview') {
    const reactivate = result.inactiveEmployeesFound.filter(e => decisions[e.employeeId] === 'reactivate').map(e => e.employeeId);
    const ignore = result.inactiveEmployeesFound.filter(e => decisions[e.employeeId] !== 'reactivate').map(e => e.employeeId);
    result = await submitInactiveReview(result.uploadToken, reactivate, ignore);
  }

  const newIdByDay = new Map(result.flaggedSessions.map(s => [dayKey(s), s.sessionId]));
  const idMap = new Map<number, number>();
  const savedSessions = Array.isArray(saved.flaggedSessions) ? (saved.flaggedSessions as TasSession[]) : [];
  for (const session of savedSessions) {
    if (!session || typeof session.sessionId !== 'number' || !Array.isArray(session.scans)) continue;
    const id = newIdByDay.get(dayKey(session));
    if (id !== undefined) idMap.set(session.sessionId, id);
  }

  let dropped = 0;
  const remap = <T>(values: unknown): Record<number, T> => {
    const out: Record<number, T> = {};
    for (const [oldId, value] of Object.entries(record(values))) {
      const id = idMap.get(Number(oldId));
      if (id === undefined) dropped += 1;
      else out[id] = value as T;
    }
    return out;
  };
  const sameDayDoubleResolutions: Record<string, DoubleChoice> = {};
  for (const [groupKey, choice] of Object.entries(record(saved.sameDayDoubleResolutions))) {
    if (choice === 'all') sameDayDoubleResolutions[groupKey] = 'all';
    else if (typeof choice === 'number' && idMap.has(choice)) sameDayDoubleResolutions[groupKey] = idMap.get(choice)!;
    else dropped += 1;
  }

  const periods = result.availablePeriods ?? [];
  const selectedPeriod = periods.find(p => samePeriod(p, saved.selectedPeriod)) ?? periods[0] ?? null;
  const inInactiveReview = result.inactiveEmployeesFound.length > 0;
  const view: TasView = inInactiveReview ? 'inactiveReview' : 'verification';

  useTasStore.setState({
    ...tasInitialState,
    tasView: view,
    uploadToken: result.uploadToken,
    stateRevision: result.stateRevision,
    flaggedSessions: result.flaggedSessions,
    resolvedRows: result.resolvedRows ?? [],
    resolvedRowCount: result.resolvedRows?.length ?? 0,
    sessionSummaries: result.sessionSummaries ?? {},
    inactiveEmployees: result.inactiveEmployeesFound,
    absentEmployees: result.absentActiveEmployees,
    warnings: result.warnings ?? [],
    usedFallbackHolidays: result.usedFallbackHolidays,
    availablePeriods: periods,
    availableShifts: result.availableShifts ?? [],
    selectedPeriod,
    inactiveDecisions: decisions,
    resolvedSessions: remap<ResolvedSessionEntry>(saved.resolvedSessions),
    cardInputs: remap<CardInput>(saved.cardInputs),
    shiftAcceptances: remap<string>(saved.shiftAcceptances),
    sameDayDoubleResolutions,
    overtimeOverrides: record(saved.overtimeOverrides) as typeof tasInitialState.overtimeOverrides,
    stashedOvertimeOverrides: record(saved.stashedOvertimeOverrides) as typeof tasInitialState.stashedOvertimeOverrides,
    nonWorkedDaysOverrides: record(saved.nonWorkedDaysOverrides) as typeof tasInitialState.nonWorkedDaysOverrides,
    stashedNonWorkedDaysOverrides: record(saved.stashedNonWorkedDaysOverrides) as typeof tasInitialState.stashedNonWorkedDaysOverrides,
    fallbackBannerDismissed: saved.fallbackBannerDismissed === true,
  });

  return { view, dropped, wasInReview: savedView === 'review' };
}
