# Cargador de Planilla

A Tauri desktop app for processing TAS (Time & Attendance System) attendance reports. Payroll staff upload a TAS export, review shift-matching results, resolve ambiguities, and submit the processed data to a remote PostgreSQL database — no database access or technical knowledge required.

---

## Tech Stack

| Layer          | Technology                                                                    |
|----------------|-------------------------------------------------------------------------------|
| Desktop shell  | Tauri 2 (Rust)                                                                |
| Frontend       | React 18 + TypeScript, Vite, Zustand, Tailwind CSS (Material Design 3 tokens) |
| Frontend tests | Vitest + Testing Library                                                      |
| Backend        | Spring Boot (Java 21)                                                         |
| Backend tests  | JUnit 5 + Mockito + MockMvc                                                   |
| Remote DB      | PostgreSQL — stored procedure `public.carga_datos_empleados(...)`             |
| Local DB       | Embedded H2 — `carga_log` table for duplicate detection                       |

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  Tauri shell (Rust)                          │
│  ┌─────────────────┐   ┌────────────────────┐│
│  │  React frontend │   │  Spring Boot       ││
│  │  (Vite, port    │◄─►│  backend           ││
│  │   5173 in dev)  │   │  (port 49301)      ││
│  └─────────────────┘   └────────┬───────────┘│
└─────────────────────────────────┼────────────┘
                                  │
              ┌───────────────────┼──────────────────┐
              │                   │                  │
     ┌────────▼────────┐  ┌──────▼──────┐    Remote
     │  H2 (local)     │  │ PostgreSQL  │    192.168.0.20:5432
     │  duplicate log  │  │ stored proc │
     └─────────────────┘  └─────────────┘
```

The Tauri shell bundles the Spring Boot JAR and a JRE alongside the frontend. On launch, Tauri starts the backend process; the frontend polls `/health` until it responds, then shows the upload screen.

---

## App Flow

The TAS view follows this state machine:

`idle → processing → inactiveReview → verification → review → submitting → polling → result`

1. **idle** — Upload a TAS CSV file via drag-drop or file picker
2. **processing** — Backend parses the TAS file and matches clock-in/out records to configured shifts
3. **inactiveReview** — If inactive employees are found, review and choose to reactivate or ignore them
4. **verification** — Review shift-matching results; resolve ambiguous sessions (best-fit, manual time, accept shift); select the pay period
5. **review** — Browse the resolved employee list, inspect per-employee session details, edit overtime overrides, check for duplicates
6. **submitting** — Submit the processed data to PostgreSQL
7. **polling** — Polls `GET /api/tas/jobs/{jobId}` every 1.5 s until `DONE` or `DONE_WITH_ERRORS`
8. **result** — Success/partial/error summary with option to retry or start over

### Screenshots

| Empty state | Verification | Review list | Config |
|:-----------:|:------------:|:-----------:|:------:|
| ![Empty state](docs/screenshots/01-empty-state.png) | ![Verification](docs/screenshots/04-verification-overview.png) | ![Review list](docs/screenshots/08-review-list.png) | ![Config](docs/screenshots/15-config-shifts.png) |

---

## API Endpoints

### TAS

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/tas/upload` | Parse TAS file, match sessions to shifts |
| `POST` | `/api/tas/inactive-review` | Submit inactive-employee decisions |
| `POST` | `/api/tas/resolve` | Submit verification resolutions + period |
| `POST` | `/api/tas/submit` | Start async submission job |
| `GET`  | `/api/tas/jobs/{jobId}` | Poll job status |
| `POST` | `/api/tas/jobs/{jobId}/retry` | Retry a failed job |
| `POST` | `/api/tas/check-duplicates` | Check for duplicate submissions |
| `POST` | `/api/tas/recompute/{token}` | Recompute resolved rows after config change |
| `GET`  | `/api/tas/absent-review/{token}` | Get absent employees for review |
| `POST` | `/api/tas/absent-review/{token}/deactivate` | Mark absent employees active/inactive |

### Configuration

