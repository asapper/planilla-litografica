# CSV Parsing & Mapping Specification
**Owner:** Drew Nakamura — Database Developer
**Status:** Phase 0 Draft
**Last updated:** 2026-04-21

---

## 1. File Characteristics

| Property | Value |
|---|---|
| Format | CSV (comma-separated) |
| Encoding | ISO-8859-1 / Latin-1 (Spanish characters present — UTF-8 will corrupt them) |
| Structure | Non-flat multi-block report — NOT a standard tabular CSV |
| Parser recommendation | PapaParse (frontend pre-view) + Apache Commons CSV (backend extraction) |
| Multiline fields | The `"HorasHorario"` column header contains a literal newline inside its quoted value. Any line-by-line reader will break this row. Apache Commons CSV handles it correctly. |

---

## 2. File Structure

The file contains one **employee block** per employee. Each block has three types of rows:

### Type 1 — Employee Header Row
Identifies the start of a new employee block.

**Detection:** Column 0 equals the string `"Empleado"`

**Example:**
```
Empleado,3,"DIEGUEZ EQUITE ,JOSE ARMANDO",3,,,,,,,,,,,,,,,,,,,,,,,,,,
```

**Fields extracted:**
| Column Index | Value | Maps To |
|---|---|---|
| 1 | `3` | `codigo_empleado` |
| 2 | `"DIEGUEZ EQUITE ,JOSE ARMANDO"` | Employee name (display only, not sent to DB) |

---

### Type 2 — Daily Row
One row per calendar day in the report period. Not used for DB submission.

**Detection:** Column 0 matches a date pattern `DD/MM/YYYY` AND column 8 is NOT `"Ausencias"`

**Example:**
```
25/11/2025,martes,9,,,03:56,,08:00,,,,,,,,,,,,,,,,,,,,,,
```

---

### Type 3 — Summary Row *(the only row submitted to the DB)*
The last row of each employee block. Contains the aggregated totals for the period.

**Detection:** Column 0 matches `DD/MM/YYYY` AND column 8 equals `"Ausencias"`

**Example:**
```
10/12/2025,miércoles,9,07:51,,07:12,,00:09,Ausencias,Inconsistencias,Entradas  Tardes,Salida Anticipada,Laborado,H.Extra,Simples,Dobles,"HorasHorario",Entrada   Matutino  Alimenta.  Vespertino,0,0,28:14:00,,,,,136:41:00,46:19:00,46:19:00,,83:27:00
```

**Column layout of the summary row:**

| Column Index | Content | Role |
|---|---|---|
| 0 | Date (last day of period) | Used to derive `mes` and `año` |
| 8 | `"Ausencias"` (label) | Summary row identifier |
| 9–17 | Other column labels | Not extracted |
| 18 | Ausencias value (integer) | → `dias_no_laborados` |
| 19 | Inconsistencias value | Not sent to DB |
| 20 | Entradas Tardes (HH:MM:SS) | Not sent to DB |
| 21–24 | Various (often empty) | Not sent to DB |
| 25 | Total hours worked | Not sent to DB |
| 26 | Total H.Extra (HH:MM:SS) | Not sent to DB |
| 27 | Simples (HH:MM:SS) | → `horas_extras_simples` (after conversion) |
| 28 | Dobles (HH:MM:SS or empty) | → `horas_extras_dobles` (after conversion) |
| 29 | HorasHorario | Not sent to DB |

> **Note:** Column indices 25–29 require empirical verification with a wider range of real files. The sample data shows Dobles as consistently empty/zero — this may mean all overtime in the sample is simple. Verify with user before finalizing.

---

## 3. Data Transformations

### 3.1 Time Format Conversion
Simples and Dobles values arrive as `HH:MM:SS` strings (e.g. `46:19:00`).
The stored procedure expects integers.

**Rule:** Convert to **total hours, rounded to nearest integer.**

```
46:19:00 → (46 * 60 + 19) / 60 = 46.317 → round → 46
32:29:00 → (32 * 60 + 29) / 60 = 32.483 → round → 32
```

If the field is empty or `"0"`, output `0`.

### 3.2 Mes and Año Derivation
Derived from the date in column 0 of the summary row.

```
10/12/2025 → mes = 12, año = 2025
```

### 3.3 Numero de Quincena
Not present in the CSV. Supplied by the user via the UI after upload. Applied uniformly to all employee rows extracted from a single file.

---

## 4. Parsing Algorithm (Pseudocode)

```
employees = []
current_employee = null

for each row in file:
    if row[0] == "Empleado":
        current_employee = { codigo: row[1], name: row[2] }

    else if row matches date pattern AND row[8] == "Ausencias":
        // This is the summary row
        summary = {
            codigo_empleado:      current_employee.codigo,
            dias_no_laborados:    parseInt(row[18]),
            horas_extras_simples: convertTime(row[27]),
            horas_extras_dobles:  convertTime(row[28]),
            mes:                  extractMonth(row[0]),
            anio:                 extractYear(row[0])
            // numero_de_quincena: injected from UI after upload
        }
        employees.push(summary)
        current_employee = null

return employees
```

---

## 5. Edge Cases to Handle

| Case | Handling |
|---|---|
| Employee block with no summary row | Skip block, log a warning, surface to user |
| Empty Simples or Dobles field | Treat as `0` |
| Malformed date in summary row | Flag row as parse error |
| File encoding other than Latin-1 | Attempt UTF-8 fallback; warn if characters appear corrupted |
| Duplicate employee codes within the same file | Flag as an in-file conflict before DB duplicate check |
| File with no valid employee blocks | Return a parse error to the UI immediately |
