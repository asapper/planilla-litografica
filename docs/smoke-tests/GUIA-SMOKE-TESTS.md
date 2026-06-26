# Guía de Smoke Tests — TAS CSV Upload

Cada archivo CSV simula un escenario distinto. Todos usan fechas de **julio 2026** (quincena 1 = días 1–15, quincena 2 = días 16–31).

> **Calendario julio 2026:**
> ```
>  Lu  Ma  Mi  Ju  Vi  Sá  Do
>           1   2   3   4   5
>   6   7   8   9  10  11  12
>  13  14  15  16  17  18  19
>  20  21  22  23  24  25  26
>  27  28  29  30  31
> ```
> Sábados: 4, 11, 18, 25 · Domingos: 5, 12, 19, 26

> **Prerequisito:** Antes de cada test, asegúrate de que los empleados que necesitan un turno específico ya estén configurados en la base de datos con ese turno asignado. Los empleados nuevos (IDs que no existen) se crean automáticamente con turno **Mañana**.

> **Conexión a DB:** La app funciona localmente **sin acceso a PostgreSQL**. Toda la lógica TAS (turnos, empleados, feriados, config) usa H2 (embebido, se crea automáticamente). PostgreSQL solo se usa para el submit final a planilla y el health check de DB — esos fallarán pero no bloquean el flujo de smoke test.

> **Auto-resolución de SHIFT_MISMATCH:** El backend busca sesiones que tengan **únicamente** el flag SHIFT_MISMATCH (sin otros flags). Si todas esas sesiones "puras" apuntan al mismo turno detectado, se auto-resuelven (swap de turno + recálculo). Las sesiones normales o con otros flags no se consideran — solo se necesita consistencia entre las sesiones con SHIFT_MISMATCH puro. Empleados nuevos se crean con turno **Mañana** por defecto, así que si trabajan en Tarde o Noche, todas sus sesiones serán SHIFT_MISMATCH consistente → auto-resolución → saltan verificación.

---

## Turnos seeded (referencia)

| ID       | Nombre | Inicio | Fin   | Cross-midnight | Ventana detección         |
|----------|--------|--------|-------|----------------|---------------------------|
| manana   | Mañana | 07:00  | 15:00 | No             | [06:00, 07:10]            |
| tarde    | Tarde  | 15:00  | 23:00 | No             | [14:00, 15:10]            |
| noche    | Noche  | 19:00  | 07:00 | Sí             | [18:00, 19:50]            |

**Periodo de gracia:** 10 minutos desde inicio de turno.
**Deducción de almuerzo:** break > 45 min → se descuenta lo que exceda los 45 min legales.
**Dedup:** marcaciones del mismo empleado con diferencia >= 5 min se mantienen; las que están a < 5 min del último scan conservado se eliminan.
**roundToHalfHour:** `floor(minutes / 30) / 2` — siempre redondea hacia abajo al 0.5h más cercano.
**Horas extras:** Los campos `horasExtrasSimples` y `horasExtrasDobles` son decimales (soportan 0.5). Tanto el detalle como el resumen muestran el mismo valor.
**Días no laborados:** Se calculan sobre la **quincena completa** (Q1: Jul 1–15 = 13 días no-domingo; Q2: Jul 16–31 = 14 días no-domingo), no solo sobre las fechas del reporte. Los días sin scans dentro de la quincena se cuentan como no laborados (excluyendo domingos y feriados).

---

## 01 — Happy Path Mañana
**Archivo:** `01-happy-path-manana.csv`
**Empleado:** Lopez Maria (ID 100)
**Turno asignado:** Mañana (07:00–15:00)

### Pre-requisito
- Empleado 100 debe existir con turno Mañana, o será creado automáticamente con Mañana (que es el default).

### Flujo esperado en la app
1. **Pantalla de inactivos:** Se salta (empleado ya existe y está activo, o se crea nuevo con activo=true)
2. **Pantalla de verificación:** Se **SALTA** — no hay sesiones con `needsResolution=true` y solo hay 1 quincena (Q1)
3. **Va directo a → Pantalla de revisión (review)**

### Datos día por día (Quincena 1)

| Fecha   | Día    | Scans                             | effectiveStart | Worked min | Worked h | Simp. | Dobl. | Flags |
|---------|--------|------------------------------------|----------------|-----------|----------|-------|-------|-------|
| Jul 1   | Miér   | 06:58, 12:00, 12:45, 15:02       | 07:00          | 482       | 8.0      | 0     | 0     | —     |
| Jul 2   | Jue    | 07:05, 15:00                      | 07:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 3   | Vie    | 06:55, 15:05                      | 07:00          | 485       | 8.0      | 0     | 0     | —     |
| Jul 4   | Sáb    | 07:00, 15:00                      | 07:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 6   | Lun    | 06:59, 15:01                      | 07:00          | 481       | 8.0      | 0     | 0     | —     |
| Jul 7   | Mar    | 07:03, 15:00                      | 07:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 8   | Miér   | 07:01, 15:02                      | 07:00          | 482       | 8.0      | 0     | 0     | —     |
| Jul 9   | Jue    | 06:57, 15:00                      | 07:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 10  | Vie    | 07:00, 15:03                      | 07:00          | 483       | 8.0      | 0     | 0     | —     |
| Jul 11  | Sáb    | 07:02, 15:00                      | 07:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 13  | Lun    | 06:58, 15:01                      | 07:00          | 481       | 8.0      | 0     | 0     | —     |
| Jul 14  | Mar    | 07:00, 15:00                      | 07:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 15  | Miér   | 07:04, 15:00                      | 07:00          | 480       | 8.0      | 0     | 0     | —     |

**Notas sobre Jul 1:** 4 scans → entry 06:58, break-out 12:00, break-in 12:45, exit 15:02. Break = 45 min. Deducción = max(0, 45-45) = 0. Span from effectiveStart (07:00) to lastScan (15:02) = 482 min. workedMinutes = 482. roundToHalfHour(482) = floor(482/30)/2 = floor(16.06)/2 = 16/2 = 8.0.

### Resumen esperado
- **Días laborados:** 13
- **Días no laborados:** 0
- **Total horas:** 104.0
- **Horas extras simples:** 0
- **Horas extras dobles:** 0
- **Sesiones flaggeadas:** 0
- **Turnos estimados:** 0
- **Pills:** ninguna

### UI esperada
- Employee row shows: 13 days, 0 no laborados, 104.0h, 0 Simp., 0 Dobl.
- No pills (no estimated shifts, no flags)
- Detail view: all 13 rows with white/normal background, shift name "Mañana"
- Jul 1 row should be expandable to show 4 scans

---

## 02 — Happy Path Tarde
**Archivo:** `02-happy-path-tarde.csv`
**Empleado:** Ramirez Carlos (ID 101)
**Turno asignado:** Tarde (15:00–23:00)

