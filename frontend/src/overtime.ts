import type { ResolvedRow, TasPeriod } from './tasTypes';

// The clerk's decision on one employee's overtime, with the calculation it was made against: an
// approval only stands while the calculation is still the one that was approved.
export interface OvertimeDecision {
  kind: 'approved' | 'adjusted';
  simples: number;
  dobles: number;
  calcSimples: number;
  calcDobles: number;
}

export type OvertimeStatus = 'none' | 'pending' | 'stale' | 'approved' | 'adjusted';

export interface EffectiveOvertime {
  simples: number;
  dobles: number;
  status: OvertimeStatus;
  calcChanged: boolean;
}

export type OvertimeField = 'simples' | 'dobles';

// Per-employee review state is kept per fortnight, so browsing another one never carries it over.
export type ByPeriod<T> = Record<string, Record<string, T>>;

export function periodKey(period: TasPeriod | null): string {
  return period ? `${period.anio}-${period.mes}-${period.numeroDequincena}` : 'none';
}

const EMPTY: Record<string, never> = Object.freeze({}) as Record<string, never>;

// Returns the same object while nothing changes, so it is safe as a store selector.
export function inPeriod<T>(byPeriod: ByPeriod<T>, period: TasPeriod | null): Record<string, T> {
  return byPeriod[periodKey(period)] ?? EMPTY;
}

// Overtime has to be approved: what the clerk did not look at is sent as zero. Submit, the screens and
// the printed report all read what is sent from here.
export function effectiveOvertime(row: ResolvedRow, decision: OvertimeDecision | undefined): EffectiveOvertime {
  if (!row.accruesOvertime) return { simples: 0, dobles: 0, status: 'none', calcChanged: false };
  const calcSimples = row.horasExtrasSimples;
  const calcDobles = row.horasExtrasDobles;
  if (decision) {
    const calcChanged = decision.calcSimples !== calcSimples || decision.calcDobles !== calcDobles;
    if (decision.kind === 'approved') {
      return calcChanged
        ? { simples: 0, dobles: 0, status: 'stale', calcChanged }
        : { simples: calcSimples, dobles: calcDobles, status: 'approved', calcChanged };
    }
    return { simples: decision.simples, dobles: decision.dobles, status: 'adjusted', calcChanged };
  }
  if (calcSimples === 0 && calcDobles === 0) return { simples: 0, dobles: 0, status: 'none', calcChanged: false };
  return { simples: 0, dobles: 0, status: 'pending', calcChanged: false };
}

export function needsReview(e: EffectiveOvertime): boolean {
  return e.status === 'pending' || e.status === 'stale' || (e.status === 'adjusted' && e.calcChanged);
}

export function approvedDecision(row: ResolvedRow): OvertimeDecision {
  return {
    kind: 'approved',
    simples: row.horasExtrasSimples,
    dobles: row.horasExtrasDobles,
    calcSimples: row.horasExtrasSimples,
    calcDobles: row.horasExtrasDobles,
  };
}

// Typing one field keeps the other at what its input showed, which is what would have been sent.
export function adjustedDecision(row: ResolvedRow, current: OvertimeDecision | undefined, field: OvertimeField, value: number): OvertimeDecision {
  const shown = effectiveOvertime(row, current);
  return {
    kind: 'adjusted',
    simples: shown.simples,
    dobles: shown.dobles,
    [field]: value,
    calcSimples: row.horasExtrasSimples,
    calcDobles: row.horasExtrasDobles,
  };
}

export function toHalfHours(raw: string): number {
  const parsed = parseFloat(raw);
  return Number.isNaN(parsed) || parsed < 0 ? 0 : Math.round(parsed * 2) / 2;
}
