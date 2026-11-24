import { createPortal } from 'react-dom';
import { MONTH_NAMES_ES } from '../../dateNames';
import { missingDaysText } from './coverageText';
import { formatClock, formatDay, formatHours, type PrintMode, type Report, type ReportEmployee, type ReportFigure } from './reviewReport';
import type { IncompletePeriod, TasPeriod } from '../../tasTypes';

interface PrintReportProps {
  report: Report;
  mode: PrintMode;
  period: TasPeriod | null;
  generatedAt: Date;
  incompletePeriods: IncompletePeriod[];
  coverageUnverified: boolean;
  usedFallbackHolidays: boolean;
}

function periodTitle(p: TasPeriod): string {
  const month = MONTH_NAMES_ES[p.mes];
  const lastDay = p.numeroDequincena === 1 ? 15 : new Date(p.anio, p.mes, 0).getDate();
  const firstDay = p.numeroDequincena === 1 ? 1 : 16;
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${p.anio} · Quincena ${p.numeroDequincena} (del ${firstDay} al ${lastDay})`;
}

function formatGenerated(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Num({ value, days = false }: { value: number; days?: boolean }) {
  return <span className={value === 0 ? 'pr-zero' : 'pr-nonzero'}>{days ? value : formatHours(value)}</span>;
}

function summaryNotes(e: ReportEmployee): string {
  const notes: string[] = [];
  if (e.diasFinal !== e.diasCalculated || e.simples.final !== e.simples.calculated || e.dobles.final !== e.dobles.calculated) notes.push('Ajustado');
  if (!e.accruesOvertime) notes.push('No acumula extras');
  if (e.estimatedDays > 0) notes.push(`${e.estimatedDays} turno est.`);
  if (e.mismatch) notes.push('⚠ No cuadra');
  return notes.join(' · ');
}

function SummaryTable({ report }: { report: Report }) {
  return (
    <table className="pr-table pr-summary">
      <colgroup>
        <col style={{ width: '9%' }} />
        <col />
        <col style={{ width: '10%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '19%' }} />
      </colgroup>
      <thead>
        <tr>
          <th className="pr-num">Código</th>
          <th>Nombre</th>
          <th className="pr-num">Días no laborados</th>
          <th className="pr-num">Extras simples</th>
          <th className="pr-num">Extras dobles</th>
          <th>Observaciones</th>
        </tr>
      </thead>
      <tbody>
        {report.employees.map(e => (
          <tr key={e.code}>
            <td className="pr-num">{e.code}</td>
            <td>{e.name}</td>
            <td className="pr-num"><Num value={e.diasFinal} days /></td>
            <td className="pr-num"><Num value={e.simples.final} /></td>
            <td className="pr-num"><Num value={e.dobles.final} /></td>
            <td className="pr-note">{summaryNotes(e)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2}>Total · {report.employees.length} {report.employees.length === 1 ? 'empleado' : 'empleados'}</td>
          <td className="pr-num">{report.totals.dias}</td>
          <td className="pr-num">{formatHours(report.totals.simples)}</td>
          <td className="pr-num">{formatHours(report.totals.dobles)}</td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}

function figureLine(label: string, f: ReportFigure, accrues: boolean): string | null {
  if (f.final === f.sumOfDays) return null;
  const reason = f.final !== f.calculated ? 'ajustado a mano' : !accrues ? 'no acumula horas extra' : 'no coincide con la suma de los días';
  return `${label}: los días suman ${formatHours(f.sumOfDays)}, se envía ${formatHours(f.final)} (${reason}).`;
}

function EmployeeDetail({ e }: { e: ReportEmployee }) {
  const worked = e.days.filter(d => d.session !== null);
  const workedHours = worked.reduce((acc, d) => acc + d.session!.workedHours, 0);
  const reconciliation = [
    figureLine('Extras simples', e.simples, e.accruesOvertime),
    figureLine('Extras dobles', e.dobles, e.accruesOvertime),
  ].filter((l): l is string => l !== null);
  const diasLine = e.absentDates.length === 0
    ? 'Sin días no laborados.'
    : `Días no laborados (${e.absentDates.length}): ${e.absentDates.map(formatDay).join(', ')}.`;

  return (
    <section className="pr-employee" aria-label={`Detalle ${e.code} ${e.name}`}>
      <div className="pr-employee-head">
        <div>
          <span className="pr-code">{e.code}</span>
          <span className="pr-name">{e.name}</span>
        </div>
        <dl className="pr-sends">
          <div><dt>Días no lab.</dt><dd>{e.diasFinal}</dd></div>
          <div><dt>Simples</dt><dd>{formatHours(e.simples.final)}</dd></div>
          <div><dt>Dobles</dt><dd>{formatHours(e.dobles.final)}</dd></div>
        </dl>
      </div>
      <table className="pr-table pr-days">
        <colgroup>
          <col style={{ width: '10%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col />
          <col style={{ width: '12%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '9%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Turno</th>
            <th>Entrada</th>
            <th>Salida</th>
            <th>Marcaciones</th>
            <th className="pr-num">Horas trab.</th>
            <th className="pr-num">Simples</th>
            <th className="pr-num">Dobles</th>
          </tr>
        </thead>
        <tbody>
          {e.days.length === 0 && (
            <tr><td colSpan={8} className="pr-empty">Sin sesiones en la quincena.</td></tr>
          )}
          {e.days.map((d, i) => d.session === null ? (
            <tr key={`${d.date}-${i}`} className="pr-absent-row">
              <td>{formatDay(d.date)}</td>
              <td colSpan={5} className="pr-absent">No laboró</td>
              <td className="pr-num">—</td>
              <td className="pr-num">—</td>
            </tr>
          ) : (
            <tr key={`${d.date}-${i}`} className={d.discarded ? 'pr-discarded-row' : undefined}>
              <td>{formatDay(d.date)}</td>
              <td>
                {d.session.shiftName ?? '—'}
                {d.session.estimatedShift && <span className="pr-flag">turno estimado</span>}
                {d.discarded && <span className="pr-flag">descartada (doble jornada)</span>}
              </td>
              <td className="pr-clock">{formatClock(d.session.entryTime, d.date)}</td>
              <td className="pr-clock">{formatClock(d.session.exitTime, d.date)}</td>
              <td className="pr-scans">{(d.session.scans ?? []).map(s => formatClock(s, d.date)).join(' · ')}</td>
              <td className="pr-num">
                {formatHours(d.session.workedHours)}
                {(d.session.breakDeductionMinutes ?? 0) > 0 && <span className="pr-flag">almuerzo −{d.session.breakDeductionMinutes} min</span>}
              </td>
              <td className="pr-num"><Num value={d.simples} /></td>
              <td className="pr-num"><Num value={d.dobles} /></td>
            </tr>
          ))}
        </tbody>
        {e.days.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={5}>Suma de los días ({e.workedDates} {e.workedDates === 1 ? 'día trabajado' : 'días trabajados'})</td>
              <td className="pr-num">{formatHours(workedHours)}</td>
              <td className="pr-num">{formatHours(e.simples.sumOfDays)}</td>
              <td className="pr-num">{formatHours(e.dobles.sumOfDays)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <ul className="pr-reconcile">
        <li>{diasLine}{e.diasFinal !== e.diasCalculated && ` Se envía ${e.diasFinal} (ajustado a mano).`}</li>
        {reconciliation.map(l => <li key={l}>{l}</li>)}
        {e.estimatedDays > 0 && (
          <li>{e.estimatedDays} {e.estimatedDays === 1 ? 'día' : 'días'} con turno estimado: las marcaciones no cayeron en la ventana de ningún turno y se asignó el más cercano.</li>
        )}
        {e.mismatch && <li className="pr-warn">⚠ Los días no cuadran con el total calculado. Revise este empleado antes de enviar.</li>}
      </ul>
    </section>
  );
}

export default function PrintReport({ report, mode, period, generatedAt, incompletePeriods, coverageUnverified, usedFallbackHolidays }: PrintReportProps) {
  return createPortal(
    <div className="print-report" data-testid="print-report">
      <header className="pr-header">
        <div>
          <h1>Horas extra y días no laborados</h1>
          <p className="pr-period">{period ? periodTitle(period) : 'Sin quincena seleccionada'}</p>
        </div>
        <div className="pr-meta">
          <p>Generado: {formatGenerated(generatedAt)}</p>
          <p>{report.employees.length} a enviar{report.excluded.length > 0 && ` · ${report.excluded.length} ${report.excluded.length === 1 ? 'excluido' : 'excluidos'}`}</p>
        </div>
      </header>

      {(incompletePeriods.length > 0 || coverageUnverified || usedFallbackHolidays) && (
        <div className="pr-callout">
          {coverageUnverified && <p>⚠ No se pudo verificar que el archivo cubra la quincena completa. Si faltan días, cuentan como no laborados para todos.</p>}
          {incompletePeriods.map(p => (
            <p key={`${p.anio}-${p.mes}-${p.numeroDequincena}`}>
              ⚠ Quincena incompleta: el archivo no tiene marcaciones {missingDaysText(p)}. Esos días cuentan como no laborados para todos.
            </p>
          ))}
          {usedFallbackHolidays && <p>⚠ Feriados tomados de la lista guardada en el equipo (no se pudo consultar el servicio de feriados).</p>}
        </div>
      )}

      <p className="pr-legend">
        {mode === 'detail' && 'Las horas extra se cuentan por día en medias horas completas y luego se suman; en el detalle, la suma de los días da lo que se envía, salvo los ajustes indicados. '}
        Los domingos y feriados no cuentan como días no laborados.
      </p>

      <SummaryTable report={report} />

      <div className="pr-tail">
        {report.excluded.length > 0 && (
          <div className="pr-excluded">
            <h2>Excluidos · ya enviados en una carga anterior</h2>
            <p>{report.excluded.map(x => `${x.code} ${x.name}`).join(' · ')}</p>
          </div>
        )}
        {report.withoutScans.length > 0 && (
          <div className="pr-excluded">
            <h2>Activos sin marcaciones en el archivo · no se envían</h2>
            <p>{report.withoutScans.map(x => `${x.code} ${x.name}`).join(' · ')}</p>
          </div>
        )}
        <div className="pr-signoff">
          <span>Revisado por: ______________________________</span>
          <span>Fecha: ______________</span>
        </div>
      </div>

      {mode === 'detail' && (
        <div className="pr-detail">
          <h2 className="pr-detail-title">Detalle por empleado</h2>
          {report.employees.map(e => <EmployeeDetail key={e.code} e={e} />)}
        </div>
      )}
    </div>,
    document.body,
  );
}