### Pre-requisito
- Empleado 101 debe existir en la BD con turno **Tarde** asignado. Si no existe, se creará con turno Mañana por defecto y todas las sesiones se detectarán como SHIFT_MISMATCH → serán **auto-resueltas** (todas apuntan consistentemente a Tarde) → turno se swapea a Tarde y las horas se recalculan.

### Flujo esperado
1. **Inactivos:** Se salta
2. **Si empleado pre-configurado con Tarde:** Verificación se **SALTA** (0 needsResolution, 1 quincena) → directo a revisión
3. **Si empleado creado como Mañana:** SHIFT_MISMATCH en las 13 sesiones, pero todas consistentes hacia Tarde → **auto-resueltas** → también salta verificación → directo a revisión

### Datos día por día (Quincena 1)

| Fecha   | Día    | Scans          | effectiveStart | Worked min | Worked h | Simp. | Dobl. | Flags |
|---------|--------|----------------|----------------|-----------|----------|-------|-------|-------|
| Jul 1   | Miér   | 14:55, 23:00   | 15:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 2   | Jue    | 15:02, 22:55   | 15:00          | 475       | 7.5      | 0     | 0     | —     |
| Jul 3   | Vie    | 14:58, 23:02   | 15:00          | 482       | 8.0      | 0     | 0     | —     |
| Jul 4   | Sáb    | 15:00, 23:00   | 15:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 6   | Lun    | 14:50, 23:05   | 15:00          | 485       | 8.0      | 0     | 0     | —     |
| Jul 7   | Mar    | 15:05, 22:58   | 15:00          | 478       | 7.5      | 0     | 0     | —     |
| Jul 8   | Miér   | 14:52, 23:00   | 15:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 9   | Jue    | 15:00, 23:01   | 15:00          | 481       | 8.0      | 0     | 0     | —     |
| Jul 10  | Vie    | 14:55, 23:00   | 15:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 11  | Sáb    | 15:03, 22:50   | 15:00          | 470       | 7.5      | 0     | 0     | —     |
| Jul 13  | Lun    | 14:58, 23:00   | 15:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 14  | Mar    | 15:00, 23:00   | 15:00          | 480       | 8.0      | 0     | 0     | —     |
| Jul 15  | Miér   | 14:55, 23:00   | 15:00          | 480       | 8.0      | 0     | 0     | —     |

**Nota sobre total de horas:** Tres días tienen salida antes del fin de turno: Jul 2 (22:55 → 7.5h), Jul 7 (22:58 → 7.5h), Jul 11 (22:50 → 7.5h). Los demás 10 días son 8.0h. Total = 10 x 8.0 + 3 x 7.5 = **102.5h**.

### Resumen esperado
- **Días laborados:** 13
- **Días no laborados:** 0
- **Total horas:** 102.5
- **Horas extras simples:** 0
- **Horas extras dobles:** 0
- **Sesiones flaggeadas:** 0

### UI esperada
- No pills, no flags, no alerts
- All 13 rows white background, shift name "Tarde"

---

## 03 — Noche (Cross-Midnight)
**Archivo:** `03-noche-cross-midnight.csv`
**Empleado:** Hernandez Pedro (ID 102)
**Turno asignado:** Noche (19:00–07:00, cross-midnight)

### Pre-requisito
- Si el empleado 102 **ya existe con turno Noche** → START_CUTOFF en Jul 1 → verificación.
- Si el empleado 102 **no existe o está con turno Mañana** (default) → todas las sesiones serán SHIFT_MISMATCH puro apuntando a Noche → auto-resolución → **skip verificación → directo a revisión**.

### Flujo esperado (con turno Mañana por defecto)
1. **Inactivos:** Se salta
2. **Verificación:** **NO** — todas las sesiones son SHIFT_MISMATCH consistente (100% apuntan a Noche) → auto-resolve → directo a revisión.
3. El turno se swapea silenciosamente a Noche. No hay pills ni indicadores de que hubo auto-resolve.

### Datos día por día

Las sesiones se anclan en la fecha de **entrada**. Cada sesión cruza medianoche.

| Fecha entrada | Scans (entrada → salida siguiente día) | Worked min | Worked h | Flags            |
|---------------|----------------------------------------|-----------|----------|------------------|
| Jul 1         | 19:05 → Jul 2 06:55                   | ~710      | 11.5     | START_CUTOFF (posible) |
| Jul 2         | 19:00 → Jul 3 07:00                   | 720       | 12.0     | —                |
| Jul 3         | 19:10 → Jul 4 06:50                   | 700       | 11.5     | —                |
| Jul 6         | 18:55 → Jul 7 07:05                   | ~730      | 12.0     | —                |
| Jul 7         | 19:00 → Jul 8 06:58                   | ~718      | 11.5     | —                |
| Jul 8         | 19:05 → Jul 9 07:00                   | ~715      | 11.5     | —                |
| Jul 9         | 19:00 → Jul 10 06:55                  | ~715      | 11.5     | —                |
| Jul 10        | 18:58 → Jul 11 07:02                  | ~724      | 12.0     | —                |
| Jul 13        | 19:00 → Jul 14 07:00                  | 720       | 12.0     | —                |
| Jul 14        | 19:05 → Jul 15 06:50                  | ~705      | 11.5     | END_CUTOFF (posible) |

**Nota START_CUTOFF:** Se activa si `session.isCrossMidnight() && session.date == reportStart`. El reporte cubre Jul 1–15. La primera sesión es Jul 1 con cross-midnight → **START_CUTOFF** se aplica. Esto **es un blocking flag** → `needsResolution=true` → la app irá a **verificación**.

**Nota END_CUTOFF:** La sesión del Jul 14 (entrada 19:05, salida Jul 15 06:50) tiene fecha Jul 14 y cruza medianoche. `reportEnd` depende de la quincena seleccionada (Jul 15 para Q1). Si `session.date == reportEnd` → END_CUTOFF. Pero `session.date` es Jul 14, no Jul 15, así que **no hay END_CUTOFF para esta sesión**.

**Importante — overtime nocturno:** Turno noche = 12h (19:00→07:00). `shiftDurationRoundedMinutes` = floor(720/30)*30 = 720 min = 12h. Overtime simples = max(0, worked - 720). Si worked ≤ 720 → 0 extras.

### Resumen esperado (con turno Mañana por defecto)
- **Sesiones:** 10
- **Días no laborados:** 3 (Jul 4 Sáb, Jul 11 Sáb, Jul 15 Mié)
- **Sesiones flaggeadas:** 0 (auto-resolved)
- **Pantalla:** **Review directo** (auto-resolve elimina todos los SHIFT_MISMATCH)
- **Nota:** Si el empleado SÍ tiene turno Noche asignado, habrá 1 sesión flaggeada (Jul 1 con START_CUTOFF) → va a verificación.

---

## 04 — Missing Entry / Missing Exit
**Archivo:** `04-missing-entry-exit.csv`
**Empleado:** Diaz Sofia (ID 103)
**Turno asignado:** Mañana

