# Changelog

## Unreleased

### Fixes
- **Only this install's backend is stopped, however its path is written.** The installer and the app's startup check compared path text, so an install reached through an 8.3 short name (`PROGRA~1`), a junction or a `subst` drive was not recognised, and the installer said "Backend stopped." when it wasn't. The app's startup check was broader still: it stopped every `java.exe` running a `backend.jar`, including another install's backend. Both now run one shared script, `stop-backend.ps1`, which matches the process whose executable is the same file as this install's `jre\bin\java.exe` (volume and file id), and a Windows CI job runs it against real processes for each of those path forms. On macOS the app matches its own `java` path exactly instead of any `backend.jar`.

## v1.3.1 — 2026-11-18

### Fixes
- **The installer stops the running backend whatever the install path.** The install path was pasted into a quoted PowerShell script and matched with `-like`. A `'` in the path (a per-user install under `C:\Users\O'Brien`) broke the script, and `[` or `]` were read as wildcards, so a running backend kept the JRE files locked and the update failed. The path now reaches the script through an environment variable, and only the bundled `jre\bin\java.exe` is matched, by its full path. A drive-root install doesn't stop other Java programs on that drive. A missing path or an unreadable process list is reported as a failure instead of "Backend stopped."

## v1.3.0 — 2026-11-18

Resume an interrupted session, a safe close, and fixes to how verification handles lone scans, typed-in nights and the 15th/16th cut.

### Features
- **Resume an interrupted TAS session.** Progress through inactive-employee review, verification and review is saved automatically to the local database. After the app closes, crashes or the backend restarts, the start screen shows a "Sesión sin terminar" card to continue at the same step with every decision intact, or to discard it. Only the latest session is kept; uploading a new file (after a confirm) or the confirmed "Nueva carga" discards it. A session whose submission partly failed is kept and flagged so duplicates aren't a surprise, and a second submission for the same session is refused while one is still running.

