import { describe, it, expect } from 'vitest';
import { incompleteBannerText, incompleteConfirmText, missingDaysText, periodLabel } from './coverageText';
import type { IncompletePeriod } from '../../tasTypes';

const base = { anio: 2026, mes: 10, numeroDequincena: 1, periodStart: '2026-10-01', periodEnd: '2026-10-15' };

const trailing: IncompletePeriod = {
  ...base, dataStart: '2026-09-28', dataEnd: '2026-10-11',
  missingWorkingDays: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'],
};

describe('coverageText', () => {
  it('labels a period like the review chip', () => {
    expect(periodLabel({ anio: 2026, mes: 9, numeroDequincena: 2 })).toBe('Septiembre 2026 · Q2');
  });

  it('describes a trailing gap as a range with a working-day count', () => {
    expect(missingDaysText(trailing)).toBe('del 12 al 15 de octubre (4 días laborables)');
  });

  it('uses the singular for a single missing day', () => {
    expect(missingDaysText({ ...trailing, dataEnd: '2026-10-14', missingWorkingDays: ['2026-10-15'] }))
      .toBe('del 15 de octubre (1 día laborable)');
  });

  it('describes leading and trailing gaps separately', () => {
    const both: IncompletePeriod = {
      ...base, dataStart: '2026-10-05', dataEnd: '2026-10-13',
      missingWorkingDays: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-14', '2026-10-15'],
    };
    expect(missingDaysText(both)).toBe('del 1 al 3 y del 14 al 15 de octubre (5 días laborables)');
  });

  it('builds the banner text', () => {
    expect(incompleteBannerText(trailing)).toBe(
      'Quincena incompleta (Octubre 2026 · Q1): el archivo no tiene marcaciones del 12 al 15 de octubre (4 días laborables). '
      + 'Esos días se contarán como no laborados para todos los empleados. '
      + 'Exporte de nuevo el reporte de TAS con la quincena completa.');
  });

  it('joins several periods in the confirm text', () => {
    const sep: IncompletePeriod = {
      anio: 2026, mes: 9, numeroDequincena: 2, periodStart: '2026-09-16', periodEnd: '2026-09-30',
      dataStart: '2026-09-28', dataEnd: '2026-10-11', missingWorkingDays: ['2026-09-26'],
    };
    expect(incompleteConfirmText([sep, trailing])).toBe(
      'El archivo no tiene marcaciones del 26 de septiembre (1 día laborable) (Septiembre 2026 · Q2); '
      + 'del 12 al 15 de octubre (4 días laborables) (Octubre 2026 · Q1). '
      + 'Si envía ahora, esos días se registrarán como no laborados para todos los empleados. '
      + '¿Desea enviar de todas formas?');
  });
});