### Pre-requisito
- Empleado 103 con turno Mañana (o se crea automáticamente).

### Flujo esperado
1. **Inactivos:** Se salta
2. **Verificación:** **SÍ** — hay sesiones con `needsResolution=true`
3. Resolver los flags manualmente, luego ir a revisión

### Análisis detallado de flags

**Jul 1:** Scans 07:00, 15:00 → sesión normal, 2 scans, matched Mañana. **OK ✓**

**Jul 2:** Solo scan 15:05. ¿Cómo se agrupa?
- 15:05 cae en ventana de Tarde [14:00, 15:10] → abre sesión como Tarde con SHIFT_MISMATCH (asignado=Mañana, matched=Tarde)
- Solo 1 scan, es impar → `detectMissingScanType` usa **turno matcheado** (Tarde 15:00-23:00): distancia al start de Tarde (15:00) = |905-900| = 5; distancia al end de Tarde (23:00) = |905-1380| = 475. Más cerca del start → **MISSING_EXIT**
- Flags: **SHIFT_MISMATCH**, **MISSING_EXIT** → `needsResolution=true`

**Jul 3:** Solo scan 07:02.
- 07:02 cae en ventana de Mañana [06:00, 07:10] → abre sesión como Mañana
- Solo 1 scan, impar → `detectMissingScanType`: más cerca del start → **MISSING_EXIT**
- Flags: **MISSING_EXIT** → `needsResolution=true`

**Jul 4:** Solo scan 06:55.
- 06:55 cae en ventana de Mañana [06:00, 07:10] → abre sesión como Mañana
- Solo 1 scan, impar → más cerca del start → **MISSING_EXIT**
- Flags: **MISSING_EXIT** → `needsResolution=true`

**Jul 6:** Scans 07:00, 15:00 → normal. **OK ✓**
**Jul 7:** Scans 07:01, 15:02 → normal. **OK ✓**

### Resumen esperado
- **Total sesiones:** 6
- **Días no laborados:** 7 (quincena completa Jul 1–15 tiene 13 días no-domingo; solo 6 trabajados)
- **Sesiones flaggeadas (needsResolution):** 3 (Jul 2, Jul 3, Jul 4)
- **Sesiones normales:** 3 (Jul 1, Jul 6, Jul 7)
- **Pantalla:** Va a **verificación**

### UI esperada en verificación
- 3 filas en la lista de sesiones flaggeadas
- Jul 2: flags "SHIFT_MISMATCH" + "MISSING_EXIT" → necesita resolución manual
- Jul 3: flag "MISSING_EXIT" → necesita resolución
- Jul 4: flag "MISSING_EXIT" → necesita resolución
- Cada fila debe tener controles para resolver (reasignar turno, agregar scan manual, o ignorar)

---

## 05 — Best-Fit / Turno Estimado
**Archivo:** `05-best-fit-estimated-shift.csv`
**Empleado:** Torres Juan (ID 104)
**Turno asignado:** Mañana

### Flujo esperado
1. **Verificación:** Se **SALTA** — BEST_FIT_SHIFT no es un blocking flag (no tiene `needsResolution=true` por sí solo)
2. **→ Directo a revisión**

### Análisis detallado

**Jul 1:** 07:00, 15:00 → cae en ventana Mañana → matched=Mañana, assigned=Mañana. OK ✓

**Jul 2:** 10:30, 18:30 → 10:30 no cae en ninguna ventana ([06:00,07:10] Mañana, [14:00,15:10] Tarde, [18:00,19:50] Noche) → **BEST_FIT_SHIFT**. Best fit: Mañana (|630-420|=210), Tarde (|630-900|=270), Noche (|630-1140|=510 vs 1440-510=930→510). Más cercano = **Mañana** (210 min).
- 18:30 llega como segundo scan. Session is best-fit, same day, span=480 < 720 → se agrega a la sesión.
- effectiveStart = 10:30 (best-fit no usa grace period), lastScan = 18:30. Span = 480 min. workedHours = floor(480/30)/2 = 8.0.
- Overtime: matched=Mañana (480 min shift) → simples = max(0, 480-480) = 0.

**Jul 3:** 07:05, 15:00 → ventana Mañana. Normal ✓

**Jul 4:** 12:00, 20:00 → 12:00 no cae en ninguna ventana → **BEST_FIT_SHIFT**. Best fit: Mañana (|720-420|=300), Tarde (|720-900|=180), Noche (|720-1140|=420 vs 1440-420=1020→420). Más cercano = **Tarde** (180 min).
- 20:00 llega como segundo scan, same day, span=480 < 720 → se agrega.
- effectiveStart = 12:00, lastScan = 20:00. Span = 480. workedHours = 8.0.
- Overtime: matched=Tarde (480 min shift) → simples = max(0, 480-480) = 0.

### Resumen esperado
- **Sesiones:** 4
- **Días no laborados:** 9 (quincena completa, solo 4 días trabajados de 13)
- **Sesiones con BEST_FIT_SHIFT:** 2 (Jul 2, Jul 4)
- **needsResolution:** 0 (BEST_FIT_SHIFT no bloquea)
- **Pantalla:** Directo a **revisión**

### UI esperada
- **Pill** en la fila del empleado: "2 turno est."
- **Detalle:**
  - Jul 2 y Jul 4: fondo **amarillo tenue**, badge "est." junto al nombre del turno
  - Jul 1 y Jul 3: fondo normal
- **Alerta:** "2 día(s) con turno estimado"

---

## 06 — Shift Mismatch
**Archivo:** `06-shift-mismatch.csv`
**Empleado:** Vargas Elena (ID 105)
**Turno asignado:** Mañana

### Flujo esperado
1. **Verificación:** **NO** — Los 2 SHIFT_MISMATCH (Jul 2 y Jul 4) son sesiones puras (solo flag SHIFT_MISMATCH) y ambas apuntan al mismo turno (Tarde). La auto-resolución solo necesita consistencia entre las sesiones SHIFT_MISMATCH puras, no entre todas las sesiones del empleado → **auto-resolve** → directo a revisión.
2. Jul 1 y Jul 3 se procesan normalmente como Mañana. Jul 2 y Jul 4 se auto-resuelven a Tarde.

### Análisis detallado

**Jul 1:** 07:00, 15:00 → ventana Mañana. matched=Mañana=assigned. Normal ✓

**Jul 2:** 14:55, 22:50 → 14:55 cae en ventana Tarde [14:00, 15:10]. matched=Tarde ≠ assigned=Mañana → **SHIFT_MISMATCH**.
- 22:50: ¿es exit? Para non-cross-midnight session con matched=Tarde, 22:50 está antes del fin de turno (23:00). No es "next shift exit scan" (eso es solo para cross-midnight). 22:50 está en el mismo día, span = 475 min. Se agrega a la sesión.
- `needsResolution=true` → horas = 0, simples = 0, dobles = 0 (no se calculan para sesiones flaggeadas con blocking flags)

