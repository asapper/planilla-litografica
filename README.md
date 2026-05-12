# Cargador de Planilla

A Tauri desktop application for loading payroll CSV attendance reports into a remote PostgreSQL database. Payroll staff upload a CSV, review and edit the extracted employee rows, validate the data, and submit it — no database access or technical knowledge required.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 (Rust) |
| Frontend | React 18 + TypeScript, Vite, Zustand, Tailwind CSS (Material Design 3 tokens) |
| Frontend tests | Vitest + Testing Library |
| Backend | Spring Boot (Java 21), Apache Commons CSV |
| Backend tests | JUnit 5 + Mockito + MockMvc |
| Remote DB | PostgreSQL — stored procedure `public.carga_datos_empleados(...)` |
| Local DB | Embedded H2 — `carga_log` table for duplicate detection |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Tauri shell (Rust)                          │
│  ┌─────────────────┐  ┌────────────────────┐│
│  │  React frontend │  │  Spring Boot       ││
│  │  (Vite, port    │◄─►│  backend           ││
│  │   5173 in dev)  │  │  (port 49301)      ││
│  └─────────────────┘  └────────┬───────────┘│
└───────────────────────────────┼────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
     ┌────────▼───────┐  ┌──────▼──────┐    Remote
     │  H2 (local)    │  │ PostgreSQL  │    192.168.0.20:5432
     │  duplicate log  │  │ stored proc │
     └────────────────┘  └─────────────┘
```

The Tauri shell bundles the Spring Boot JAR and a JRE alongside the frontend. On launch, Tauri starts the backend process; the frontend polls `/health` until it responds, then shows the upload screen.

### App State Flow

`empty → loaded → submitting → polling → result`

1. **empty** — drag-drop or file picker to upload a CSV
2. **loaded** — review/edit the data grid, select quincena, validate, submit
3. **submitting** — spinner overlay while the job starts
4. **polling** — polls `GET /api/jobs/{jobId}` every 1.5 s until `DONE` or `DONE_WITH_ERRORS`
5. **result** — success/partial/error summary with option to start over

### API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/upload` | Parse CSV, extract employee rows |
| `POST` | `/api/validate` | Validate rows + duplicate check |
| `POST` | `/api/submit` | Start async submission job |
| `GET` | `/api/jobs/{jobId}` | Poll job status |
| `POST` | `/api/jobs/{jobId}/retry` | Retry a failed job |
| `GET` | `/api/health` | Backend startup probe |
| `GET` | `/api/db-health` | PostgreSQL connectivity check |

---

## Development Setup

### Prerequisites

| Tool | Minimum version |
|---|---|
| Node.js | 22 LTS |
| JDK | 21 |
| Rust | 1.77.2 |
| Maven | bundled via `mvnw` |

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

Written to `backend/logs/planilla.log`.

---

## Project Structure

```
planilla-lito/
├── backend/                  Spring Boot backend
│   └── src/main/java/com/planilla/backend/
│       ├── controller/       Upload, Validate, Job, Health controllers
│       ├── service/          CsvParserService, ValidationService, DatabaseService, JobService
│       └── config/           DataSourceConfig, ValidationRulesConfig, AsyncConfig
├── frontend/                 React + Tauri frontend
│   ├── src/
│   │   ├── components/       UI components (EmptyState, DataGrid, ActionBar, …)
│   │   ├── store.ts          Zustand state store
│   │   ├── api.ts            Axios API client
│   │   └── types.ts          Shared TypeScript interfaces
│   └── src-tauri/            Tauri shell (Rust)
│       └── binaries/         Bundled backend.jar + JRE
├── config/                   Runtime config (validation-rules.json)
├── docs/                     Design specs, API spec, CSV mapping, user manual
└── instructions.md           Developer build instructions
```

---

## Pre-built JAR

A pre-built backend JAR is available at `binaries/planilla-backend-0.0.1-SNAPSHOT.jar` if you want to run the backend without Maven:

```bash
java -jar binaries/planilla-backend-0.0.1-SNAPSHOT.jar
```
