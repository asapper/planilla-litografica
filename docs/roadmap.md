# Project Roadmap — Planilla Lito
**Owner:** Atlas — Project Manager
**Last updated:** 2026-04-23

---

## Phase 0 — Foundation ✅ COMPLETE
*No code. Everything the build team needs to start work without ambiguity.*

| Task | Owner | Output | Status |
|---|---|---|---|
| Product Requirements Document | Sofia | `docs/PRD.md` | Done |
| UI/UX Design Specification | Nico | `docs/design-spec.md` | Done |
| CSV Parsing & Mapping Spec | Drew | `docs/csv-mapping.md` | Done |
| Validation Rules Spec + Config | Marco | `docs/validation-rules.md`, `config/validation-rules.json` | Done |
| REST API Contract (OpenAPI) | Marco + Lena | `docs/api-spec.yaml` | Done |

---

## Phase 1 — Parallel Build ✅ COMPLETE — Design approved 2026-04-21
*Frontend and backend built independently against the agreed API contract.*

| Task | Owner | Status |
|---|---|---|
| Scaffold React + TypeScript + Vite frontend | Lena | Done |
| Install AG Grid, Zustand, Axios | Lena | Done |
| Scaffold Spring Boot backend | Marco | Done |
| Implement CSV upload component (file picker + drag-and-drop) | Lena | Done |
| Implement AG Grid with inline validation highlighting | Lena | Done |
| Implement Quincena selector banner (Q1/Q2 + month toggle) | Lena | Done |
| Implement Action bar (error/duplicate badges + submit button) | Lena | Done |
| Implement Result screen (success / partial / full failure) | Lena | Done |
| Zustand state store | Lena | Done |
| POST /api/upload — CSV parse endpoint | Marco | Done |
| POST /api/validate — validation + duplicate check endpoint | Marco | Done |
| POST /api/submit — stored proc execution endpoint | Marco | Done |
| CSV parser service (multi-block format, ISO-8859-1) | Marco | Done |
| Validation engine (reads JSON config) | Marco | Done |
| Dual datasource config (PostgreSQL + H2) | Marco + Drew | Done |
| Duplicate detection via local H2 log | Drew | Done |
| Stored procedure call via PostgreSQL JDBC | Drew | Done |
| H2 schema auto-init on startup | Drew | Done |

**Gate cleared:** Both frontend and backend compile clean.

---

## Phase 2 — Integration ✅ COMPLETE
*Frontend and backend talking to each other end-to-end with real data.*

| Task | Owner | Status |
|---|---|---|
| Connect frontend to live backend endpoints | Lena + Marco | Done |
| End-to-end test: upload → parse → quincena select → validate → submit | Full team | Done |
| Test duplicate detection with real submissions | Drew + Marco | Done |
| Test stored proc execution with real employee data | Drew + Marco | Done |
| Fix integration bugs | Lena + Marco | Done |

**Gate to Phase 3:** Full happy path works end-to-end with real data. Duplicate blocking confirmed.

---

## Phase 3 — Polish & Packaging 🔄 IN PROGRESS
*App is ready for a non-technical user to run on Windows.*

| Task | Owner | Status |
|---|---|---|
| Install Rust + Tauri and wrap the React app | Lena | Done |
| Tauri build pipeline validated on Mac | Lena | Done — Mac app runs clean |
| UI polish pass against design spec | Lena + Nico | Pending |
| Edge case handling (malformed CSV, DB unreachable, proc failure) | Marco + Lena | Pending |
| Tauri build pipeline validated on Windows | Lena | Pending |
| Windows smoke test (install, run, full flow) | Full team | Pending |

**Gate to Phase 4:** Windows smoke test passes end-to-end.

---

## Phase 4 — Handoff 🔜
*App is deliverable and maintainable.*

| Task | Owner | Status |
|---|---|---|
| User-facing usage guide (non-technical, Spanish) | Sofia | Pending |
| Config and deployment notes for technical admin | Marco + Drew | Pending |
| Final review | Atlas + user | Pending |

---

## Key Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Frontend stack | React + TypeScript + Vite + AG Grid Community | Fast, well-supported, no Enterprise license needed |
| Desktop packaging | Tauri (Phase 3) | Lighter than Electron, cross-platform |
| Backend | Java Spring Boot 3.5 | Secure, thin layer, good JDBC support |
| State management | Zustand | Lightweight, no boilerplate |
| CSV parsing | Custom Java parser + PapaParse | Handles multi-block non-standard format |
| Validation rules | JSON config file | Admin-editable without code changes |
| Duplicate detection | Local H2 file DB | No DDL access needed on remote DB |
| Time conversion | HH:MM:SS → total hours, rounded | Matches proc's integer parameter expectation |
| Quincena UX | Post-upload toggle (Q1/Q2) + auto-derived month | No friction before user sees data |
| Multi-month files | Show month selector (pill toggle) | User knows their payroll calendar |
| Duplicate policy | Block entirely, no override | Safety first for payroll data |
| Auth | None | Single-user desktop app |
| UI language | Spanish only | Non-technical users |