**Jul 3:** 07:02, 15:05 → ventana Mañana. Normal ✓

**Jul 4:** 14:50, 23:00 → 14:50 cae en ventana Tarde [14:00, 15:10]. matched=Tarde ≠ assigned=Mañana → **SHIFT_MISMATCH**.
- `needsResolution=true`

### Resumen esperado
- **Sesiones:** 4
- **Días no laborados:** 9
- **Sesiones flaggeadas (needsResolution):** 0 (auto-resolved)
- **Sesiones normales:** 4 (Jul 1 y Jul 3 = Mañana, Jul 2 y Jul 4 = Tarde auto-resueltos)
- **Auto-resolución:** SÍ aplica (las 2 sesiones puras SHIFT_MISMATCH apuntan consistentemente a Tarde)

### UI esperada en revisión
- Empleado con 4 sesiones, sin flags visibles
- Jul 1 y Jul 3 con turno Mañana, Jul 2 y Jul 4 con turno Tarde
- Pantalla de revisión directa (skip verificación)

---

## 07 — Overtime (Simples y Dobles)
**Archivo:** `07-overtime-simples-dobles.csv`
**Empleado:** Morales Diego (ID 106)
**Turno asignado:** Mañana (8h shift = 480 min)

### Pre-requisito
- Jul 5 = **Domingo**, Jul 6 = **Lunes** (confirmado con calendario julio 2026)
- Sábado **NO** es día especial (solo Domingo y feriados)

### Flujo esperado
1. **Verificación:** Se **SALTA** (no hay blocking flags)
2. **→ Directo a revisión**

### Análisis detallado

| Fecha | Día  | Scans          | effectiveStart | Span  | Worked min | Worked h | Simp. min | Dobl. min | Notas |
|-------|------|----------------|----------------|-------|-----------|----------|-----------|-----------|-------|
| Jul 1 | Miér | 06:55, 17:30   | 07:00          | 630   | 630       | 10.5     | 150       | 0         | Overtime = 630-480 = 150 min |
| Jul 2 | Jue  | 07:00, 19:00   | 07:00          | 720   | 720       | 12.0     | 240       | 0         | Overtime = 720-480 = 240 min |
| Jul 3 | Vie  | 07:00, 15:00   | 07:00          | 480   | 480       | 8.0      | 0         | 0         | Exacto turno |
| Jul 5 | Dom  | 07:00, 15:00   | 07:00          | 480   | 480       | 8.0      | 0         | 480       | Domingo = TODO dobles |
| Jul 6 | Lun  | 07:00, 17:00   | 07:00          | 600   | 600       | 10.0     | 120       | 0         | Día normal, overtime = 600-480 = 120 min simples |

### Resumen esperado
- **Sesiones:** 5
- **Días no laborados:** 9 (Jul 5 es domingo, no cuenta; solo Jul 1,2,3,6 son no-domingo trabajados → 13-4=9)
- **Total horas:** 48.5
- **Horas extras simples:** 8.5 (510 min → floor(510/30)/2 = 8.5). Detalle y resumen muestran 8.5.
- **Horas extras dobles:** 8.0 (480 min, solo Jul 5 domingo). Detalle y resumen muestran 8.0.
- **Flags:** 0

### UI esperada
- Jul 1: columna Simp. muestra ~2.5h (150 min)
- Jul 2: columna Simp. muestra ~4.0h (240 min)
- Jul 5 (Domingo): columna Dobl. muestra 8.0h — **todas** las horas son dobles, no solo las extras
- Jul 6 (Lunes): columna Simp. muestra ~2.0h (120 min) — día normal con overtime

---

## 08 — Duplicate Scans (Deduplication)
**Archivo:** `08-duplicate-scans.csv`
**Empleado:** Castro Laura (ID 107)
**Turno asignado:** Mañana

### Flujo esperado
1. **Verificación:** Se **SALTA**
2. **→ Directo a revisión**

### Análisis de deduplicación (ventana 5 min)

**Jul 1 scans raw:** 07:00, 07:01, 07:03, 07:04, 15:00, 15:02
- 07:00 → KEPT (first)
- 07:01 → REMOVED (1 min < 5 min after 07:00)
- 07:03 → REMOVED (3 min < 5 min after 07:00)
- 07:04 → REMOVED (4 min < 5 min after 07:00)
- 15:00 → KEPT (480 min after 07:00 > 5 min)
- 15:02 → REMOVED (2 min < 5 min after 15:00)
- **After dedup:** 07:00, 15:00 → sesión normal

**Jul 2 scans raw:** 06:58, 06:59, 07:02, 15:00, 15:01
- 06:58 → KEPT (first)
- 06:59 → REMOVED (1 min < 5 min after 06:58)
- 07:02 → REMOVED (4 min < 5 min after 06:58)
- 15:00 → KEPT
- 15:01 → REMOVED (1 min < 5 min after 15:00)
- **After dedup:** 06:58, 15:00 → sesión normal

### Resumen esperado
- **Sesiones:** 2
- **Días no laborados:** 11 (solo 2 días trabajados de 13)
- **Flags:** 0
- **Scans efectivas por día:** 2 (entry + exit)
- **Jul 1:** effectiveStart=07:00, lastScan=15:00, worked=480 min, 8.0h
- **Jul 2:** effectiveStart=07:00 (06:58 dentro de gracia), lastScan=15:00, worked=480 min, 8.0h

### UI esperada
- 2 días normales, sin flags, sin pills
- Las scans deduplicadas **no** aparecen en el detalle expandido — solo las 2 efectivas

---

## 09 — Short Day (Salida Temprana)
**Archivo:** `09-short-day.csv`
**Empleado:** Rios Andrea (ID 108)
**Turno asignado:** Mañana (termina 15:00)

### Flujo esperado
1. **Verificación:** Se **SALTA** — SHORT_DAY **no** es blocking (`needsResolution=false`)
2. **→ Directo a revisión**

### Análisis de flags SHORT_DAY

Threshold de MISSING_EXIT = shift end - 60 min = 15:00 - 60 min = 14:00.

**Jul 1:** 07:00, 13:00. lastScan (13:00) < threshold (14:00) → 2 scans (par) + no shift_mismatch → **SHORT_DAY**
- effectiveStart=07:00, lastScan=13:00, span=360, worked=360 min, workedHours=6.0
- Simples: max(0, 360-480) = 0

**Jul 2:** 07:00, 12:30. lastScan (12:30) < threshold (14:00) → **SHORT_DAY**
- worked=330 min, workedHours=5.5
- Simples: 0

**Jul 3:** 07:05, 15:00. lastScan (15:00) ≥ threshold (14:00) → **Normal ✓**
- effectiveStart=07:00 (07:05 dentro de gracia), lastScan=15:00, worked=480, workedHours=8.0

