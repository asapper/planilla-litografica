# Guía de Smoke Tests — TAS CSV Upload

Cada archivo CSV simula un escenario distinto. Todos usan fechas de **julio 2026** (quincena 1 = días 1–15, quincena 2 = días 16–31).

> **Prerequisito:** Antes de cada test, asegúrate de que los empleados que necesitan un turno específico ya estén configurados en la base de datos con ese turno asignado. Los empleados nuevos (IDs que no existen) se crean automáticamente con turno **Mañana**.

---

## 01 — Happy Path Mañana
**Archivo:** `01-happy-path-manana.csv`
**Empleado:** Lopez Maria (ID 100)
**Turno asignado:** Mañana (07:00–15:00)

**Qué esperar:**
- Quincena 1: ~11 días laborados, todos con turno Mañana
- 0 sesiones flaggeadas, 0 turnos estimados
- Día 1 tiene 4 marcaciones (con almuerzo): entrada 06:58, almuerzo 12:00–12:45, salida 15:02
- Horas extras simples: las que excedan 8h por día
- Sin alertas ni pills

---

## 02 — Happy Path Tarde
**Archivo:** `02-happy-path-tarde.csv`
**Empleado:** Ramirez Carlos (ID 101)
**Turno asignado:** Tarde (15:00–23:00)

**Qué esperar:**
- Quincena 1: ~13 días laborados, todos con turno Tarde
- 0 sesiones flaggeadas, 0 turnos estimados
- Ventana de detección: [14:00, 15:10] — entradas a las 14:50-15:05 deben matchear
- Sin alertas

---

## 03 — Noche (Cross-Midnight)
**Archivo:** `03-noche-cross-midnight.csv`
**Empleado:** Hernandez Pedro (ID 102)
**Turno asignado:** Noche (19:00–07:00, cross-midnight)

**Qué esperar:**
- Cada sesión cruza medianoche (entrada ~19:00, salida ~07:00 del día siguiente)
- Ventana de detección: [18:00, 19:50]
- Las sesiones se anclan en la fecha de entrada
- Posible flag START_CUTOFF o END_CUTOFF si la primera/última sesión está en el borde del reporte
- ~10 sesiones en quincena 1

---

## 04 — Missing Entry / Missing Exit
**Archivo:** `04-missing-entry-exit.csv`
**Empleado:** Diaz Sofia (ID 103)
**Turno asignado:** Mañana

**Qué esperar:**
- **Jul 1:** Normal (07:00–15:00) ✓
- **Jul 2:** Solo salida a las 15:05 → flag **MISSING_ENTRY** (needsResolution=true)
- **Jul 3:** Solo entrada a las 07:02 → flag **MISSING_EXIT** (needsResolution=true)
- **Jul 4:** Solo entrada a las 06:55 → flag **MISSING_EXIT** (needsResolution=true)
- **Jul 6–7:** Normales ✓
- Debe aparecer en la lista de sesiones flaggeadas para resolución manual
- 3 sesiones con flags de bloqueo

---

## 05 — Best-Fit / Turno Estimado
**Archivo:** `05-best-fit-estimated-shift.csv`
**Empleado:** Torres Juan (ID 104)
**Turno asignado:** Mañana

**Qué esperar:**
- **Jul 1:** Normal Mañana (07:00–15:00) ✓
- **Jul 2:** Entrada 10:30, salida 18:30 — fuera de TODAS las ventanas de detección → flag **BEST_FIT_SHIFT**, se asigna el turno más cercano automáticamente
- **Jul 3:** Normal Mañana ✓
- **Jul 4:** Entrada 12:00, salida 20:00 — fuera de ventanas → flag **BEST_FIT_SHIFT**
- **Pill:** "2 turno est." en la fila del empleado
- **Detalle:** Las filas Jul 2 y Jul 4 deben tener fondo amarillo tenue y badge "est." junto al nombre del turno
- **Alerta:** "2 día(s) con turno estimado"

---

## 06 — Shift Mismatch
**Archivo:** `06-shift-mismatch.csv`
**Empleado:** Vargas Elena (ID 105)
**Turno asignado:** Mañana

**Qué esperar:**
- **Jul 1:** Normal Mañana ✓
- **Jul 2:** Entrada 14:55 → cae en ventana de Tarde, no de Mañana → flag **SHIFT_MISMATCH** (needsResolution=true)
- **Jul 3:** Normal Mañana ✓
- **Jul 4:** Entrada 14:50 → flag **SHIFT_MISMATCH** (needsResolution=true)
- 2 sesiones flaggeadas que requieren resolución manual (reasignar turno o ignorar)

