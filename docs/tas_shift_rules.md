# TAS Shift & Worked Hours Rules

This file records all business rules for processing the TAS biometric event format.
Rules marked **[CONFIRMED]** have been verified with the client.
Rules marked **[OPEN]** are still pending confirmation — Andy will update these.

---

## File Encoding **[CONFIRMED]**

TAS files are **UTF-8 with BOM** (`EF BB BF` prefix). The old format was ISO-8859-1 — the parser must be updated accordingly.

---

## Input Format

The TAS file is a flat CSV with 5 columns:

| Column | Name | Example |
|---|---|---|
| 0 | No. | `"1"` |
| 1 | Fecha y hora | `"2026/03/31 19:46"` |
| 2 | Evento | `"1:N Autenticación exitosa (Rostro)"` |
| 3 | Nombre de usuario | `"Morales Cifuentes Roberto Daniel"` |
| 4 | ID de usuario | `"134"` |

- Every event type is identical (`1:N Autenticación exitosa (Rostro)`). There is no in/out distinction.
- A person may scan multiple times in rapid succession (within seconds or 1–2 minutes) — these are noise and should be deduplicated into a single event.
- Data is stored in reverse chronological order in the file; must be sorted ascending per employee before processing.

---

## Shift Entry Times **[CONFIRMED]**

There are exactly 3 shift anchor times:

| Shift | Anchor |
|---|---|
| Morning | 07:00 |
| Afternoon | 15:00 |
| Night | 19:00 |

Shifts may span two calendar days (e.g., a night shift starting at 19:00 can end at 03:00 the next morning). Cross-midnight scans belonging to the same session must not be split into separate shifts.

---

## Shift Assignment **[CONFIRMED]**

The shift is assigned based on the employee's first scan of a session.

- If the first scan falls within a shift's detection window (see table below) → auto-assign to that shift anchor.
Each shift has a fixed detection window of anchor − 60 min to anchor + 10 min:

| Shift | Anchor | Detection Window |
|---|---|---|
| Morning | 07:00 | 06:00 – 07:10 |
| Afternoon | 15:00 | 14:00 – 15:10 |
| Night | 19:00 | 18:00 – 19:10 |

- If the first scan is **ambiguous** (falls outside all three detection windows) → flag the session for manual verification in the app. The client must provide the correct shift start time before the report is generated.

---

## Grace Period **[CONFIRMED]**

- Each shift has a **10-minute grace period** after its anchor time.
- If the employee's first scan is ≤ anchor + 10 min → on time, no deduction.
- If the employee's first scan is > anchor + 10 min → tardy.

---

## Tardiness Deduction **[CONFIRMED]**

When an employee is tardy, their **effective shift start** is calculated using 30-minute chunks:

```
effective_start = shift_anchor + ceil((first_scan − shift_anchor) / 30min) × 30min
```

Examples (7:00 anchor, grace ends at 7:10):
- First scan 7:05 → on time → effective start = 7:00
- First scan 7:11 → tardy, 11 min late → ceil(11/30) = 1 chunk → effective start = 7:30
- First scan 7:35 → tardy, 35 min late → ceil(35/30) = 2 chunks → effective start = 8:00
- First scan 8:05 → tardy, 65 min late → ceil(65/30) = 3 chunks → effective start = 8:30

**Worked hours for the session = last_scan − effective_start.**

---

## Session Grouping (Cross-midnight Shifts) **[OPEN — working rule in place, pending confirmation]**

**Confirmed facts:**
- An employee never works two separate shifts in the same calendar day.
- Shifts may be extended: a 7am shift can run until 7pm; this is one session, not two.
- Shifts last anywhere from **8 to 12 hours** depending on season (short = 8h, long = 12h).
- Night shifts (7pm anchor) can cross midnight — e.g., 19:00 Monday to 07:00 Tuesday is a valid 12h night shift.
- All scans between first arrival and final departure belong to the same session, including door accesses during breaks.
- **Minimum rest between shifts for the same employee: 12 hours.**

**Why a gap threshold is needed:**
Within a single calendar day, all scans from one employee clearly belong to one session. The problem is cross-midnight night shifts: a 7pm session produces scans on two different calendar dates. A naive "group by calendar date" approach would orphan the early-morning scans on the second date, triggering false missing-scan flags.

Example — 7pm night shift crossing midnight:
```
Monday   19:03  → session start (night shift)
Monday   22:30  → door access (break)
Tuesday  02:15  → door access (break)   ← belongs to Monday's session
Tuesday  07:00  → last scan, shift ends  ← belongs to Monday's session
Tuesday  19:05  → new session start (next night shift)
```

A cutoff of 06:00 was initially proposed (scans before 06:00 → merge with previous day). This was rejected because a 7pm–7am shift (12 hours) ends at 07:00, which is ≥ 06:00, incorrectly starting a new morning session.

**Working rule (pending confirmation):**
> A new session begins when consecutive scans from the same employee are **≥ 12 hours apart.** Scans less than 12 hours apart belong to the same session.

Rationale:
- Max shift duration = 12h → no two scans within a single shift should be ≥ 12h apart.
- Min rest between shifts = 12h → the gap between the last scan of one session and the first scan of the next is always ≥ 12h.
- This makes the 12h boundary a clean separator.

