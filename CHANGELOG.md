# Changelog

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
