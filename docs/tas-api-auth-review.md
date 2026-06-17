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