Verification with key scenarios:

| Scenario | Gap between scans | Same session? | Expected |
|---|---|---|---|
| 7pm night shift: scan at 22:30 → 02:15 | 3.75h | yes (< 12h) | ✓ |
| 7pm night shift: scan at 07:00 → next 7pm start | 12h | no (≥ 12h) | ✓ |
| 7am extended shift: scan at 07:02 → 14:05 | 7h | yes (< 12h) | ✓ |
| 7am extended shift: scan at 19:05 → next 07:02 | 12h | no (≥ 12h) | ✓ |

**Edge case — exact 12h gap:**
If two consecutive scans are exactly 12 hours apart, it is ambiguous whether this is the end of one session and the start of the next, or a single long session with no intermediate scans. Suggested: flag for manual verification when gap = exactly 12h. In practice this is extremely rare.

**Open question:** Confirm that min rest between shifts is always ≥ 12h and max shift is always ≤ 12h. If either bound is ever violated, the 12h gap rule will misclassify sessions. The alternative approach considered (06:00 cutoff) and its failure modes are documented above for reference.

---

## Worked Hours per Session **[CONFIRMED]**

- **First scan of the session** → determines shift assignment and, after tardiness adjustment, the effective start time.
- **Last scan of the session** → end time.
- **Worked hours = floor(last_scan − effective_start)** — truncated to whole hours (e.g., 8h 37min → 8h). **[OPEN: Andy to confirm floor vs. round before finalizing]**
- Breaks between scans are **not deducted** from total worked time.

---

## Weekly Hours: Simples vs. Dobles **[CONFIRMED]**

- **Work week:** Monday through Saturday.
- **Horas simples:** hours worked Mon–Sat up to a cumulative total of **44 hours** per week.
- **Horas dobles:** any hours worked Mon–Sat **beyond 44 cumulative hours** in the week, plus **all hours worked on Sundays** (always dobles, regardless of total).
- A "week" resets every Monday.
- **Partial weeks at period boundaries:** if a report starts on a Thursday, only Thursday–Saturday count toward that week's 44h bucket. The Monday boundary is always a fixed calendar boundary, not relative to the report start date. Hours in a partial week still count toward that week's 44h limit.

---

## Dias No Laborados **[CONFIRMED]**

**Rule:** Count the number of **Monday–Saturday** calendar days within the reporting period where the employee has **zero scans**.

- Sundays are excluded entirely from this count (they are never expected working days for the absence calculation, even though Sunday hours are counted as dobles when worked).
- A day with at least one scan = worked, regardless of how few hours.

---

## Quincena Derivation **[CONFIRMED]**

Quincena is **derived from the date range in the file**, not entered manually.

- **Quincena 1** = calendar days 1–15 of the month (inclusive)
- **Quincena 2** = calendar days 16–end of month (inclusive)

The system generates one output row per employee per quincena period covered by the file. If the file covers multiple periods, the existing UI pattern applies: the user selects which quincena to submit (same as the existing multi-month flow).

**44h weekly limit within a quincena:** Each quincena is fully self-contained for the simples/dobles calculation — no hours carry across the Q1/Q2 boundary.

- **Q1 week boundaries:** Mon–Sat as usual within days 1–15, but the last week is hard-capped at the 15th. Any Sunday within Q1 (including if the 15th itself is a Sunday) still counts as dobles for Q1.
- **Q2 week boundaries:** The first "week" always starts on the 16th regardless of what day of the week it falls on. Subsequent weeks reset on Monday as usual. Sundays within Q2 always count as dobles.

Example — month where the 15th is a Wednesday:
- Q1 last week: Mon the 13th – Wed the 15th (3 days, 44h counter covers only these days)
- Q2 first week: Thu the 16th – Sat the 18th (3 days, 44h counter starts fresh at 0)

Example — month where the 15th is a Sunday:
- Q1 last week: Mon the 9th – Sat the 14th, plus Sun the 15th (dobles for Q1)
- Q2 first week: Mon the 16th (clean Monday boundary)

---

## Ambiguous / Missing Scan Verification **[CONFIRMED]**

The app must present a **mandatory verification screen** before showing the final report when:

1. **Missing scan:** An employee has only one scan in a session (cannot determine both start and end).
2. **Ambiguous shift:** An employee's first scan does not fall close enough to any of the three anchors to be automatically assigned.

**Single-scan behaviour:**
- If the single scan falls **within a detection window** → it is treated as a confirmed arrival (start). The Inicio field is pre-filled with that time (editable). Only Fin must be provided by the client.
- If the single scan falls **outside all detection windows** → it is shown as reference only ("Escaneo registrado: HH:mm"). Both Inicio and Fin must be provided by the client.

In both cases the client can edit any pre-filled value. No employee row may be finalized without a resolved start and end time.

---

## Duplicate Scan Deduplication **[CONFIRMED]**

Consecutive scans from the same employee within **5 minutes** of each other are collapsed into a single event, keeping the earliest timestamp. Scans more than 5 minutes apart are treated as separate real events.
