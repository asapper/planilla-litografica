import { MONTH_NAMES_ES } from '../../dateNames';
import type { IncompletePeriod, TasPeriod } from '../../tasTypes';

const dayOf = (iso: string) => Number(iso.slice(8, 10));

export function periodLabel(p: TasPeriod): string {
  const month = MONTH_NAMES_ES[p.mes];
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${p.anio} · Q${p.numeroDequincena}`;
}

function groupText(days: string[]): string {
  return days.length === 1
    ? `del ${dayOf(days[0])}`
    : `del ${dayOf(days[0])} al ${dayOf(days[days.length - 1])}`;
}

export function missingDaysText(p: IncompletePeriod): string {
  const before = p.missingWorkingDays.filter(d => d < p.dataStart);
  const after = p.missingWorkingDays.filter(d => d > p.dataEnd);
  const groups = [before, after].filter(g => g.length > 0).map(groupText).join(' y ');
  const count = p.missingWorkingDays.length;
  return `${groups} de ${MONTH_NAMES_ES[p.mes]} (${count} ${count === 1 ? 'día laborable' : 'días laborables'})`;
}

export function incompleteBannerText(p: IncompletePeriod): string {
  return `Quincena incompleta (${periodLabel(p)}): el archivo no tiene marcaciones ${missingDaysText(p)}. `
    + 'Esos días se contarán como no laborados para todos los empleados. '
    + 'Exporte de nuevo el reporte de TAS con la quincena completa.';
}

export function incompleteConfirmText(periods: IncompletePeriod[]): string {
  const parts = periods.map(p => `${missingDaysText(p)} (${periodLabel(p)})`).join('; ');
  return `El archivo no tiene marcaciones ${parts}. `
    + 'Si envía ahora, esos días se registrarán como no laborados para todos los empleados. '
    + '¿Desea enviar de todas formas?';
}
