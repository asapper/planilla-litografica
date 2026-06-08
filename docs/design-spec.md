# UI/UX Design Specification
**Owner:** Nico Bianchi — UI/UX Designer
**Status:** Phase 0 Draft
**Last updated:** 2026-04-21

---

## 1. Design Principles

1. **One thing at a time.** Each screen has a single primary action. No competing calls to action.
2. **Never surprise the user.** Every state change is explained. Loading, errors, and success are always communicated.
3. **Errors are never the user's fault.** Error messages describe what happened and what to do — not what the user did wrong.
4. **Spanish-first.** All UI copy is in Spanish. Non-technical users should never see an English word.

---

## 2. Application Shell

- **Window size:** Minimum `1024 × 680px`, resizable
- **Tauri frame:** Native title bar, standard window controls
- **Layout:** Single-page application — no routing, no navigation menu
- **Font:** System default (ensures readability on Windows without font loading)
- **Color mode:** Light mode only for v1

---

## 3. Core States

The app has five distinct visual states. Only one is active at a time.

---

### State 1 — Empty (Initial)

Shown on launch and after a successful submission is completed.

**Layout:**
- Centered card in the viewport
- App name: `Cargador de Planilla`
- Subtitle: `Sube tu archivo CSV para comenzar`
- Large upload button: `Seleccionar archivo` with a secondary drag-and-drop zone below it
- Drag-and-drop zone shows a dashed border and an upload icon; on hover it fills with a light tint

**No grid. No banners. Nothing else.**

---

### State 2 — Loaded / Editing

Shown after a CSV is successfully parsed.

**Layout — top to bottom:**
1. **File badge** — shows filename and number of employees found (e.g. `planilla.csv — 24 empleados`)
2. **Quincena selector banner** — amber/yellow background to draw attention:
   - Label: `Selecciona la quincena para esta carga`
   - Toggle: `Quincena 1` / `Quincena 2` (pill toggle, not a dropdown)
   - **Single-month file:** Read-only month/year display: `Diciembre 2025` (derived, not editable)
   - **Multi-month file:** Month selector appears as a second pill toggle showing only the months found in the file (e.g. `Noviembre 2025` / `Diciembre 2025`). User must pick one before proceeding.
   - Year is always read-only and derived from the file
   - Until quincena is selected (and month, if selector is shown), submit is disabled and the banner pulses gently
3. **AG Grid** — see Section 4 for grid spec
4. **Action bar** (sticky bottom):
   - Left: error/warning summary badge (hidden when none)
   - Right: `Validar` button (disabled until quincena selected and no errors)

---

### State 3 — Validation Errors Present

Same layout as State 2. Grid reflects errors.

- **Invalid cell:** Red background tint + red border. Tooltip on hover with error message in Spanish.
- **Invalid row:** Red left border on the row
- **Duplicate row:** Amber/yellow left border + amber cell tint. Tooltip: `Este empleado ya fue cargado para este período`
- **Action bar badge:** `X errores · Y duplicados` in red/amber

---

### State 4 — Submitting

- Submit button replaced by a spinner: `Enviando...`
- Grid becomes read-only (no editing while submitting)
- Quincena selector locked
- No cancel option (submissions are atomic)

---

### State 5 — Result

Shown after submission completes (success or failure).

**Success:**
- Green checkmark icon
- Heading: `Carga completada`
- Body: `Se enviaron X registros correctamente.`
- If duplicates were skipped: `Y registros omitidos por duplicado.`
- Button: `Nueva carga` → returns to State 1

**Partial failure:**
- Orange warning icon
- Heading: `Carga completada con errores`
- Body: `X registros enviados. Y registros fallaron.`
- Expandable list showing which employees failed and why
- Button: `Nueva carga`

**Full failure:**
- Red X icon
- Heading: `Error al enviar`
- Body: Friendly description of what went wrong (connection, DB error, etc.)
- Button: `Intentar de nuevo` → returns to State 2 (data preserved)

---

## 4. AG Grid Specification

### Columns

| Column | Header (ES) | Type | Editable | Width |
|---|---|---|---|---|
| `codigo_empleado` | Código | String | No | 80px |
| `nombre_empleado` | Nombre | String | No | 220px |
| `dias_no_laborados` | Días no laborados | Integer | Yes | 130px |
| `horas_extras_simples` | H. Extra Simples | Integer | Yes | 130px |
| `horas_extras_dobles` | H. Extra Dobles | Integer | Yes | 130px |
| `mes` | Mes | Integer | No | 60px |
| `anio` | Año | Integer | No | 70px |

