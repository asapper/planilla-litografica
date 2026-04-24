# Changelog

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
