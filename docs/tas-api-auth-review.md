# TAS API Authentication & Authorization Review

**Date:** 2026-06-17
**Task:** TASK-12

## Current Posture (Before This Review)

The TAS backend had **no authentication or authorization** on any endpoint:

- 0 of 26 endpoints required authentication
- All controllers used `@CrossOrigin(origins = "*")` — any website could make requests to the local API
- No Spring Security dependency, no filters, no CSRF protection
- Employee and holiday IDs are sequential (guessable/enumerable)
- Upload session tokens (UUIDs) have no expiration

### Endpoint Inventory

| Controller | Base Path | Endpoints | Sensitive Actions |
|---|---|---|---|
| HealthController | `/api` | 2 GET | DB status exposure |
| TasController | `/api/tas` | 7 POST/GET | CSV upload, payroll submission, employee deactivation |
| AppConfigController | `/api/config/general` | 1 GET, 1 PUT | Modify payroll processing parameters |
| EmployeeRegistryController | `/api/config/employees` | 2 GET, 2 POST, 1 PUT, 1 PATCH | Modify employee records, bulk assign shifts |
| HolidayController | `/api/config/holidays` | 2 GET, 1 POST, 1 DELETE | Add/remove holidays |
| ShiftConfigController | `/api/config/shifts` | 1 GET, 1 POST, 1 PUT, 1 DELETE | Create/modify/delete shift definitions |

## Deployment Context

This is a **Tauri 2 desktop application**:

- The Spring Boot backend runs on `localhost:49301`, embedded within the Tauri app
- Each user runs their own instance — there is no shared server
- The app is not internet-facing
- Single-user per desktop; no multi-user access control needed
- The frontend communicates from Tauri's webview (`tauri://localhost`) or the Vite dev server (`http://localhost:5173`)

## Decision: No Full Auth Layer — Tighten CORS Instead

Adding token-based authentication (JWT, OAuth2, sessions) would be **disproportionate** for a single-user desktop app. The backend is a local process that only the running user should access.

The **real risk** was the `@CrossOrigin(origins = "*")` annotation: any website the user visited in a browser could silently make cross-origin requests to `localhost:49301` and invoke payroll operations (e.g., deactivate employees, submit data, change shift configs). This is a known class of attack against local services.

### What Was Done

1. **Replaced per-controller `@CrossOrigin(origins = "*")`** with a centralized `CorsConfig` that restricts allowed origins to:
   - `http://localhost:5173` — Vite dev server
   - `tauri://localhost` — Tauri 2 webview (macOS/Linux)
   - `https://tauri.localhost` — Tauri 2 webview (Windows)

2. **Added CORS tests** verifying allowed origins receive headers and disallowed origins are rejected.

### What Was NOT Done (and Why)

| Item | Reason Deferred |
|---|---|
| Spring Security / JWT auth | Overkill for single-user desktop app; no multi-user scenario |
| CSRF tokens | No cookie-based sessions to protect; CORS restriction is sufficient |
| Rate limiting | Local app; no external attack surface |
| Token expiration for upload sessions | Low risk — tokens are UUIDs in memory, hard to guess, cleared on restart |
| Sequential ID obfuscation | No unauthenticated network access after CORS fix |
| DB credential externalization | Tracked separately in TASK-48 |

### When to Revisit

If the app's deployment model changes (e.g., web-hosted, multi-user, or exposed beyond localhost), a full auth layer should be added at that point.

## Hostile-input contract (TASK-88, 2026-11-16)

`backend/src/test/java/com/planilla/backend/security/ApiHostileInputContractTest.java` derives the
whole `/api` surface at run time from Spring's `RequestMappingHandlerMapping` (31 endpoints when it was
added) and sends every one of them garbage JSON, wrong-typed fields, missing / oversized / unknown upload
tokens (in the body and in path variables) and malformed fields carrying a valid token — about 2,800
requests. A new endpoint is attacked automatically.

It asserts:

- **Every `/api/tas/**` endpoint:** no 5xx and no unhandled exception.
- **Every `/api` endpoint:** a request without the victim session's token never returns that session's
  data and never changes it. "Changes" is checked by comparing the victim's full serialized state, in
  memory and in the saved draft (minus the idle clock and save time), before and after each request —
  not just its revision.
- **Ratchet on the rest:** the observed 5xx failures must equal the OPEN map below exactly, **per
  endpoint, failure kind and count**, so a newly failing endpoint, a new kind of 5xx on an already-listed
  endpoint, or more of a known one fails the build, and a fix must shrink the map.

Proven able to fail:
- a planted `POST /api/tas/plant-5xx` (casts `uploadToken` without a check) and a planted
  `GET /api/tas/plant-leak` (returns every in-memory session) failed with
  `unhandled ServletException ... NullPointerException` and `leaked the victim session without its token`;
- a planted `POST /api/tas/plant-mutate` that renames the sessions of every in-memory state **without
  bumping the revision** (invisible to the earlier revision/draft-token check) failed with
  `changed the victim session without its token`;
- a planted `IllegalStateException` in `POST /api/config/holidays` (an already-listed endpoint) failed with
  `{"unhandled ClassCastException"=14, "unhandled IllegalStateException"=1}` against the pinned
  `{"unhandled ClassCastException"=14}`.

All plants were removed.

### By design, not a finding

| Endpoint | Why it is token-less |
|---|---|
| `GET /api/tas/draft`, `POST /api/tas/draft/resume` | Single-user app bound to `127.0.0.1` with exactly one saved draft; the start screen must find it without a token. |
| `DELETE /api/tas/draft`, `POST /api/tas/upload` | Discarding the draft, or replacing it with a new upload, is the user's own action on the only draft. |

### Findings

| ID | Finding | Status |
|---|---|---|
| H-1 | TAS endpoints threw `ClassCastException` / `NullPointerException` (HTTP 500) on a non-string or missing `uploadToken`, a non-list `reactivate`/`ignore`/`employeeIds`/`resolutions`, non-numeric period fields, or a non-boolean `active`. | **FIXED** — validated before use; CLOSED-by-test. |
| H-2 | `/resolve` applied entries one by one and could return 400 halfway, leaving a half-applied batch. | **FIXED** — the batch is validated first, then applied under the session lock; CLOSED-by-test (`TasControllerDraftTest`). |
| H-3 | `POST /api/config/shifts`, `PUT /api/config/shifts/{id}`, `PUT /api/config/employees/{id}`, `POST /api/config/employees/bulk-assign`, `POST /api/config/holidays` cast body fields without type checks: a wrong-typed field is an unhandled `ClassCastException` / `NullPointerException` (HTTP 500). No data leak, no session change. | **OPEN** — pinned per kind and count in the test's `KNOWN_OPEN_5XX`. |
| H-4 | Two submissions could run at once for different upload tokens (reload while polling → discard → re-upload the same CSV), loading the same payroll rows twice; the duplicate check reads `carga_log`, written only after each row returns. | **FIXED** — `/submit` and retry refuse with 409 `JOB_IN_PROGRESS` while any job is active, and the start card hides Descartar while one runs; CLOSED-by-test (`JobServiceTest`, `TasControllerJobConcurrencyTest`). |
| H-5 | A draft PUT landing between a finished job's draft delete and its state removal rewrote the draft, offering a fully submitted session on the next start. | **FIXED** — delete and removal run under the state's lock, so the PUT's identity check 409s; CLOSED-by-test (`TasControllerJobConcurrencyTest`). |

Not proven: behaviour under concurrent hostile requests, request bodies larger than ~100 KB, and
non-JSON content types other than multipart on the upload endpoint.