### Resumen esperado
- **Sesiones:** 3
- **Días no laborados:** 10 (solo 3 días trabajados de 13)
- **SHORT_DAY:** 2 (Jul 1, Jul 2) — pero `needsResolution=false`
- **Normal:** 1 (Jul 3)
- **Pantalla:** Directo a revisión (SHORT_DAY no bloquea)

### UI esperada
- El empleado aparece en la lista de revisión normalmente
- Jul 1 y Jul 2 pueden tener algún indicador visual de SHORT_DAY pero **no** aparecen en la pantalla de verificación/resolución
- No hay pills especiales para SHORT_DAY

---

## 10 — Sunday / Holiday (Horas Dobles)
**Archivo:** `10-sunday-holiday-dobles.csv`
**Empleado:** Flores Roberto (ID 109)
**Turno asignado:** Mañana

### Pre-requisito
- Jul 5 = **Domingo** (calendario julio 2026: 5 es domingo)
- Jul 6 = **Lunes**
- Jul 12 = **Domingo**

### Flujo esperado
1. **Verificación:** Se **SALTA**
2. **→ Directo a revisión**

### Análisis

| Fecha  | Día  | Scans        | effectiveStart | Worked | Simp. | Dobl. | Notas |
|--------|------|--------------|----------------|--------|-------|-------|-------|
| Jul 5  | Dom  | 07:00, 15:00 | 07:00          | 480    | 0     | 480   | Domingo → todo dobles |
| Jul 12 | Dom  | 07:00, 15:00 | 07:00          | 480    | 0     | 480   | Domingo → todo dobles |
| Jul 6  | Lun  | 07:00, 15:00 | 07:00          | 480    | 0     | 0     | Día normal, turno completo |

### Resumen esperado
- **Días no laborados:** 12 (Jul 5 y 12 son domingo → no cuentan; solo Jul 6 Lun es no-domingo trabajado → 13-1=12)
- **Total dobles:** 16.0 (960 min, los dos domingos)
- **Total simples:** 0
- **Total horas:** 24.0h (3 días × 8h)

---

## 11 — Multi-Empleado Mixed Shifts
**Archivo:** `11-multi-employee-mixed.csv`
**Empleados:**
- Perez Ana (ID 110) — turno Mañana
- Garcia Luis (ID 111) — turno Tarde
- Martinez Rosa (ID 112) — turno Noche

### Pre-requisito
- Los 3 empleados deben existir con sus turnos respectivos. Si no existen, se crean con Mañana → Luis y Rosa tendrán SHIFT_MISMATCH.

### Flujo esperado
- **Si empleados pre-configurados con turno correcto:** Rosa tiene START_CUTOFF (Jul 1 noche cross-midnight + Jul 1 = reportStart) → va a **verificación**.
- **Si empleados creados como Mañana (default):** Luis → SHIFT_MISMATCH → auto-resolve a Tarde. Rosa → SHIFT_MISMATCH → auto-resolve a Noche. **No hay START_CUTOFF** porque `crossMidnight` se determina por el turno asignado original (Mañana, que no es cross-midnight). → **skip verificación → directo a revisión**.

### Por empleado (con turno Mañana por defecto)

**Perez Ana (110, Mañana):** 3 sesiones normales (Jul 1, 2, 3). No flags.

**Garcia Luis (111, assigned Mañana):** 3 sesiones en ventana Tarde → SHIFT_MISMATCH → auto-resuelto a Tarde.

**Martinez Rosa (112, assigned Mañana):** 3 sesiones en ventana Noche → SHIFT_MISMATCH → auto-resuelto a Noche. No START_CUTOFF porque crossMidnight proviene del turno asignado (Mañana=false).

### Resumen esperado (con turno Mañana por defecto)
- **3 empleados** en lista de revisión
- **Días no laborados por empleado:** 10 cada uno (3 días trabajados de 13 en Q1 completa)
- **Sesiones flaggeadas:** 0 (todo auto-resuelto)
- **Pantalla:** **Review directo**
- **Navegación:** botones anterior/siguiente navegan en el mismo orden que la tabla (ordenado por nombre por defecto)
- **Nota:** Si Rosa tiene turno Noche pre-asignado, habrá START_CUTOFF en Jul 1 → verificación

---

## 12 — Quincena Boundary (Cross-Period)
**Archivo:** `12-quincena-boundary.csv`
**Empleado:** Ortiz Miguel (ID 113)
**Turno asignado:** Mañana

### Flujo esperado
1. **Verificación:** **SÍ** — hay **2 quincenas disponibles** (Q1: Jul 1-15, Q2: Jul 16-31) → `hasMultiplePeriods=true` → va a verificación para seleccionar período

### Análisis

Todas las sesiones son normales (07:00-15:00), no hay flags.

| Fecha  | Quincena | Worked h |
|--------|----------|----------|
| Jul 14 | Q1       | 8.0      |
| Jul 15 | Q1       | 8.0      |
| Jul 16 | Q2       | 8.0      |
| Jul 17 | Q2       | 8.0      |

### Esperado en verificación
- Selector de quincena muestra 2 opciones
- Al seleccionar Q1: solo Jul 14 y Jul 15. **Días no laborados:** 11 (Q1 completa = 13 no-domingo, 2 trabajados)
- Al seleccionar Q2: solo Jul 16 y Jul 17. **Días no laborados:** 12 (Q2 Jul 16-31 = 14 no-domingo, 2 trabajados)
- Totales son independientes por quincena (16h Q1, 16h Q2)
- En la pantalla de revisión, se muestra la quincena seleccionada como chip (ej. "Julio 2026 · Q1") y un enlace **"Cambiar quincena"** que navega de vuelta a verificación para seleccionar otra quincena

---

## 13 — Break Scans (Almuerzo con Deducción)
**Archivo:** `13-with-break-scans.csv`
**Empleado:** Reyes Carmen (ID 114)
**Turno asignado:** Mañana

### Flujo esperado
1. **Verificación:** Se **SALTA** (0 blocking flags, 1 quincena)
2. **→ Directo a revisión**

### Análisis de breaks (legalBreakAllowance = 45 min)

**Jul 1:** Scans: 07:00, 12:00, 12:30, 15:00
- Break gap: scan[1]→scan[2] = 12:00→12:30 = 30 min
- Deducible break = max(0, 30 - 45) = **0 min**
- effectiveStart = 07:00, span = 07:00→15:00 = 480 min
- worked = 480 - 0 = **480 min** → **8.0h**
- Overtime: max(0, 480-480) = 0

**Jul 2:** Scans: 07:00, 11:30, 13:00, 15:00
- Break gap: 11:30→13:00 = 90 min
- Deducible break = max(0, 90 - 45) = **45 min**
- effectiveStart = 07:00, span = 07:00→15:00 = 480 min
- worked = 480 - 45 = **435 min** → roundToHalfHour = floor(435/30)/2 = floor(14.5)/2 = 14/2 = **7.0h**
- Overtime: max(0, 435-480) = 0