### Fixes
- **Closing the app saves your work and shuts the database down cleanly.** The close button used to kill the backend outright, so a change made in the last moments could be lost and the local database was never closed properly. Now the window hides, waits (up to 2 s) for the session to be saved, and asks the backend to shut down gracefully; it is only killed if it hasn't exited after 5 s. Closing while a submission is running is refused with a message, so a payroll batch is never cut off half-sent. New endpoint `POST /api/system/shutdown`, which needs the per-launch token the app passes to the backend and doesn't exist without it.
- **A "Doble marcación" made of lone scans asks for the missing times.** Two single scans on one day (07:08 and 22:03, split because the span exceeds 14 h) were shown only as a double. "Mantener todas" applied by itself, paid 0 hours and sent the day back for a second round of missing-exit cards. The card now says the scans are alone and offers "Una sola jornada (07:08 – 22:03)". For the kept scan(s) it shows the missing-time inputs inline and counts them as pending, and everything goes in one "Revisar". The backend applies the double choice before the typed times (typing times used to take the kept half out of its double, so the discarded half was kept too) and refuses times for a half discarded in the same batch.
- **A session saved by another app version is never resumed half-filled.** Each half of the saved session carries a format version. One from another version used to be deleted without a word, or, if the format changed without a version bump, resumed with the new fields at their defaults. It now stays on the start screen with "Esta sesión se guardó con otra versión de la aplicación y no se puede continuar." and only "Descartar". New tests fingerprint the saved shape on both sides and fail until the version is bumped.
- **Night shifts into or out of a Sunday or holiday are split at midnight again.** The Sunday/holiday test used the session's date while the split used the entry's date, so a night dated by its exit (missing entry, typed in) was paid wrong: Saturday 22:00–Sunday 06:00 was all double, and Sunday 22:00–Monday 06:00 had no double hours. The start day now comes from the entry.
- **A night typed in from its exit is dated by its entry.** It counted as worked on the exit day, so the entry day could be docked as not worked. It now moves to the entry day like any complete night, also across the 15th/16th: a night from the 15th into the 16th is paid once, in the first fortnight. The second fortnight's file doesn't pay its exit half again. The card says when a typed night started in the previous fortnight, also once confirmed. The employee keeps a row in the second fortnight, so its days not worked are still sent, and the period list only offers fortnights the file's scans reach. A typed entry must fall on the session's day, the day before or the day after, and a typed day can last at most 16 hours. The user manual's "Corte de período" section said the fortnight with most of the hours pays the night; it now matches this rule.
- **Two typed-in days can no longer overlap.** Resolving the entry half and the exit half of one night as the same night paid it twice. A correction that overlaps another counted day of the same employee is now refused, naming the session and the other day's times.
- **Changing a day's shift updates its overnight setting.** Accepting another shift on "Cambio de turno", or the automatic re-pick after a swapped or estimated entry, changed the shift id but kept the old shift's name and overnight flag.
- **"Doble marcación" no longer blocks "Revisar".** The card pre-selects "Mantener todas" and says it applies automatically, but it was counted as pending until another option was picked and switched back. The default now counts as decided; the employee's group still opens so the double is seen.
- **Short-day corrections work.** The "Jornadas cortas" section never appeared (the backend only sent blocking sessions) and a correction would have been ignored by the backend. Short days are now listed whenever verification opens, without blocking "Revisar"; "Registrar corrección" is saved and shows "Corrección registrada" with "Deshacer", an exit before the entry on a day shift is refused on the card, and a resumed session shows the saved correction.
- **A rejected correction names the day.** When the backend refuses one correction, the whole batch used to fail with "Ocurrió un error al enviar." Per-session errors now carry the `sessionId`; the toast names the employee and date, and that card reopens and is highlighted. Other errors show the backend's message.
- **Long sessions no longer expire after 30 minutes.** The in-memory upload session now expires after 30 *idle* minutes instead of 30 minutes after the upload, and a session with a saved draft is never evicted (it reloads from the draft if needed).
- **Warning when the file doesn't cover the whole quincena.** Days of the quincena outside the file's scan range are counted as non-worked for every employee, so a TAS export for the wrong range silently docks everyone's pay (the live October file ended on the 11th: 4 days for everyone). The review step now shows a "Quincena incompleta" banner naming the missing working days (Sundays and holidays excluded), and "Enviar" asks for confirmation before submitting (focus starts on "Cancelar"). "Enviar" stays disabled until the check answers; if the check fails, submitting still asks for confirmation. The shared confirm dialog no longer treats Enter on a focused "Cancelar" button as confirm. New endpoint: `GET /api/tas/coverage/{uploadToken}`.
- **Swap a single scan between entry and exit.** When a day has only one scan, the app guesses whether it was the entry or the exit, and it often guessed wrong for afternoon exits of the morning shift (they showed up as the entry of a Tarde/Noche shift). Missing-entry/exit cards now have an "Intercambiar entrada/salida" button, and when the entry time changes the shift is re-picked from the new entry so overtime is measured against the right shift length (previously a misread Noche day lost all its overtime).
- **Specific startup errors.** When the backend can't start, the app now stops waiting and says why: the port is taken by another program, or the service stopped during startup (with its exit code). Previously every failure showed "No se pudo conectar con el servicio." after 20 seconds.

- **Installer waits for the old backend to stop.** The install/uninstall hook now waits (up to ~10 s) until the bundled backend has actually exited, instead of a fixed 1.5 s, and logs in the installer details whether it stopped.
- **No more database errors on every launch.** The local DB migration now uses `IF EXISTS` guards, so it no longer logs `Column "YEAR" not found` / `Table ... not found` to the H2 trace file each time the app starts.

### Security
- **Backend only accepts local connections.** It now binds to `127.0.0.1` instead of all interfaces, so the payroll API isn't reachable from other machines on the network.