### Grid behavior
- **Row height:** 40px
- **Header height:** 48px
- **Editable cells:** Lighter background to signal editability
- **Read-only cells:** No visual affordance for clicking
- **Cell validation:** Runs on blur (after user finishes editing a cell)
- **AG Grid edition:** Community — no Enterprise features required for this feature set

---

## 5. Visual Language — Validation States

| State | Left border | Cell background | Badge color |
|---|---|---|---|
| Valid | None | White | — |
| Invalid | `#DC2626` (red) | `#FEF2F2` (light red) | Red |
| Duplicate | `#D97706` (amber) | `#FFFBEB` (light amber) | Amber |
| Submitting | — | Dimmed (opacity 0.6) | — |

---

## 6. Copy Guidelines

- All labels, buttons, and messages in **Spanish**
- Avoid technical terms (`CSV parsing`, `stored procedure`, `JDBC`) — users never see these
- Error messages follow the pattern: what happened + what to do
  - Bad: `Error: null reference at row 4`
  - Good: `No se pudo leer el archivo. Verifica que el formato sea correcto e intenta de nuevo.`
- Quincena is always written as `Quincena 1` or `Quincena 2`, never `Q1`/`Q2`

---

# TAS Format — UI/UX Extension

**Owner:** Nico Bianchi — UI/UX Designer
**Status:** Phase 0 Draft
**Last updated:** 2026-06-06

This section extends the base design spec for the TAS biometric file format. All design principles and visual language from Sections 1–6 apply unchanged.

---

## 7. App Navigation

The app gains a persistent **top navigation bar** visible in all states. Two tabs:

| Tab | Label | Icon |
|---|---|---|
| Upload | `Planilla` | Upload icon |
| Config | `Configuración` | Settings gear icon |

- Active tab is underlined/highlighted.
- The `Configuración` tab is always accessible — users can navigate to it at any time (with unsaved-changes guard if applicable).
- The nav bar is always visible — it renders unconditionally regardless of upload state. On State 1 (empty), the upload card appears below the nav bar as the only content.

---

## 8. TAS Upload Flow

The TAS upload replaces the base Loaded/Editing state (base State 2, the AG Grid) with a fully automated processing pipeline. The six TAS states below are specific to TAS files and do not map 1-to-1 to the base spec state numbers.

---

### State 1 — Empty (TAS variant)

Identical to the base spec. Upload card copy:
- Heading: `Cargador de Planilla`
- Subtitle: `Sube tu archivo TAS para comenzar`
- Button: `Seleccionar archivo`
- Drag-and-drop zone: same as base spec

---

### State 2 — Processing

Shown immediately after file selection while the backend parses and processes the TAS file.

**Layout:**
- File badge: `archivo.csv — procesando...` with a spinner
- Progress message (single line, updates as phases complete):
  1. `Leyendo archivo...`
  2. `Agrupando sesiones de trabajo...`
  3. `Verificando feriados...` (shows if API fetch is in progress)
  4. `Calculando horas...`
- No cancel option — processing is fast and non-destructive

**Holiday API failure banner** (shown non-blocking if API failed and bundled list was used):
> *"No se pudo verificar el calendario de feriados en línea. Se usó la lista incluida en la aplicación. Revise la configuración si falta algún feriado."*

Banner style: amber background, info icon, inline link to `Configuración → Feriados`. Dismissable with an × button.

---

### State 3 — Reactivation Review

Shown **before** the verification screen if any `inactive` employees have scans in the file.

**Layout:**
- Heading: `Empleados inactivos detectados`
- Subheading: `Los siguientes empleados están marcados como inactivos pero aparecen en el archivo. Decide qué hacer con cada uno.`
- Table:

| Column | Content |
|---|---|
| Nombre | Employee name |
| ID | Employee ID |
| Sesiones en el archivo | Count of sessions found |
| Acción | Pill toggle: `Reactivar y enviar` (green) / `Ignorar` (gray) |

- All rows default to `Ignorar`.
- Employees set to `Ignorar` are excluded from the submission — their scan data is not sent to the backend. They will appear in this screen again on the next upload if they still have scans in the file.
- **Action bar (sticky bottom):**
  - Right: `Continuar →` button (always enabled — user may ignore all)

No "ignore forever" option exists. This screen is always shown when inactive employees appear.

---

### State 4 — Verification Screen

Shown before final submission when any sessions are flagged. Mandatory — no session may remain unresolved.