**Jul 3:** Scans: 07:00, 12:00, 14:00, 15:00
- Break gap: 12:00→14:00 = 120 min
- Deducible break = max(0, 120 - 45) = **75 min**
- effectiveStart = 07:00, span = 07:00→15:00 = 480 min
- worked = 480 - 75 = **405 min** → roundToHalfHour = floor(405/30)/2 = floor(13.5)/2 = 13/2 = **6.5h**
- Overtime: 0

### Resumen esperado
- **Sesiones:** 3
- **Días no laborados:** 10 (solo 3 días trabajados de 13)
- **Jul 1:** 8.0h (break dentro de allowance)
- **Jul 2:** 7.0h (45 min deducidos) — pill "−45m"
- **Jul 3:** 6.5h (75 min deducidos) — pill "−75m"
- **Total:** 21.5h
- **Flags:** 0

### UI esperada
- Expandir marcaciones de cada día muestra 4 scans
- Las horas trabajadas reflejan la deducción de break
- Sesiones con break deducido muestran una **pill a la izquierda** de las horas trabajadas indicando la deducción (ej. "Almuerzo −45m" para Jul 2, "Almuerzo −75m" para Jul 3)
- Jul 2 y Jul 3 posiblemente SHORT_DAY? Verifiquemos: Jul 2 lastScan=15:00, threshold=14:00 → 15:00 ≥ 14:00 → **no** SHORT_DAY. Jul 3 lastScan=15:00 → misma lógica → **no** SHORT_DAY.

---

## 14 — Noche Cross-Midnight en Borde de Reporte
**Archivo:** `14-noche-cross-midnight-cutoff.csv`
**Empleado:** Gutierrez Pablo (ID 115)
**Turno asignado:** Noche (si pre-configurado)

### Flujo esperado
- **Si empleado tiene turno Noche:** START_CUTOFF en Jul 1 → **verificación** con 1 flag.
- **Si empleado creado con turno Mañana (default):** todas las sesiones son SHIFT_MISMATCH puro → Noche → **auto-resolve → directo a revisión**. No hay START_CUTOFF porque crossMidnight proviene del turno asignado (Mañana=false).

### Análisis

Todas las sesiones se anclan en Q1 (Jul 1, Jul 2, Jul 15). El scan de Jul 16 07:00 es simplemente la salida de la sesión del Jul 15 (cross-midnight). Solo hay 1 periodo → no hay selector de quincena.

**Session 1 (Jul 1):** 19:00 → Jul 2 07:00 = 720 min, 12.0h
- Jul 1 = reportStart, isCrossMidnight → **START_CUTOFF** → needsResolution=true

**Session 2 (Jul 2):** 19:05 → Jul 3 06:50 = 705 min, 11.5h
- Normal ✓

**Session 3 (Jul 15):** 19:00 → Jul 16 07:00 = 720 min, 12.0h
- session.date = Jul 15, pero reportEnd = Jul 16 (fecha max de scans, no límite de quincena) → **no END_CUTOFF**
- La salida (Jul 16 07:00) está en Q2 pero la sesión se ancla en Jul 15 (Q1)

### Resumen esperado (con turno Noche pre-asignado)
- **Sesiones:** 3
- **Días no laborados:** 10 (solo 3 días trabajados de 13: Jul 1, 2, 15)
- **Flags:** START_CUTOFF (Jul 1)
- **needsResolution:** 1 sesión
- **Pantalla:** Verificación (blocking flag)

### Resumen esperado (con turno Mañana default)
- **Sesiones:** 3
- **Días no laborados:** 10
- **Flags:** 0 (auto-resolved)
- **Pantalla:** **Review directo**

---

## 15 — Grace Period Edge Cases
**Archivo:** `15-grace-period-edge.csv`
**Empleado:** Mendez Lucia (ID 116)
**Turno asignado:** Mañana (07:00)

### Flujo esperado
1. **Verificación:** Se **SALTA** (no hay blocking flags, 1 quincena)
2. **→ Directo a revisión**

### Análisis del grace period (10 min)

Grace period: si firstScan ≤ shiftStart + 10 min (07:10), effectiveStart = shiftStart (07:00). Si firstScan > 07:10, effectiveStart = firstScan.

| Fecha | Entry | ≤ 07:10? | effectiveStart | lastScan | Span | Worked min | Worked h |
|-------|-------|----------|----------------|----------|------|-----------|----------|
| Jul 1 | 07:00 | Sí       | 07:00          | 15:00    | 480  | 480       | 8.0      |
| Jul 2 | 07:10 | Sí (=)   | 07:00          | 15:00    | 480  | 480       | 8.0      |
| Jul 3 | 07:11 | **No**   | **07:11**      | 15:00    | 469  | 469       | **7.5**  |
| Jul 4 | 07:30 | **No**   | **07:30**      | 15:00    | 450  | 450       | **7.5**  |

**Nota:** La condición es `firstScan.isAfter(graceEnd)` donde graceEnd = 07:10. Jul 2 07:10 is NOT after 07:10 → within grace → effectiveStart = 07:00. Jul 3 07:11 IS after 07:10 → effectiveStart = 07:11.

### Resumen esperado
- **Días no laborados:** 9 (solo 4 días trabajados de 13)
- Jul 1: 8.0h (on time)
- Jul 2: 8.0h (exactly at grace boundary → within grace)
- Jul 3: 7.5h (1 min past grace → 11 min late)
- Jul 4: 7.5h (30 min late)
- **Total:** 31.0h

### UI esperada
- Jul 1 y Jul 2 show full 8.0h
- Jul 3 y Jul 4 show 7.5h — the difference shows the grace period cutoff effect
- **Jul 3 y Jul 4 tendrán "est." (turno estimado)** — la ventana de detección de Mañana es [06:00, 07:10]. Scans a 07:11 y 07:30 caen fuera → best-fit → turno estimado pill. Esto es comportamiento esperado: la ventana es estricta.
- El badge "est." y la pill de turno estimado son puramente informativos, no bloquean

---

## 16 — Same Day Double Shift (SAME_DAY_DOUBLE)
**Archivo:** `16-same-day-double-shift.csv`
**Empleado:** Navarro Oscar (ID 117)
**Turno asignado:** Mañana

### Flujo esperado
1. **Verificación:** **SÍ** — SAME_DAY_DOUBLE + BEST_FIT_SHIFT + MISSING_EXIT → needsResolution=true

### Análisis

**Jul 1 scans raw:** 07:00, 15:00, 15:05, 23:00

**Deduplicación:** La diferencia entre 15:00 y 15:05 es exactamente 5 min. El boundary de dedup es inclusive (>= 5 min se conserva). 15:05 **sobrevive** dedup. After dedup: 07:00, 15:00, 15:05, 23:00 (los 4 se conservan).