## v1.2.2 — 2026-11-16

### Fixes
- **"No se pudo conectar con el servicio" on startup.** The backend port moved from `49301` to `41301`. 49301 is inside the Windows ephemeral range (49152–65535), so Windows could hand it to another program's outbound connection (seen in production with a local nginx), which blocked the backend from starting. On first launch after upgrading, the app also stops any 1.2.1 backend still running on the old port so it releases the local database.

## v1.2.1 — 2026-07-01

Follow-up fixes to the 1.2.0 feedback.

### Fixes
- **Overtime totals now add up.** Each session's extras are rounded to the half hour and then summed (sum-of-floors), so the per-row values in the review table match the footer, side panel, and the value submitted to payroll (e.g. 14, not 15). Applies to both `horas_extras_simples` and `horas_extras_dobles`.
- **Reset actually wipes the data.** The app no longer leaves an orphaned backend JVM running: it enforces a single instance, terminates any orphan on startup before spawning its own, and kills the backend on exit. A lingering backend kept the H2 database open (so deleting the file did nothing) and locked JRE DLLs. `reset-db.sh` also stops the backend before deleting now.
- **Config tabs no longer shift the page.** Reserved the scrollbar gutter so switching between short and tall tabs doesn't jump the layout.
- **Employee sort is correct.** Only the id (código) and name columns are sortable, and codes compare numerically ("9" before "10").
- **Consistent 12-hour time entry.** Time inputs render the AM/PM control with a clock picker on both macOS and Windows (`lang="en-US"`), instead of Windows forcing 24-hour input.

### UX
- **Resolved review rows re-open.** Confirmed session rows and checkbox-resolved double-shift rows now collapse to a "Confirmado" chip you can click to re-open (prefilled) and double-check or change.

## v1.2.0 — 2026-07-01

Bug-fix and UX release: unblocks the Windows installer, corrects a totals
mismatch, and polishes the review and employee screens.

### Fixes
- **Windows installer no longer aborts on update.** A new NSIS pre-install/pre-uninstall hook kills any bundled-JRE backend (`java.exe`) still running from the install directory before extracting or uninstalling files. A leftover backend keeps the JRE DLLs locked, so updating (or reinstalling the same version) over a running install aborted with `error opening file "...\jre\bin\extnet.dll"`.
- **Drag-and-drop file upload works again.** Disabled Tauri's native OS drag-drop (`dragDropEnabled: false`), which was swallowing file drops before they reached the webview; the drop zone's DOM handler now receives them.
- **Deactivating an absent employee after submitting no longer fails.** The `deactivate` endpoint no longer 404s once the upload state is evicted on submit — it acts on the employee registry, which is the source of truth for active state.
- **Detail-page totals match the side panel.** The table footer now sums raw minutes before flooring to the half hour (like the backend) instead of flooring each session first, which undercounted the simple/double hour totals (e.g. 14 vs 15).

### UX
- **Review screen: resolved rows stay put.** Confirmed rows now collapse in place instead of sinking to the bottom of their group, which read as the row disappearing.
- **Config › Employees: sortable columns.** Click any column header to sort ascending/descending.
- **Config › Employees: clear the search.** A ✕ button in the search box clears the current query.

### Docs
- Added `docs/reset-database.md` and `scripts/reset-db.{ps1,sh}` for wiping the local H2 database to start from a clean slate.

## v1.1.1 — 2026-07-01

Bug-fix release: makes the bundled Windows installer launch and connect to its backend on a clean machine.

