# Changelog

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
