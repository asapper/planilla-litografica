# Running Planilla Lito

Open two terminal tabs — one for each process.

## Backend (Spring Boot — port 49301)

```bash
cd backend
./mvnw spring-boot:run
```

Starts when you see: `Started PlanillaBackendApplication`

## Frontend (Vite — port 5173)

```bash
cd frontend
npm run dev
```

Open: http://localhost:5173

## Release Build (macOS app bundle)

These steps produce a signed `.app` in `frontend/src-tauri/target/release/bundle/macos/`.

**1. Build the backend JAR**

```bash
cd backend
./mvnw clean package -DskipTests
```

**2. Copy the JAR into the Tauri resources directory**

```bash
cp backend/target/planilla-backend-0.0.1-SNAPSHOT.jar frontend/src-tauri/binaries/backend.jar
```

**3. Build the Tauri app**

```bash
cd frontend
npm run tauri build
```

This runs `npm run build` (TypeScript + Vite) and then compiles the Rust shell and bundles everything into the `.app`.

## Release Build (Windows executable)

Must be run on a Windows machine — Tauri does not support cross-compilation from macOS to Windows. Output lands in `frontend\src-tauri\target\release\bundle\nsis\` (NSIS installer) and `frontend\src-tauri\target\release\` (bare `.exe`).

### Windows Prerequisites

Complete these once on the machine before attempting any build.

---

**1. Visual Studio C++ Build Tools**

Rust on Windows requires the MSVC linker and Windows SDK.

- Download **Visual Studio Build Tools 2022** from https://visualstudio.microsoft.com/visual-cpp-build-tools/
- In the installer, select the **"Desktop development with C++"** workload
- Ensure these components are checked: MSVC v143 compiler, Windows 11 SDK (or 10 SDK)

Verify (in a new terminal after install):
```powershell
cl
# Expected: Microsoft (R) C/C++ Optimizing Compiler ... error D8003 (no input — that's fine, compiler is present)
```

---

**2. Rust**

Minimum version: 1.77.2. The MSVC toolchain (not GNU) is required.

```powershell
# Download and run rustup-init.exe from https://rustup.rs/
# When prompted, choose option 1 (default install) — it selects MSVC automatically
rustup default stable
```

Verify:
```powershell
rustc --version   # e.g. rustc 1.77.2 (...)
cargo --version   # e.g. cargo 1.77.2 (...)
rustup show       # confirm active toolchain ends in -msvc, not -gnu
```

---

**3. Node.js**

Install Node.js 22 LTS or later from https://nodejs.org/ (the macOS build uses Node 24).

Verify:
```powershell
node --version    # v22.x.x or higher
npm --version
```

---

**4. JDK 21**

Required for `mvnw.cmd` to compile the Spring Boot backend.

- Download **JDK 21** (e.g. Eclipse Temurin) from https://adoptium.net/
- During install, check the option to **set JAVA_HOME** and **add to PATH**
- If set manually: `JAVA_HOME` must point to the JDK root (not the JRE subdirectory)

Verify:
```powershell
java --version    # openjdk 21.x.x
javac --version   # javac 21.x.x
echo $Env:JAVA_HOME   # e.g. C:\Program Files\Eclipse Adoptium\jdk-21...
```

---

**5. WebView2 Runtime**

Required by Tauri at runtime (and during build for the bundler). Already present on Windows 11. On Windows 10, install the Evergreen runtime from https://developer.microsoft.com/microsoft-edge/webview2/.

Verify (Windows 11 — should already pass):
```powershell
Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
# Returns a pv property with the WebView2 version if installed
```

---

**6. Windows JRE 21 for bundling**

This is separate from the build JDK above — it is the JRE that gets embedded inside the app and shipped to end users. The repo's `frontend/src-tauri/binaries/jre/` contains a macOS arm64 JRE and must be replaced.

- Download a **Windows x64 JRE 21** from https://adoptium.net/ (choose JRE, not JDK; Windows x64)
- Extract it and replace the contents of `frontend\src-tauri\binaries\jre\` so the layout is:
  ```
  frontend\src-tauri\binaries\jre\bin\java.exe
  frontend\src-tauri\binaries\jre\lib\
  frontend\src-tauri\binaries\jre\conf\
  frontend\src-tauri\binaries\jre\release
  ```

Verify:
```powershell
frontend\src-tauri\binaries\jre\bin\java.exe --version
# Expected: openjdk 21.x.x — and it must not error with "not a valid Win32 application"
```

---

**0. Swap in a Windows JRE**

The repo's `frontend/src-tauri/binaries/jre/` contains a macOS arm64 JRE and must be replaced with a Windows x64 JRE before building. Download a Windows x64 JRE 17+ (e.g. from [Adoptium](https://adoptium.net/)) and extract it so the layout matches: `frontend/src-tauri/binaries/jre/bin/`, `jre/lib/`, `jre/conf/`, etc.

**1. Build the backend JAR**

```powershell
cd backend
.\mvnw.cmd clean package -DskipTests
```

**2. Copy the JAR into the Tauri resources directory**

```powershell
copy backend\target\planilla-backend-0.0.1-SNAPSHOT.jar frontend\src-tauri\binaries\backend.jar
```

**3. Build the Tauri app**

```powershell
cd frontend
npm run tauri build
```

---

## Notes

- Backend uses a local H2 database at `~/.planilla/data/planilla-log` and connects to PostgreSQL at `192.168.0.20:5432` for stored procedure execution.
- Backend logs are written to `~/.planilla/logs/planilla-lito.log`.
- A pre-built JAR is available at `binaries/planilla-backend-0.0.1-SNAPSHOT.jar` if you want to run without Maven: `java -jar binaries/planilla-backend-0.0.1-SNAPSHOT.jar`