### Fixes (Windows packaged app)
- Bundle the embedded JRE preserving its directory structure — the previous resource globs flattened subfolders, dropping `bin\server\jvm.dll` and `lib\security\java.security` so the JVM couldn't start.
- Strip the Windows `\\?\` verbatim path prefix before launching the backend JAR — the JVM couldn't load classes from a `\\?\`-prefixed jar (`ClassNotFoundException: JarLauncher`).
- Connect the frontend to `127.0.0.1` instead of `localhost` — Windows resolves `localhost` to IPv6 first, but the backend binds IPv4; updated the API base URL and CSP `connect-src`.
- Allow the `http://tauri.localhost` CORS origin used by the Windows WebView2 (macOS/Linux use `tauri://localhost`).
- Reuse an already-running backend instead of spawning a duplicate that crashes on the single-writer H2 file lock.
- Suppress the backend console window on Windows (`CREATE_NO_WINDOW`).

## v1.1.0 — 2026-06-30

Pre-production hardening release: security, reliability, and observability work on top of the 1.0 TAS app, plus a new per-stage upload progress UI.

### Features
- **Per-stage progress messages during TAS upload** — the upload flow now reports each processing stage to the user instead of a single opaque spinner.

### Reliability & observability
- Added pre-production reliability and observability gaps coverage: absolute log path, dedicated stderr log, and a startup hint.
- Evict stale `stateStore` entries after a 30-minute TTL.
- Return to idle on upload error so the user can retry without restarting the app.
- Log instead of silently swallowing holiday-load and API failures.

### Security hardening
- Removed H2 `AUTO_SERVER` and sanitized error responses to avoid leaking internals.
- Tightened CORS: removed unintended `setAllowCredentials`, restricted allowed headers (with test coverage), added CSP.
- Escaped `LIKE` wildcards in employee search to prevent wildcard injection.
- Redacted plaintext credentials from `stored_procedure.md`.
- Hardened the `/resolve` endpoint: type-guarded casts, guarded date parsing, and rejection of end-before-start times.
- Replaced bare `IllegalArgumentException`/`IllegalStateException` with typed exceptions in the shift and job services.
- Validated config bounds (break allowance ≥ 0, session span ≥ 60 min), `shiftId` existence before employee update, and `employeeIds` existence before deactivating absent employees.
- Fixed null-token NPE, added `deactivateAbsent` token guard, and made the submit payload a defensive copy.

### UX
- Surface `notFound` employees from `deactivateAbsent`; skip the store update when the backend reports `notFound`, with singular/plural toast wording.

### Internal
- Extracted the API base URL to a shared constant.
- Pre-production build and config cleanup (TASK-78); aligned all version strings.
- Added INT-3 regression test, `@AfterEach` `stateStore` cleanup in `TasControllerTest`, and general test-hygiene fixes.

## v1.0.1 — 2026-06-27

Packaging and polish release for the first TAS production build.

- **Windows installer** — switched from MSI/WiX to NSIS to avoid `light.exe` duplicate-resource failures; removed redundant JRE resource globs; added `contents: write` permission and auto-create GitHub Release on version-tag push.
- **Demo mode** — added demo mode with a demo CSV and annotated guide (TASK-71).
- **Editable días no laborados** in the TAS review and detail screens.
- Prepared decimal overtime for the stored-procedure numeric upgrade (TASK-70).
- Added a help button that opens the bundled PDF manual.
- Smoke-test fixes: overtime, shift auto-resolution, cross-midnight handling, and UX.
- Documentation: rewritten README and user manual with Playwright-captured screenshots, plus a technical admin guide and a Windows/macOS release guide.

## v1.0.0 — 2026-06-22

First production release of the TAS-based application (time-and-attendance CSV ingestion, shift detection, verification, and review), replacing the earlier generic CSV loader.

- Full TAS pipeline: scan dedup, shift detection/best-fit, session grouping, hours calculation (overtime simples/dobles, lunch deduction, días no laborados), verification, and review.
- Redesigned review screen with list/detail views, filter chips, sorting, sticky header, and inline overtime editing.
- MD3 design tokens across all screens; unified toast/AlertMessage notifications.
- CSV validation gates (empty file, size limit, encoding, warning cap) and classified stored-procedure error messages.
- Async job submission with retry; explicit backend-process cleanup on Tauri exit.
- GitHub Actions Windows build workflow.

