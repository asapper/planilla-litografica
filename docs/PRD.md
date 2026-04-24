# Product Requirements Document — CSV Data Loader (Planilla Lito)
**Owner:** Sofia Reyes — Product Manager
**Status:** Phase 0 Draft
**Last updated:** 2026-04-21

---

## 1. Overview

A desktop application that allows non-technical payroll staff to upload a CSV attendance report, review and edit the extracted employee data, and submit it to the company database via a stored procedure. The app must be simple enough to use with zero training.

---

## 2. User Persona

**Primary user:** Payroll or HR staff with no technical background. Comfortable with spreadsheets but not with databases or command-line tools. Uses Windows. Expects the app to behave like a familiar office tool — clear, guided, and forgiving of mistakes.

---

## 3. User Stories & Acceptance Criteria

### US-01 — Upload a CSV file
**As a** payroll user,
**I want to** upload my attendance report CSV,
**So that** I can see the employee data ready for review without any manual work.

**Acceptance criteria:**
- User can upload via drag-and-drop or file picker button
- App accepts `.csv` files only; shows a clear error for any other format
- App parses the CSV and extracts one summary row per employee automatically
- Parsing happens client-side display and server-side processing
- If the file cannot be parsed (wrong format, empty, corrupt), a friendly error message is shown with guidance
- Upload triggers no DB interaction

---

### US-02 — Select quincena
**As a** payroll user,
**I want to** select the pay period (quincena) after uploading,
**So that** each employee record is tagged to the correct payroll period before submission.

**Acceptance criteria:**
- After upload, a banner/prompt appears above the data grid
- User selects Quincena 1 or Quincena 2 via a toggle (not a free-text field)
- **Single-month file:** Month and year are auto-derived from the CSV dates and displayed as read-only (e.g. `Diciembre 2025`)
- **Multi-month file:** When the CSV dates span two calendar months, a month selector appears in the banner showing only the months present in the file (e.g. `Noviembre 2025` / `Diciembre 2025`). User selects one. The selected month is applied to all rows.
- Year is always derived from the file — never editable
- User cannot proceed to submit without selecting a quincena (and a month, if the selector is shown)
- Selections can be changed before submission

---

### US-03 — Review and edit data in grid
**As a** payroll user,
**I want to** see and edit the extracted employee summary data in a spreadsheet-like view,
**So that** I can correct any parsing errors before submitting to the database.

**Acceptance criteria:**
- Grid displays one row per employee with columns: Código Empleado, Días no laborados, Horas extras simples, Horas extras dobles
- Mes and Año are shown as read-only derived columns
- All numeric fields are editable inline
- Changes are reflected immediately without saving/refreshing
- Editable cells are visually distinct from read-only cells

---

### US-04 — Validate data
**As a** payroll user,
**I want to** see validation errors highlighted before I submit,
**So that** I don't accidentally send bad data to the database.

**Acceptance criteria:**
- Validation runs automatically after upload and after any cell edit
- Invalid cells are highlighted in red with an inline tooltip explaining the error
- Rows with any invalid cell are highlighted with a red row indicator
- A summary banner shows total error count (e.g. "3 errores encontrados")
- Submit button is disabled while any validation error exists
- Validation rules are defined in `config/validation-rules.json`

---

### US-05 — Duplicate detection
**As a** payroll user,
**I want to** be warned if a record already exists in the database,
**So that** I don't accidentally submit payroll data twice for the same employee and period.

**Acceptance criteria:**
- Before submission, the app checks each row against the DB for duplicates (`Codigo Empleado + Quincena + Mes + Año`)
- Duplicate rows are flagged with a distinct visual indicator (yellow/amber, different from validation errors)
- A banner explains what a duplicate means and that those rows will be blocked
- Duplicate rows are excluded from submission automatically — they cannot be overridden
- Non-duplicate rows in the same file can still be submitted

---

### US-06 — Submit data
**As a** payroll user,
**I want to** submit the valid, non-duplicate rows to the database,
**So that** payroll is processed correctly for this period.

**Acceptance criteria:**
- Submit button is only active when: quincena is selected AND no validation errors exist
- On submit, a loading indicator is shown
- On success: a confirmation screen shows the number of rows submitted successfully
- On partial success (some rows failed at DB level): show which rows succeeded and which failed with reason
- On full failure: show a clear error message; no data is left in an unknown state
- After submission, user can start a new upload

---

### US-07 — Empty state
**As a** payroll user launching the app for the first time (or after a completed upload),
**I want to** see a clear starting point,
**So that** I immediately understand what to do.

**Acceptance criteria:**
- Empty state shows the app name, a brief one-line description, and a prominent upload button
- No grid, no banners, no distracting elements before a file is loaded

---

## 4. Out of Scope

- User authentication / login
- Managing or editing validation rules within the app
- Viewing historical submissions
- Editing the stored procedure or DB schema from the app
- Multi-user / concurrent access
- Undo/redo beyond cell-level editing

---

## 5. Decisions Log

| # | Question | Decision |
|---|---|---|
| 1 | What exactly defines a "double overtime" hour vs. simple — is this in the data or always 0? | Dobles is a real column that may be non-zero in future files. Always parse it — empty or missing maps to 0, present value converts from HH:MM:SS to rounded integer hours. |
| 2 | Should the confirmation screen be printable / exportable? | No — out of scope. |
