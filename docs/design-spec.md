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