| Method   | Path | Purpose |
|----------|------|---------|
| `GET`    | `/api/config/shifts` | List shifts |
| `POST`   | `/api/config/shifts` | Create shift |
| `PUT`    | `/api/config/shifts/{id}` | Update shift |
| `DELETE` | `/api/config/shifts/{id}` | Delete shift |
| `GET`    | `/api/config/employees` | List employees (filter by active/shift/search) |
| `PUT`    | `/api/config/employees/{id}` | Update employee (shift, active) |
| `POST`   | `/api/config/employees/bulk-assign` | Bulk-assign shift to employees |
| `POST`   | `/api/config/employees/{id}/deactivate` | Deactivate employee |
| `PATCH`  | `/api/config/employees/{id}/accrues-overtime` | Toggle overtime accrual |
| `GET`    | `/api/config/holidays` | List holidays by year |
| `POST`   | `/api/config/holidays` | Create holiday |
| `DELETE` | `/api/config/holidays/{id}` | Delete holiday |
| `POST`   | `/api/config/holidays/refresh` | Refresh holidays for year |
| `GET`    | `/api/config/general` | Get general config |
| `PUT`    | `/api/config/general` | Update general config |

### Health

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/health` | Backend startup probe |
| `GET`  | `/api/db-health` | PostgreSQL connectivity check |

---

## Development Setup

### Prerequisites

| Tool    | Minimum version    |
|---------|--------------------|
| Node.js | 22 LTS             |
| JDK     | 21                 |
| Rust    | 1.77.2             |
| Maven   | bundled via `mvnw` |

### Run in development

Open two terminals:

**Terminal 1 — Backend**
```bash
cd backend
./mvnw spring-boot:run
# Ready when you see: Started PlanillaBackendApplication
```

**Terminal 2 — Frontend**
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

### Run tests

```bash
# Frontend (Vitest)
cd frontend
npm test

# Backend (JUnit)
cd backend
./mvnw test
```

Coverage targets: ~100% frontend, ~99% backend instruction coverage.

---

## Release Build

### macOS

```bash
# 1. Build the backend JAR
cd backend
./mvnw clean package -DskipTests

# 2. Copy JAR into Tauri resources
cp backend/target/planilla-backend-0.0.1-SNAPSHOT.jar frontend/src-tauri/binaries/backend.jar

# 3. Build the Tauri app
cd frontend
npm run tauri build
```

Output: `frontend/src-tauri/target/release/bundle/macos/Cargador de Planilla.app`

### Windows

Must be built on a Windows machine (Tauri does not support cross-compilation from macOS).

See [`instructions.md`](instructions.md) for the full Windows prerequisites checklist (MSVC build tools, Rust MSVC toolchain, Node.js, JDK 21, WebView2, Windows JRE).

```powershell
# 1. Build backend JAR
cd backend
.\mvnw.cmd clean package -DskipTests

# 2. Copy JAR
copy backend\target\planilla-backend-0.0.1-SNAPSHOT.jar frontend\src-tauri\binaries\backend.jar

# 3. Build Tauri app
cd frontend
npm run tauri build
```

Output: `frontend\src-tauri\target\release\bundle\nsis\` (NSIS installer) and `frontend\src-tauri\target\release\Cargador de Planilla.exe`

> **Note:** `frontend/src-tauri/binaries/jre/` must contain a Windows x64 JRE 21 before building on Windows. The repo ships a macOS arm64 JRE — replace it with a Windows JRE from [Adoptium](https://adoptium.net/).

---

## Configuration

### PostgreSQL connection

Edit `backend/src/main/resources/application.properties`:

```properties
spring.datasource.postgres.url=jdbc:postgresql://192.168.0.20:5432/planilla?connectTimeout=5&socketTimeout=30
spring.datasource.postgres.username=...
spring.datasource.postgres.password=...
```

Both `connectTimeout` and `socketTimeout` must be set as JDBC URL parameters. HikariCP's `connectionTimeout` alone does not bound TCP connect time.

### Validation rules

Rules live in `config/validation-rules.json` (file system, takes precedence) or fall back to the classpath copy at `backend/src/main/resources/validation-rules.json`. Edit to adjust field constraints (required, type, min/max) without recompiling.

### Local H2 database

The duplicate-detection log is stored at `~/.planilla/data/planilla-log` (created automatically on first run).

### Backend logs

Written to `~/.planilla/logs/planilla-lito.log`.

---

## Pre-built JAR

A pre-built backend JAR is available at `binaries/planilla-backend-0.0.1-SNAPSHOT.jar` if you want to run the backend without Maven:

```bash
java -jar binaries/planilla-backend-0.0.1-SNAPSHOT.jar
```
