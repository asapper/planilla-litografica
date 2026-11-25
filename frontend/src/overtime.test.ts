import { describe, it, expect } from 'vitest';
import { adjustedDecision, approvedDecision, effectiveOvertime, inPeriod, needsReview, periodKey, toHalfHours, type OvertimeDecision } from './overtime';
import type { ResolvedRow } from './tasTypes';

const row = (over: Partial<ResolvedRow> = {}): ResolvedRow => ({
  codigoEmpleado: '1', nombreEmpleado: 'Ana', diasNoLaborados: 0, fechasNoLaboradas: [], horasExtrasSimples: 4,
  horasExtrasDobles: 2, mes: 11, anio: 2026, numeroDequincena: 1, diasTurnoEstimado: 0, accruesOvertime: true, ...over,
});
const approved: OvertimeDecision = { kind: 'approved', simples: 4, dobles: 2, calcSimples: 4, calcDobles: 2 };
const adjusted: OvertimeDecision = { kind: 'adjusted', simples: 1, dobles: 0, calcSimples: 4, calcDobles: 2 };

describe('effectiveOvertime', () => {
  it.each([
    ['nothing calculated, nothing decided', row({ horasExtrasSimples: 0, horasExtrasDobles: 0 }), undefined, [0, 0, 'none', false, false]],
    ['calculated but not looked at', row(), undefined, [0, 0, 'pending', false, true]],
    ['approved as calculated', row(), approved, [4, 2, 'approved', false, false]],
    ['approved, then the calculation changed', row({ horasExtrasSimples: 12 }), approved, [0, 0, 'stale', true, true]],
    ['adjusted by hand', row(), adjusted, [1, 0, 'adjusted', false, false]],
    ['adjusted, then the calculation changed', row({ horasExtrasDobles: 3 }), adjusted, [1, 0, 'adjusted', true, true]],
    ['typed on a row with nothing calculated (a missed scan)', row({ horasExtrasSimples: 0, horasExtrasDobles: 0 }),
      { ...adjusted, simples: 2, calcSimples: 0, calcDobles: 0 }, [2, 0, 'adjusted', false, false]],
    ['does not accrue overtime, whatever was decided', row({ accruesOvertime: false }), approved, [0, 0, 'none', false, false]],
  ] as const)('%s', (_, r, decision, [simples, dobles, status, calcChanged, review]) => {
    const e = effectiveOvertime(r, decision);
    expect(e).toEqual({ simples, dobles, status, calcChanged });
    expect(needsReview(e)).toBe(review);
  });
});

describe('decisions', () => {
  it('approves the current calculation', () => {
    expect(approvedDecision(row())).toEqual(approved);
  });

  it('adjusting refreshes the calculation it was made against', () => {
    expect(adjustedDecision(row({ horasExtrasDobles: 3 }), adjusted, 'dobles', 1))
      .toEqual({ kind: 'adjusted', simples: 1, dobles: 1, calcSimples: 4, calcDobles: 3 });
  });
});

describe('periods', () => {
  it('keys a fortnight, or none', () => {
    expect(periodKey({ anio: 2026, mes: 11, numeroDequincena: 2 })).toBe('2026-11-2');
    expect(periodKey(null)).toBe('none');
  });

  it('returns the same empty object for a fortnight with nothing in it', () => {
    const a = inPeriod({}, null);
    expect(a).toBe(inPeriod({ other: {} }, { anio: 2026, mes: 1, numeroDequincena: 1 }));
    expect(inPeriod({ '2026-1-1': { x: 1 } }, { anio: 2026, mes: 1, numeroDequincena: 1 })).toEqual({ x: 1 });
  });
});

describe('toHalfHours', () => {
  it.each([['1.3', 1.5], ['1.2', 1], ['', 0], ['-2', 0], ['abc', 0]])('%s → %f', (raw, value) => {
    expect(toHalfHours(raw)).toBe(value);
  });
});