## v0.2 — 2026-04-24

### Async job submission with retry

Replaced the synchronous `POST /submit` endpoint with an async job system. The backend now returns a job ID immediately and processes rows in a background thread pool. The frontend polls for job status and shows live progress.

#### Backend
- **`AsyncConfig`** — `@EnableAsync` with a bounded `ThreadPoolTaskExecutor` (2 core / 3 max threads)
- **`JobService`** — in-memory job store (`ConcurrentHashMap`); `@Async processJob` iterates rows, updating per-row status as each completes; same connection-error short-circuit and duplicate-skip logic as before
- **`JobController`** — replaces `SubmitController`:
  - `POST /api/submit` → 202 Accepted with `{ jobId, status: "PENDING" }`
  - `GET /api/jobs/{jobId}` → full job snapshot (status, counters, per-row results)
  - `POST /api/jobs/{jobId}/retry` → creates child job from failed rows; rejects if max retries reached
- **`DataSourceConfig`** — added `queryTimeout=10s` on `postgresJdbcTemplate` (per-statement JDBC timeout, complements existing `socketTimeout`)
- **`application.properties`** — added `job.max-retries=3` (configurable)
- 114 backend tests pass (23 new `JobServiceTest`, 11 new `JobControllerTest`)

#### Frontend
- **`types.ts`** — added `JobRowStatus`, `JobStatus`, `JobRowResult`, `JobResponse`, `StartJobResponse`; added `'polling'` to `AppState`
- **`api.ts`** — replaced `submitRows` with `startJob`, added `getJob`, `retryJob`
- **`store.ts`** — added `jobId`, `jobResponse` fields; added `setPolling`, `updateJobResponse`, `cancelSubmit` actions
- **`PollingScreen`** — new full-screen component: live progress bar, per-row status table, attempt counter, "Reintentar filas fallidas" button (shown when `attemptNumber < maxRetries`)
- **`ActionBar`** — submit path now calls `startJob()` → `setPolling(jobId)`; on failure calls `cancelSubmit()` to return to loaded state
- **`App`** — renders `PollingScreen` when `appState === 'polling'`
- 176 frontend tests pass (16 new `PollingScreen.test.tsx`)

---

## v0.1 — 2026-04-24

Initial working release.

### Frontend
- CSV upload via drag-and-drop or file picker (Tauri + React 19)
- AG Grid table with inline editing for `diasNoLaborados`, `horasExtrasSimples`, `horasExtrasDobles`
- Quincena + month selection banner; multi-month CSV support
- Validation flow: `POST /api/validate` with per-row error display
- Submit flow: `POST /api/submit` with per-row result display
- 15-second timeout on validation call (`Promise.race`); alert on timeout or network error
- Stale validation result discard: selection snapshot compared after async call resolves
- DB health polling after validation passes; submit button gated on reachability
- Material Design 3 design system (custom tokens, Tailwind utility classes)
- Full Vitest unit test suite (~100% coverage)

### Backend
- Spring Boot 3 REST API on port 49301
- `POST /api/upload` — parses CSV, returns rows + parse warnings
- `POST /api/validate` — validates rows against rules in `validation-rules.json`
- `POST /api/submit` — calls `carga_datos_empleados` stored procedure per row; short-circuits on DB connection failure
- `GET /api/health` — liveness probe
- `GET /api/db-health` — PostgreSQL reachability probe (2 s axios timeout, 5 s JDBC timeout)
- Dual DataSource: PostgreSQL (remote, stored proc) + H2 (local file, duplicate detection log)
- HikariCP with `connectTimeout=3s`, `socketTimeout=30s` on PostgreSQL driver
- Per-row duplicate detection via H2 `carga_log` table
- `~99%` instruction coverage in unit + integration tests