El grouper procesa secuencialmente:
1. 07:00 → ventana Mañana [06:00, 07:10] → abre Session A (matched=Mañana, assigned=Mañana)
2. 15:00 → same day, non-cross-midnight, span from 07:00 = 480 min < 840 (maxSessionSpan). Se agrega a Session A. Session A = [07:00, 15:00].
3. 15:05 → cae en ventana Tarde [14:00, 15:10], pero session no es cross-midnight y es el mismo día. Span from 07:00 = 485 min < 840. Se agrega a Session A. Session A = [07:00, 15:00, 15:05].
4. 23:00 → span from 07:00 = 960 > 840 (maxSessionSpanMinutes) → **finaliza Session A**, abre Session B. 23:00 no cae en ninguna ventana de detección → **BEST_FIT_SHIFT**. Best fit: Noche (|1380-1140|=240) vs Mañana (|1380-420|=960) vs Tarde (|1380-900|=480). Matched = **Noche**.

`detectSameDayDouble` runs after grouping: Session A (date=Jul 1, matched=Mañana), Session B (date=Jul 1, matched=Noche, BEST_FIT). Two sessions same day with different matched shifts → **SAME_DAY_DOUBLE** added to both.

**Session A:** [07:00, 15:00, 15:05], matched=Mañana, flags=[SAME_DAY_DOUBLE]. 3 scans (odd) → may get MISSING_EXIT.
**Session B:** [23:00], matched=Noche, flags=[BEST_FIT_SHIFT, SAME_DAY_DOUBLE, MISSING_EXIT]. 1 scan, closer to Noche start → MISSING_EXIT.

**Nota:** El escenario same-day double sigue sin producir un split limpio de 2 sesiones porque el grouper agrega 15:05 a Session A en vez de abrir una nueva sesión (span < maxSessionSpan). El comportamiento esperado es algo desordenado.

**Jul 2:** 07:00, 15:00 → normal Mañana. ✓

### Resumen esperado
- **Sesiones:** 3 (2 para Jul 1, 1 para Jul 2)
- **Días no laborados:** 11 (solo 2 días trabajados de 13)
- **Jul 1 Session A:** flags SAME_DAY_DOUBLE + possible MISSING_EXIT (3 scans, odd) → needsResolution=true
- **Jul 1 Session B:** flags BEST_FIT_SHIFT + SAME_DAY_DOUBLE + MISSING_EXIT → needsResolution=true
- **Jul 2:** normal, 0 flags
- **Pantalla:** Verificación

### UI esperada en verificación
- 2 flagged sessions for Jul 1 agrupadas como "Doble marcación"
- El grupo requiere resolución explícita (el botón "Revisar" está deshabilitado hasta que el usuario seleccione una opción)
- Opciones: mantener Session A (Mañana), mantener Session B (Noche), o mantener todas
- **Nota sobre el scan 15:00:** está dentro de Session A como exit scan. Los scans de Session A son [07:00, 15:00, 15:05]. El sistema usa first/last para entrada/salida.
- **Nota sobre el scan 15:05:** sobrevivió la dedup (diferencia de 5 min exactos con 15:00, boundary inclusive). Fue absorbido por Session A porque span < maxSessionSpan (485 < 840).

---

## 17 — Empleado Nuevo (Auto-Creación)
**Archivo:** `17-new-employee.csv`
**Empleado:** NuevoEmpleado Test (ID 999) — **NO existe en la BD**

### Flujo esperado
1. **Inactivos:** Se salta (empleado nuevo se crea, no hay inactivos)
2. **Verificación:** Se **SALTA** (no hay blocking flags, 1 quincena)
3. **→ Directo a revisión**

### Análisis

El empleado 999 no existe → se crea automáticamente con:
- turno = Mañana (default)
- active = true
- accruesOvertime = true

**Jul 1:** 07:00, 15:00 → ventana Mañana. effectiveStart=07:00, worked=480 min, 8.0h. ✓
**Jul 2:** 07:05, 15:00 → ventana Mañana. effectiveStart=07:00 (within grace), worked=480 min, 8.0h. ✓

### Resumen esperado
- **Sesiones:** 2
- **Días no laborados:** 11 (solo 2 días trabajados de 13)
- **Flags:** 0
- **Total:** 16.0h
- **Pantalla:** Directo a revisión

### UI esperada
- Empleado aparece en la lista con nombre "NuevoEmpleado Test", código "999"
- Turno asignado: Mañana
- Se comporta exactamente igual que cualquier otro empleado
- Verificar en Config → Empleados que el nuevo empleado aparece registrado

---

## 18 — Noche Missing Exit (Cross-Midnight Exit Input)
**Archivo:** `18-noche-missing-exit.csv`
**Empleado:** Delgado Raul (ID 118)

### Camino A — Empleado nuevo (turno Mañana por defecto)
Si el empleado 118 no existe, se crea automáticamente con turno Mañana.

**Flujo esperado:**
1. **Verificación:** **SÍ** — solo 1 sesión con needsResolution (Jul 3 MISSING_EXIT).

**Análisis:**
- Todas las sesiones matchean Noche → SHIFT_MISMATCH en las 3 sesiones.
- Sesiones 1 y 2 son SHIFT_MISMATCH puro (2 scans, sin otros flags) → auto-resueltas (swap a Noche).
- Sesión 3 tiene [SHIFT_MISMATCH, MISSING_EXIT] → NO auto-resuelta.
- No hay START_CUTOFF porque el turno **asignado** (Mañana) no es cross-midnight.

**Sessions después de auto-resolve:**
| Sesión | Fecha | Scans | Flags post-resolve | needsRes |
|--------|-------|-------|--------------------|----------|
| 1 (Jul 1) | 19:00, Jul 2 07:00 | _(cleared)_ | No |
| 2 (Jul 2) | 19:05, Jul 3 06:55 | _(cleared)_ | No |
| 3 (Jul 3) | 19:00 | SHIFT_MISMATCH, MISSING_EXIT | **Sí** |

**UI en verificación:**
- **Jul 3:** Muestra pill "Cambio de turno" y "Salida faltante". Entrada 19:00 (pre-llenado), salida vacía.
  - La salida es en la **madrugada del día siguiente** (ej. 07:00). El campo acepta horas AM porque el turno matcheado (Noche) es cross-midnight.
  - Al ingresar 07:00 como salida → **12.0h** (720 min).

### Camino B — Empleado pre-configurado con turno Noche
**Pre-requisito:** Empleado 118 **debe existir con turno Noche** antes de la carga.

**Flujo esperado:**
1. **Verificación:** **SÍ** — 2 sesiones con needsResolution: START_CUTOFF (Jul 1) + MISSING_EXIT (Jul 3).

**Análisis:**
- No hay SHIFT_MISMATCH (asignado = matcheado = Noche).
- Jul 1 = reportStart, turno asignado es cross-midnight → **START_CUTOFF** → needsResolution.
- Jul 3: 1 scan (odd) → **MISSING_EXIT** → needsResolution.