---

## 07 — Overtime (Simples y Dobles)
**Archivo:** `07-overtime-simples-dobles.csv`
**Empleado:** Morales Diego (ID 106)
**Turno asignado:** Mañana (8h shift)

**Qué esperar:**
- **Jul 1:** 07:00–17:30 = ~10.5h → ~2.5h extras simples (exceden 8h turno)
- **Jul 2:** 07:00–19:00 = 12h → ~4h extras simples
- **Jul 3:** 07:00–15:00 = 8h → 0 extras
- **Jul 5:** Sábado, 07:00–15:00 = 8h → día normal (sábado no es especial)
- **Jul 6:** Domingo, 07:00–17:00 = 10h → TODAS las horas son **dobles** (día especial)
- Verificar que las columnas Simp. y Dobl. reflejan correctamente

---

## 08 — Duplicate Scans (Deduplication)
**Archivo:** `08-duplicate-scans.csv`
**Empleado:** Castro Laura (ID 107)
**Turno asignado:** Mañana

**Qué esperar:**
- **Jul 1:** 5 marcaciones entre 07:00–07:04 → deduplicadas (ventana de 5 min), queda solo 07:00. Salida 15:00 + 15:02 → queda 15:00. Sesión normal 07:00–15:00
- **Jul 2:** 06:58, 06:59, 07:02 → 06:58 se queda, 06:59 se elimina (1 min < 5 min), 07:02 se elimina (4 min < 5 min). Salida 15:00, 15:01 → queda 15:00
- Ambos días deben verse como sesiones normales con 2 marcaciones efectivas
- 0 flags

---

## 09 — Short Day (Salida Temprana)
**Archivo:** `09-short-day.csv`
**Empleado:** Rios Andrea (ID 108)
**Turno asignado:** Mañana (termina a las 15:00)

**Qué esperar:**
- **Jul 1:** 07:00–13:00 = 6h → salida 2h antes del fin de turno → flag **SHORT_DAY**
- **Jul 2:** 07:00–12:30 = 5.5h → salida 2.5h antes → flag **SHORT_DAY**
- **Jul 3:** 07:05–15:00 = normal ✓
- SHORT_DAY **no** bloquea resolución (needsResolution=false)
- El empleado aparecerá en la lista de revisión, no en la de flaggeados

---

## 10 — Sunday / Holiday (Horas Dobles)
**Archivo:** `10-sunday-holiday-dobles.csv`
**Empleado:** Flores Roberto (ID 109)
**Turno asignado:** Mañana

**Qué esperar:**
- **Jul 5 (Domingo):** 07:00–15:00 = 8h → TODAS son **horas dobles**
- **Jul 12 (Domingo):** 07:00–15:00 = 8h → TODAS son **horas dobles**
- **Jul 6 (Lunes):** 07:00–15:00 = 8h → 0 extras (día normal, turno completo)
- Total dobles = ~16h (de los dos domingos)
- Si hay feriados configurados en la BD para esas fechas, esas horas también serán dobles

---

## 11 — Multi-Empleado Mixed Shifts
**Archivo:** `11-multi-employee-mixed.csv`
**Empleados:**
- Perez Ana (ID 110) — turno Mañana
- Garcia Luis (ID 111) — turno Tarde
- Martinez Rosa (ID 112) — turno Noche

**Qué esperar:**
- 3 empleados aparecen en la lista de revisión
- Cada uno con sus sesiones correctamente agrupadas por turno
- Martinez Rosa tiene sesiones cross-midnight (19:00→07:00)
- Perez Ana y Garcia Luis tienen sesiones normales
- Verificar navegación entre empleados en la vista de detalle (botones anterior/siguiente)

---

## 12 — Quincena Boundary (Cross-Period)
**Archivo:** `12-quincena-boundary.csv`
**Empleado:** Ortiz Miguel (ID 113)
**Turno asignado:** Mañana

**Qué esperar:**
- Jul 14–15: Quincena 1
- Jul 16–17: Quincena 2
- Al seleccionar Quincena 1: solo se muestran Jul 14 y Jul 15
- Al seleccionar Quincena 2: solo se muestran Jul 16 y Jul 17
- Verificar que los totales de cada quincena son independientes

