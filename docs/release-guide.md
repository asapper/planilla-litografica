# Release Guide — Cargador de Planilla

How to build, release, and deliver new versions of the app.

---

## Quick Reference

| Platform | Build method | Installer format | Delivery |
|----------|-------------|-----------------|----------|
| Windows | GitHub Actions (automatic on tag) | `.msi` | GitHub Release download link |
| macOS | Local build on Mac | `.dmg` | Send file directly |

---

## Windows Release (automated)

### Steps

1. **Update the version** in `frontend/src-tauri/tauri.conf.json`:

   ```json
   "version": "1.1.0"
   ```

2. **Commit the version bump:**

   ```bash
   git add frontend/src-tauri/tauri.conf.json
   git commit -m "release: v1.1.0"
   ```

3. **Tag and push:**

   ```bash
   git tag v1.1.0
   git push origin master
   git push origin v1.1.0
   ```

4. **Wait ~10 minutes.** The GitHub Actions workflow builds the MSI and creates a Release automatically.

5. **Verify** at: `https://github.com/asapper/planilla-litografica/releases/tag/v1.1.0`

### Manual trigger (without creating a release)

Go to GitHub → Actions → "Build Windows Installer" → Run workflow. This builds the MSI and uploads it as a workflow artifact (no Release created). Useful for testing.

### Prerequisites

These repository secrets must be set in GitHub (Settings → Secrets → Actions):

- `POSTGRES_DB_USERNAME` — PostgreSQL username
- `POSTGRES_DB_PASSWORD` — PostgreSQL password

These were set up during initial setup and shouldn't need to change.

---

## macOS Release (manual)

macOS builds must be done locally on a Mac because the GitHub Actions macOS runners don't have access to the ARM64 JRE and Rust toolchain needed for Apple Silicon.

### Prerequisites

Install these once:

- **Rust:** `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Node.js 24:** `brew install node`
- **Java 21:** `brew install --cask temurin`

### Steps

1. **Update the version** in `frontend/src-tauri/tauri.conf.json` (if not already done for Windows).

2. **Build the backend JAR:**

   ```bash
   cd backend
   ./mvnw -B package
   cp target/planilla-backend-0.0.1-SNAPSHOT.jar ../frontend/src-tauri/binaries/backend.jar
   ```

3. **Ensure the JRE is in place** at `frontend/src-tauri/binaries/jre/`. If missing, create a minimal JRE:

   ```bash
   jlink --add-modules java.base,java.sql,java.naming,java.logging,java.management,java.xml,java.desktop,java.net.http,jdk.crypto.ec,jdk.crypto.cryptoki,jdk.unsupported,jdk.zipfs \
     --output frontend/src-tauri/binaries/jre --no-header-files --no-man-pages --strip-debug --compress zip-6
   ```

4. **Build the Tauri app:**

   ```bash
   cd frontend
   npm ci
   npx tauri build
   ```

5. **Find the installer** at:
   - DMG: `frontend/src-tauri/target/release/bundle/macos/*.dmg`
   - App: `frontend/src-tauri/target/release/bundle/macos/*.app`

---

## Delivering to the Client

### First-time installation

Send the client the installer file:

- **Windows:** Share the GitHub Release link. The client downloads the `.msi`, double-clicks to install, done.
- **macOS:** Send the `.dmg` file. The client opens it and drags the app to Applications.

No additional software or dependencies are required — the JRE and backend are bundled.

### Updating to a new version

The client downloads the new installer from the latest GitHub Release and installs it over the existing version:

- **Windows:** The new `.msi` automatically replaces the previous installation. No need to uninstall first.
- **macOS:** Drag the new `.app` over the old one in Applications and confirm the replacement.

**Data is preserved across updates.** The local H2 database (duplicate detection log) is stored in `~/.planilla/data/`, outside the app directory.

### Providing the download link

After a release, share this permanent link format with the client:

```
https://github.com/asapper/planilla-litografica/releases/latest
```

This always points to the newest release. The client bookmarks it and checks back when you tell them a new version is available.

For a specific version:

```
https://github.com/asapper/planilla-litografica/releases/tag/v1.0.0
```

### Network requirement

The app requires access to the PostgreSQL database at `192.168.0.20:5432`. The client's machine must be on the company's internal network.

---

## Version Numbering

Use semantic versioning: `vMAJOR.MINOR.PATCH`

- **MAJOR** (v2.0.0): Breaking changes, major redesigns
- **MINOR** (v1.1.0): New features, significant improvements
- **PATCH** (v1.0.1): Bug fixes, small tweaks

Update the version in `frontend/src-tauri/tauri.conf.json` before tagging.