| Sesión | Fecha | Scans | Flags | needsRes |
|--------|-------|-------|-------|----------|
| 1 (Jul 1) | 19:00, Jul 2 07:00 | START_CUTOFF | **Sí** |
| 2 (Jul 2) | 19:05, Jul 3 06:55 | _(none)_ | No |
| 3 (Jul 3) | 19:00 | MISSING_EXIT | **Sí** |

**UI en verificación:**
- **Jul 1 (START_CUTOFF):** Muestra entrada 19:00 y salida 07:00 (pre-llenados). El usuario confirma o ajusta.
- **Jul 3 (MISSING_EXIT):** Igual que Camino A — entrada 19:00, salida vacía, acepta AM.

### Resumen esperado (ambos caminos, post-verificación)
- **Sesiones:** 3
- **Días no laborados:** 10 (3 días trabajados: Jul 1, 2, 3; de 13 no-domingo en Q1)
- Jul 1: 12.0h, Jul 2: 11.5h, Jul 3: depende de la salida ingresada (12.0h si se pone 07:00)
- **Extras simples:** 0 (turno Noche = 12h, ninguna sesión excede 12h)
- **Días no laborados:** 10

---

## 27 — Decimal Overtime (Half-Hour Precision)
**Archivo:** `27-decimal-overtime.csv`
**Empleado:** Garcia Luis (ID 127)
**Turno asignado:** Mañana (07:00–15:00)

### Pre-requisito
- Empleado 127 nuevo → se crea automáticamente con turno Mañana.

### Flujo esperado
1. **Verificación:** Se **SALTA** (sin flags bloqueantes)
2. **→ Directo a revisión**

### Análisis detallado

| Fecha | Día  | Scans        | effectiveStart | Span | Worked min | Worked h | Simp. min | Dobl. min | Notas |
|-------|------|--------------|----------------|------|-----------|----------|-----------|-----------|-------|
| Jul 1 | Miér | 07:00, 15:30 | 07:00          | 510  | 510       | 8.5      | 30        | 0         | Overtime = 510-480 = 30 min simples |

### Resumen esperado
- **Sesiones:** 1
- **Días no laborados:** 12 (Q1 = 13 no-domingos; solo Jul 1 trabajado → 12 no laborados)
- **Horas extras simples:** 0.5 — `floor(30/30)/2 = 0.5`. Detalle y resumen muestran **0.5**, no 0 ni 1.
- **Horas extras dobles:** 0.0

### Propósito
Verifica que la media hora de overtime (30 min) produce `0.5` y no se trunca a entero. Este es el caso que la conversión a `numeric` en el SP desbloquea: anteriormente el SP recibiría `0` o `1` por el cast implícito de `numeric→integer`.

---

## Resumen: ¿A qué pantalla va cada test?

| Test | Archivo | Va a verificación? | Razón |
|------|---------|-------------------|-------|
| 01   | happy-path-manana | **NO** → Review directo | 0 blocking flags, 1 quincena |
| 02   | happy-path-tarde | **NO** → Review directo | 0 blocking flags, 1 quincena. Si creado con Mañana, SHIFT_MISMATCH auto-resuelto (100% consistente → Tarde) |
| 03   | noche-cross-midnight | **NO** (Mañana default) / **SÍ** (Noche pre-config) | SHIFT_MISMATCH auto-resuelto si turno=Mañana; START_CUTOFF si turno=Noche |
| 04   | missing-entry-exit | **SÍ** | MISSING_ENTRY/EXIT (3 sesiones) |
| 05   | best-fit-estimated | **NO** → Review directo | BEST_FIT no bloquea |
| 06   | shift-mismatch | **NO** | SHIFT_MISMATCH auto-resuelto (2 sesiones puras apuntan consistentemente a Tarde) |
| 07   | overtime | **NO** → Review directo | 0 blocking flags |
| 08   | duplicate-scans | **NO** → Review directo | Deduplicación transparente |
| 09   | short-day | **NO** → Review directo | SHORT_DAY no bloquea |
| 10   | sunday-holiday | **NO** → Review directo | 0 flags |
| 11   | multi-employee | **NO** (Mañana default) / **SÍ** (Noche pre-config) | SHIFT_MISMATCH auto-resuelto; START_CUTOFF solo si Rosa tiene Noche pre-asignado |
| 12   | quincena-boundary | **SÍ** | 2 quincenas disponibles |
| 13   | break-scans | **NO** → Review directo | 0 flags |
| 14   | noche-cutoff | **NO** (Mañana default) / **SÍ** (Noche pre-config) | SHIFT_MISMATCH auto-resuelto si turno=Mañana; START_CUTOFF si turno=Noche (no END_CUTOFF: reportEnd=Jul 16) |
| 15   | grace-period | **NO** → Review directo | 0 flags |
| 16   | same-day-double | **SÍ** | SAME_DAY_DOUBLE + MISSING_EXIT |
| 17   | new-employee | **NO** → Review directo | 0 flags, empleado nuevo |
| 18   | noche-missing-exit | **SÍ** (Mañana default: solo MISSING_EXIT; Noche pre-config: START_CUTOFF + MISSING_EXIT) | Ejercita input de salida cross-midnight |
| 27   | decimal-overtime | **NO** → Review directo | 0.5h simples (30 min), verifica precisión decimal en extras |

## Checklist General de Verificación

Para cada archivo, verificar:
- [ ] La carga del CSV no muestra errores
- [ ] El flujo va a la pantalla correcta (según tabla arriba)
- [ ] La pantalla de revisión muestra un chip con la quincena seleccionada (ej. "Julio 2026 · Q1")
- [ ] El selector de quincena funciona cuando hay múltiples quincenas
- [ ] Cuando hay múltiples periodos, la pantalla de revisión muestra un enlace **"Cambiar quincena"** que navega de vuelta a verificación
- [ ] La pill "turno est." aparece cuando corresponde (test 05)
- [ ] Al hacer click en un empleado, la vista de detalle muestra:
  - [ ] Las sesiones correctas para la quincena seleccionada
  - [ ] Marcaciones expandibles (especialmente tests con 4 scans: 01, 13)
  - [ ] Badge "est." con fondo amarillo en filas de turno estimado
  - [ ] Alerta "X día(s) con turno estimado" cuando aplica
  - [ ] Horas extras correctas (Simp. y Dobl.)
  - [ ] Totales de quincena correctos
  - [ ] Pill de deducción de break (ej. "Almuerzo −45m") a la izquierda de las horas trabajadas en sesiones con break deducido
- [ ] Las sesiones flaggeadas aparecen en verificación con las flags correctas
- [ ] SHIFT_MISMATCH 100% consistente se auto-resuelve (empleado salta verificación)
- [ ] En verificación, el input de salida para turnos cross-midnight acepta horas AM (ej. 07:00 para turno Noche) — test 18
- [ ] Navegación entre empleados funciona (anterior/siguiente) y respeta el orden visual de la tabla (por nombre o código según la columna de ordenamiento activa) — test 11
- [ ] El submit final **fallará** sin PostgreSQL — esto es esperado