---

## 13 — Break Scans (Almuerzo con Deducción)
**Archivo:** `13-with-break-scans.csv`
**Empleado:** Reyes Carmen (ID 114)
**Turno asignado:** Mañana

**Qué esperar:**
- **Jul 1:** 4 marcaciones — 07:00, 12:00, 12:30, 15:00. Break = 30 min. Deducción = max(0, 30-45) = 0 → 8h trabajadas
- **Jul 2:** 4 marcaciones — 07:00, 11:30, 13:00, 15:00. Break = 90 min. Deducción = max(0, 90-45) = 45 min → 7.5h trabajadas (span 8h - 45min deducible)
- **Jul 3:** 4 marcaciones — 07:00, 12:00, 14:00, 15:00. Break = 120 min. Deducción = max(0, 120-45) = 75 min → ~6.5h
- Expandir marcaciones en detalle para verificar que las 4 scans aparecen

---

## 14 — Noche Cross-Midnight en Borde de Reporte
**Archivo:** `14-noche-cross-midnight-cutoff.csv`
**Empleado:** Gutierrez Pablo (ID 115)
**Turno asignado:** Noche

**Qué esperar:**
- **Jul 1:** Primera sesión del reporte, 19:00→07:00 — posible flag **START_CUTOFF** si es el inicio del reporte
- **Jul 2–3:** Normal noche ✓
- **Jul 15:** Entrada 19:00, salida Jul 16 07:00 — la sesión cruza el borde quincena 1→2 → posible flag **END_CUTOFF**
- Verificar que las sesiones de borde se manejan correctamente en cada quincena

---

## 15 — Grace Period Edge Cases
**Archivo:** `15-grace-period-edge.csv`
**Empleado:** Mendez Lucia (ID 116)
**Turno asignado:** Mañana (07:00)

**Qué esperar (effectiveStart):**
- **Jul 1:** Entrada 07:00 (exacto) → effectiveStart = 07:00 (dentro de gracia) → 8h
- **Jul 2:** Entrada 07:10 (exacto en borde de 10 min gracia) → effectiveStart = 07:00 → 8h
- **Jul 3:** Entrada 07:11 (1 min fuera de gracia) → effectiveStart = 07:11 → ~7.5h
- **Jul 4:** Entrada 07:30 (30 min tarde) → effectiveStart = 07:30 → 7.5h
- Verificar que las horas trabajadas reflejan la diferencia entre estar dentro o fuera del periodo de gracia

---

## 16 — Same Day Double Shift (SAME_DAY_DOUBLE)
**Archivo:** `16-same-day-double-shift.csv`
**Empleado:** Navarro Oscar (ID 117)
**Turno asignado:** Mañana

**Qué esperar:**
- **Jul 1:** 4 marcaciones — 07:00 (Mañana entry), 15:00 (Mañana exit), 15:05 (Tarde entry), 23:00 (Tarde exit)
- Dos sesiones distintas en el mismo día con turnos diferentes → flag **SAME_DAY_DOUBLE** (needsResolution=true)
- **Jul 2:** Normal ✓
- 1 o 2 sesiones flaggeadas para Jul 1

---

## 17 — Empleado Nuevo (Auto-Creación)
**Archivo:** `17-new-employee.csv`
**Empleado:** NuevoEmpleado Test (ID 999) — **NO existe en la BD**

**Qué esperar:**
- El empleado se crea automáticamente con turno Mañana, activo, accruesOvertime=true
- 2 sesiones normales sin flags
- Verificar que aparece en la lista de revisión como cualquier otro empleado

---

## Checklist General de Verificación

Para cada archivo, verificar:
- [ ] La carga del CSV no muestra errores
- [ ] El selector de quincena funciona correctamente
- [ ] La pill "turno est." aparece cuando corresponde
- [ ] Al hacer click en un empleado, la vista de detalle muestra:
  - [ ] Las sesiones correctas para la quincena seleccionada
  - [ ] Marcaciones expandibles
  - [ ] Badge "est." con fondo amarillo en filas de turno estimado
  - [ ] Alerta "X día(s) con turno estimado" cuando aplica
  - [ ] Horas extras correctas (Simp. y Dobl.)
  - [ ] Totales de quincena correctos
- [ ] Las sesiones flaggeadas aparecen para resolución
- [ ] Navegación entre empleados funciona (anterior/siguiente)
