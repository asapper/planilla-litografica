# TAS Overtime Rules Redesign (TASK-33)

## Background

Current spec (`docs/tas_shift_rules.md`, "Weekly Hours: Simples vs. Dobles"):

- `horas_extras_simples` = hours worked **within** the assigned shift's duration on Mon-Sat (non-holiday).
- `horas_extras_dobles` = hours worked **beyond** the shift duration on any day, plus all Sunday hours, plus all public holiday hours.

New requirement (per Andy, 2026-06-10):

- `horas_extras_simples` = overtime hours worked **Mon-Sat, beyond the standard shift**.
- `horas_extras_dobles` = overtime hours worked on **any other day** (Sundays, holidays, etc).
- A per-employee flag for employees who are contractually required to work longer shifts but do **not** accrue overtime — their extra hours should not count toward either field.

## Decisions

1. **Regular (non-overtime) hours**: not tracked or reported anywhere. Both `horas_extras_simples` and `horas_extras_dobles` become overtime-only fields; within-shift Mon-Sat hours are simply dropped from the output.
2. **Sunday/holiday hours**: unchanged from current behavior — **all** hours worked on Sundays/holidays count toward `horas_extras_dobles`, not just the portion beyond shift duration.
3. **Net effect**: this is largely a relabeling. What was previously the "Mon-Sat overtime" component of `horas_extras_dobles` now goes to `horas_extras_simples` instead. The within-shift Mon-Sat portion (previously `horas_extras_simples`) is dropped. Sunday/holiday logic is untouched.
4. **Overtime exemption flag**: per-employee boolean (`accruesOvertime`, default `true`), not per-role. When `false`, both `horas_extras_simples` and `horas_extras_dobles` are forced to `0` for that employee, regardless of hours worked (including Sundays/holidays).

## Calculation changes — `TasHoursCalculator.classifyHours`

Current (Mon-Sat, non-holiday branch):
```java
if (totalMinutes <= shiftDurationRoundedMinutes) {
    simplesMinutes = totalMinutes; doblesMinutes = 0;
} else {
    simplesMinutes = shiftDurationRoundedMinutes; doblesMinutes = totalMinutes - shiftDurationRoundedMinutes;
}
```

New:
```java
if (totalMinutes <= shiftDurationRoundedMinutes) {
    simplesMinutes = 0; doblesMinutes = 0;
} else {
    simplesMinutes = totalMinutes - shiftDurationRoundedMinutes; doblesMinutes = 0;
}
```

The Sunday/holiday branch (`simplesMinutes = 0; doblesMinutes = totalMinutes;`) is unchanged.

The 8h-default-duration fallback for `AMBIGUOUS_SHIFT` sessions (see "Worked Hours per Session" in `docs/tas_shift_rules.md`) requires no change — the formula shape is preserved, only the bucket assignment changes.

## Overtime exemption flag

### Schema

`employee_registry` gains a new column:
```sql
accrues_overtime BOOLEAN NOT NULL DEFAULT TRUE
```

### Backend

- `EmployeeRegistryService`: get/set for `accruesOvertime`, mirroring the existing `active` flag handling.
- `TasReportBuilder`: after computing `horasExtrasSimples`/`horasExtrasDobles` for an employee/period, if `accruesOvertime == false`, force both to `0`.
- `EmployeeRow`: new `accruesOvertime` boolean field, surfaced to the frontend.
- New endpoints:
  - `PATCH /api/tas/employees/{id}/accrues-overtime` — updates the persisted flag. Used by both the Config Employees tab and the Review screen.
  - `POST /api/tas/recompute/{uploadToken}` — rebuilds `resolvedRows` from the already-parsed/cached sessions for that upload, using the current `employee_registry` flags. Reuses `TasReportBuilder`; no re-parsing of the TAS file.

### Frontend

- **Config → Tab 2 (Empleados)**: new "Acumula horas extra" toggle column, same interaction pattern as the existing `active` toggle.
- **ReviewScreen** ("Revisión de registros procesados"): same toggle as a new column, always visible for every employee row.
  - On toggle: call `PATCH /api/tas/employees/{id}/accrues-overtime`, then `POST /api/tas/recompute/{uploadToken}`, and replace `resolvedRows` with the response. Symmetric for on/off — no special-casing.
  - On PATCH/recompute failure: revert the toggle, show inline error toast (existing `setError` pattern), table stays unchanged.
  - If `uploadToken` has expired, recompute returns an error and the existing "session expired, re-upload" messaging is shown.

## Testing

- `TasHoursCalculatorTest`: update Mon-Sat overtime cases for the new split (within-shift → 0/0, overtime → simples only); Sunday/holiday cases unchanged.
- `TasReportBuilderTest`: new case for `accruesOvertime = false` zeroing both fields.
- `EmployeeRegistryServiceTest` / controller tests: flag get/set, PATCH endpoint.
- New test for the recompute endpoint: given an `uploadToken` and an updated flag, returns updated rows.
- Frontend: `EmployeesTab.test.tsx` and `ReviewScreen.test.tsx` — toggle renders, PATCH/recompute calls fire, table refreshes with updated values.

## Documentation updates

`docs/tas_shift_rules.md`:
- Rewrite "Weekly Hours: Simples vs. Dobles" with the new definitions; remove the "SP field naming note" (no longer applicable — neither field holds regular hours).
- Add a new "Overtime Exemption" subsection describing the `accruesOvertime` flag, where it's configured (Config Tab 2 + Review screen), and its effect.
- Remove the TASK-33 forward-reference note in "Worked Hours per Session" (~line 182) — the 8h-default fallback needs no change.