**Layout:**
- Heading: `Verificación de marcaciones`
- Subheading: `Revisa y completa la información de las marcaciones con problemas antes de enviar.`
- **Filter chips** (top): `Todos` · `Falta entrada` · `Falta salida` · `Cambio de turno` · `Excepción de turno` · `Corte de período` · `Doble sesión`
- Count badge per chip showing how many items match

**Per-item card layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│  [Employee name]                    [Date]          [Flag type] │
│                                                                  │
│  Turno asignado: Mañana (07:00 – 15:00)                         │
│                                                                  │
│  Marcaciones conocidas:  07:02  ·  09:45  ·  10:05  ·  15:03   │
│                                                                  │
│  Entrada:  [  07:02  ]    Salida:  [________]                    │
│            (read-only)             (required)                    │
│                                                                  │
│  Horas calculadas:  — (pendiente)         [✓ Confirmar]          │
└─────────────────────────────────────────────────────────────────┘
```

**Flag type badges (top-right of card):**

| Flag | Badge color | Label |
|---|---|---|
| Missing entry | Red | `Falta entrada` |
| Missing exit | Red | `Falta salida` |
| Shift mismatch — consistent | Amber | `Cambio de turno` |
| Shift mismatch — per-day | Amber | `Excepción de turno` |
| Period cutoff | Gray | `Corte de período` |
| Same-day double session | Amber | `Doble sesión` |

**Shift mismatch (consistent quincena) — extra UI:**

Below the card, a suggestion banner:
> *"Las marcaciones de [nombre] corresponden al turno [Tarde] en toda la quincena. ¿Desea actualizar su turno asignado?"*
> `[Sí, actualizar turno]` · `[No, mantener como está]`

Only one of these appears per employee (not per day). Decision is applied on submit.

**Time inputs:**
- Format: `HH:MM` (24-hour), enforced via masked input
- Pre-filled where the scan is known (read-only)
- Empty where the scan is missing (required before confirm)
- After both times are entered: `Horas calculadas: 7.5h` updates live

**Confirm button:**
- Grayed out until both entry and exit are filled
- Once confirmed, card collapses into a single summary row (green left border)
- Confirmed rows are still expandable to re-edit

**Action bar (sticky bottom):**
- Left: `X por resolver` badge in red (hidden when all confirmed)
- Right: `Enviar` button — disabled until all items confirmed

---

### State 5 — Submitting

Same as base spec. Copy: `Enviando...`

---

### State 6 — Result

Same structure as base spec. Extended with a Not-Present Review step when active employees had zero scans.

**Success flow with not-present employees:**

After the success card:
- Heading: `Carga completada`
- Body: `Se enviaron X registros. Y empleados activos no tuvieron marcaciones en este período.`
- Two buttons:
  - `Revisar empleados sin marcaciones →` (primary, if Y > 0)
  - `Nueva carga` (secondary)

If user clicks `Revisar empleados sin marcaciones`:

**Not-Present Review panel** (full-screen overlay, not a new state):

- Heading: `Empleados sin marcaciones`
- Subheading: `Estos empleados activos no aparecieron en el archivo de este período. Puede marcarlos como inactivos si ya no trabajan en la empresa.`
- Table:

| Column | Content |
|---|---|
| Nombre | Employee name |
| ID | Employee ID |
| Último período con marcaciones | Last seen quincena/month |
| Estado | `Activo` toggle → click to set `Inactivo` |

- Brand-new employees (first-ever appearance) are never shown here.
- Per-row `Estado` toggles save immediately (optimistic, per-row API call — no explicit save button).
- **Footer:** `Cerrar` dismisses the overlay and returns to the success card.

---

## 9. Config Page

Accessible via the `Configuración` tab. Four tabs within the page.

**Shell:**
- Page heading: `Configuración`
- Tab bar: `Turnos` · `Empleados` · `Feriados` · `General`
- Sticky footer on each tab: `Guardar cambios` button (disabled when no changes) + `Descartar` link
- Unsaved-changes guard: if user navigates away with unsaved changes, a modal appears:
  > *"Tienes cambios sin guardar. ¿Deseas descartarlos?"*
  > `[Descartar cambios]` · `[Seguir editando]`
- On save: success toast (bottom-right, 3s, green): `Cambios guardados`
- On save error: inline error message below the save button

---

### Tab 1 — Turnos

**Purpose:** Manage the shifts used for session detection and hours classification.

**Layout:**
- Table with inline add/edit/delete:

| Column | Type | Notes |
|---|---|---|
| Nombre | Text input | e.g., `Mañana` |
| Inicio | Time input (HH:MM) | e.g., `07:00` |
| Fin | Time input (HH:MM) | e.g., `15:00` |
| Turno de madrugada | Checkbox | Auto-detected when endTime < startTime; shown read-only as indicator |
| — | Delete button | See rules below |

- `+ Agregar turno` row at the bottom (inline form, not a modal)
- Cross-midnight indicator: if `endTime < startTime`, a moon icon appears in the Turno nocturno column (non-editable)
- **Delete rules:**
  - Shift has active employees → blocked. Alert: *"Este turno está asignado a [N] empleado(s) activo(s). Reasígnalos antes de eliminarlo."*
  - Shift has only inactive employees → allowed. Their shift assignment is cleared silently.
- Pre-loaded defaults (Mañana, Tarde, Noche) are deletable.

---

### Tab 2 — Empleados

**Purpose:** View and manage the employee registry.

**Layout:**
- Search bar: placeholder `Buscar por nombre o código`
- Filter row: `Todos` · `Activos` · `Inactivos` (pill toggles) + `Turno:` dropdown (all shifts + "Sin turno")
- Bulk action bar (appears when ≥1 row selected): `Asignar turno: [dropdown]` `Aplicar`
- Table:

| Column | Type | Editable |
|---|---|---|
| Código | String | No |
| Nombre | String | No |
| Turno asignado | Dropdown (all configured shifts) | Yes — inline |
| Activo | Toggle switch | Yes — inline |

- No "add employee" button. A note below the table: *"Los empleados se agregan automáticamente al subir un archivo TAS."*
- Reactivating an employee who has no shift assigned → auto-assigns Mañana + shows inline indicator: *"Turno restablecido al turno por defecto. Verifique si corresponde."* (amber, inline, dismissable per row)

---

### Tab 3 — Feriados

**Purpose:** View and edit the public holiday calendar.

**Layout:**
- Year selector: `< 2025  2026  2027 >` (pill nav, current year default)
- `Actualizar desde internet` button (top-right):
  - On click: spinner inside button, disabled during fetch
  - On success: `Actualizado` (green check, 2s) → reverts to button
  - On failure: inline error: *"No se pudo actualizar. Revise su conexión e intente de nuevo."*
  - Description below: *"Descarga el calendario oficial de feriados de Guatemala desde internet. Los feriados agregados manualmente no serán reemplazados."*
- Table:

| Column | Type | Notes |
|---|---|---|
| Fecha | Date (read-only) | Formatted: `Lunes 1 de enero` |
| Nombre | String | Read-only for all entries |
| Fuente | Badge | `API` (blue) or `Manual` (gray) |
| — | Delete button | Confirmation required: *"¿Eliminar [nombre] del [fecha]?"* · `[Eliminar]` · `[Cancelar]` |

- `+ Agregar feriado` button below table → inline form: date picker + name field

---

### Tab 4 — General

**Purpose:** Global payroll constants.

**Layout:**
- Single field group, clean form:

| Field | Label | Input | Default | Help text |
|---|---|---|---|---|
| `legalBreakAllowance` | Tiempo de descanso no deducible | Number input + `minutos` label | `45` | *"Tiempo de descanso diario que no se descuenta de las horas trabajadas. Mandato legal: 15 min refacción + 30 min almuerzo."* |

- Save button follows the same tab-level save pattern.
- Changes apply to **future uploads only** — a note below the field: *"Los cambios aplican a partir del próximo archivo subido."*

---

## 10. Empty States

| Screen | Empty state message |
|---|---|
| Verification Screen (no flags) | Never shown — skipped automatically |
| Not-Present Review (no absences) | Never shown — skipped automatically |
| Config → Empleados (no employees yet) | `"Aún no hay empleados registrados. Sube un archivo TAS para comenzar."` |
| Config → Feriados (no holidays for year) | `"No hay feriados registrados para este año. Usa el botón 'Actualizar desde internet' para cargarlos."` |

---

## 11. Visual Language Additions

| Element | Style |
|---|---|
| Verification card — unresolved | White background, amber left border (`#D97706`) |
| Verification card — resolved | White background, green left border (`#16A34A`) |
| Shift mismatch banner | Amber background (`#FFFBEB`), amber border |
| Not-present review overlay | White overlay, 80% backdrop dimming |
| Reactivation row — default `Ignorar` | Gray pill |
| Reactivation row — `Reactivar y enviar` | Green pill (`#16A34A`) |
| Config tab active indicator | Bottom border `#2563EB` (blue), matching action bar button color |
| `Fuente: API` badge | Blue (`#EFF6FF` bg, `#2563EB` text) |
| `Fuente: Manual` badge | Gray (`#F3F4F6` bg, `#6B7280` text) |
