use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

/// The backend we spawned, and the per-launch secret that lets us ask it to shut down.
struct ManagedBackend {
    child: std::process::Child,
    shutdown_token: String,
}

struct BackendProcess(Mutex<Option<ManagedBackend>>);

/// Set while the window is closing; `close_ready` releases the wait early.
struct CloseGate {
    closing: AtomicBool,
    ready: Mutex<Option<mpsc::Sender<()>>>,
}

/// How long the window waits for the frontend to save its draft before closing anyway.
const FRONTEND_SAVE_WAIT: Duration = Duration::from_secs(2);
/// How long the backend gets to close H2 and exit after the shutdown request, before kill().
const BACKEND_EXIT_WAIT: Duration = Duration::from_secs(5);
const APP_CLOSE_EVENT: &str = "app-close-requested";

/// What the shell knows about the backend it launched, surfaced to the frontend
/// so a failed start shows a specific error instead of a generic health timeout.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum BackendStatus {
    /// Dev build, or a pre-existing backend we reused but don't own.
    Unmanaged,
    #[cfg_attr(debug_assertions, allow(dead_code))]
    Running { port_free_at_spawn: bool },
    PortBlocked { port: u16 },
    Exited {
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
}

struct BackendStatusState(Mutex<BackendStatus>);

/// Re-evaluates a `Running` status against the child process. An early exit is
/// attributed to the port when the pre-spawn bind check had already failed.
fn refresh_backend_status(
    status: BackendStatus,
    child: Option<&mut std::process::Child>,
    port: u16,
) -> BackendStatus {
    let BackendStatus::Running { port_free_at_spawn } = status else {
        return status;
    };
    let Some(child) = child else {
        return status;
    };
    match child.try_wait() {
        Ok(Some(exit)) if !port_free_at_spawn => {
            log::error!("backend exited during startup ({exit}); port {port} was not bindable");
            BackendStatus::PortBlocked { port }
        }
        Ok(Some(exit)) => {
            log::error!("backend exited during startup ({exit})");
            BackendStatus::Exited { exit_code: exit.code() }
        }
        _ => status,
    }
}

#[tauri::command]
fn backend_status(
    process: tauri::State<BackendProcess>,
    status: tauri::State<BackendStatusState>,
) -> BackendStatus {
    let mut status = status.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut backend = process.0.lock().unwrap_or_else(|e| e.into_inner());
    *status = refresh_backend_status(*status, backend.as_mut().map(|b| &mut b.child), BACKEND_PORT);
    *status
}

#[tauri::command]
fn close_ready(gate: tauri::State<CloseGate>) {
    if let Some(ready) = gate.ready.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = ready.send(());
    }
}

/// A per-launch secret for the backend's shutdown endpoint. `RandomState` is seeded from the OS's
/// randomness, so two hashes give 128 unpredictable bits without pulling in a crate.
#[cfg(any(not(debug_assertions), test))]
fn new_shutdown_token() -> String {
    use std::hash::{BuildHasher, Hasher};
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let mut parts = [0u64; 2];
    for (i, part) in parts.iter_mut().enumerate() {
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u128(nanos);
        h.write_u32(std::process::id());
        h.write_usize(i);
        *part = h.finish();
    }
    format!("{:016x}{:016x}", parts[0], parts[1])
}

/// Asks the backend to close its database and exit. Ok only when it accepted (202).
fn request_shutdown(port: u16, token: &str) -> std::io::Result<()> {
    use std::net::{SocketAddr, TcpStream};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(500))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    write!(
        stream,
        "POST /api/system/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Shutdown-Token: {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )?;
    let mut status_line = [0u8; 12];
    stream.read_exact(&mut status_line)?;
    if status_line.starts_with(b"HTTP/1.1 202") {
        Ok(())
    } else {
        Err(std::io::Error::other(format!(
            "backend refused shutdown: {}",
            String::from_utf8_lossy(&status_line)
        )))
    }
}

/// Polls the child until it exits or `timeout` passes. True once it has exited.
fn wait_for_exit(child: &mut std::process::Child, timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let Ok(Some(_)) = child.try_wait() {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Stops the backend so H2 closes cleanly; kill() only if it doesn't exit within `grace`.
fn stop_backend(mut backend: ManagedBackend, port: u16, grace: Duration) {
    let pid = backend.child.id();
    match request_shutdown(port, &backend.shutdown_token) {
        Ok(()) if wait_for_exit(&mut backend.child, grace) => {
            log::info!("backend (pid={pid}) shut down gracefully");
            return;
        }
        Ok(()) => log::warn!("backend (pid={pid}) accepted shutdown but did not exit in {grace:?}; killing it"),
        Err(e) => log::warn!("graceful shutdown of backend (pid={pid}) failed: {e}; killing it"),
    }
    let _ = backend.child.kill();
    let _ = backend.child.wait();
}

fn take_backend(app: &tauri::AppHandle) -> Option<ManagedBackend> {
    use tauri::Manager;
    let state = app.state::<BackendProcess>();
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    guard.take()
}

/// The window's close button: give the frontend a moment to save the draft, stop the backend
/// gracefully, then exit. A second click while this runs is ignored.
fn begin_close(app: &tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    let gate = app.state::<CloseGate>();
    if gate.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    let (ready_tx, ready_rx) = mpsc::channel();
    *gate.ready.lock().unwrap_or_else(|e| e.into_inner()) = Some(ready_tx);
    if let Err(e) = app.emit(APP_CLOSE_EVENT, ()) {
        log::warn!("could not ask the frontend to save before closing: {e}");
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if ready_rx.recv_timeout(FRONTEND_SAVE_WAIT).is_err() {
            log::warn!("frontend did not confirm its save within {FRONTEND_SAVE_WAIT:?}; closing anyway");
        }
        // The backend may take a few seconds to close the database; don't leave a dead window up.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
        if let Some(backend) = take_backend(&app) {
            stop_backend(backend, BACKEND_PORT, BACKEND_EXIT_WAIT);
        }
        app.exit(0);
    });
}

/// Strips the Windows verbatim/extended-length path prefix (`\\?\`).
///
/// `resource_dir()` returns paths carrying this prefix on Windows. The JVM
/// cannot load classes from a jar passed as `java -jar \\?\C:\...\backend.jar`,
/// so the prefix must be removed before spawning the backend. UNC verbatim
/// paths (`\\?\UNC\...`) are left untouched since they can't be simplified the
/// same way.
#[cfg(any(not(debug_assertions), test))]
fn strip_verbatim_prefix(path: &std::path::Path) -> PathBuf {
    let raw = path.to_string_lossy();
    match raw.strip_prefix(r"\\?\") {
        Some(stripped) if !stripped.starts_with("UNC\\") => PathBuf::from(stripped),
        _ => path.to_path_buf(),
    }
}

/// The fixed loopback port the bundled backend listens on. Must stay below 49152:
/// Windows hands out ports in 49152–65535 as ephemeral source ports for other
/// apps' outbound connections, and such a socket blocks the backend's bind.
const BACKEND_PORT: u16 = 41301;

/// Port used up to v1.2.1. A backend from that version still running after an
/// upgrade holds the H2 file lock, so we still probe it and terminate the orphan.
#[cfg(any(not(debug_assertions), test))]
const LEGACY_BACKEND_PORT: u16 = 49301;

/// Returns true if something is already accepting connections on `127.0.0.1:port`.
///
/// The backend uses an H2 *file* database, which is single-writer — a second
/// backend process would crash on `The file is locked`. So if a previous
/// instance is still running (e.g. left behind after an unclean exit), we reuse
/// it instead of spawning a duplicate that would collide on the DB lock.
#[cfg(any(not(debug_assertions), test))]
fn port_is_open(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok()
}

/// Returns true if `127.0.0.1:port` can be bound — the address the backend binds.
///
/// A connect probe can't see every conflict: another app's *outbound* socket can
/// hold the port as its ephemeral source port without listening on it. This is
/// only a diagnostic; we still spawn the backend either way.
#[cfg(any(not(debug_assertions), test))]
fn port_is_bindable(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Polls until nothing is listening on `port`, up to `attempts` times spaced by
/// `sleep`. Returns true once the port is free, false if it's still open when the
/// attempts run out. Used to wait for a terminated backend to release the port
/// (and thus the H2 file lock) before we spawn a replacement.
#[cfg(any(not(debug_assertions), test))]
fn wait_until_port_closed(port: u16, attempts: u32, sleep: std::time::Duration) -> bool {
    for _ in 0..attempts {
        if !port_is_open(port) {
            return true;
        }
        std::thread::sleep(sleep);
    }
    !port_is_open(port)
}

/// Terminates any bundled-JRE backend (`java -jar backend.jar`) left running from
/// a previous, unclean exit. We must own exactly one backend (H2 is single-writer),
/// so rather than reuse an orphan we can't manage, we kill it and spawn our own.
#[cfg(not(debug_assertions))]
fn terminate_orphan_backend() {
    use std::process::Command;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let status = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -like '*backend.jar*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        log_termination_result(status);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = Command::new("pkill").args(["-f", "backend.jar"]).status();
        log_termination_result(status);
    }
}

#[cfg(not(debug_assertions))]
fn log_termination_result(status: std::io::Result<std::process::ExitStatus>) {
    match status {
        Ok(s) => log::info!("orphan backend termination command exited: {s}"),
        Err(e) => log::warn!("failed to run orphan backend termination command: {e}"),
    }
}

#[tauri::command]
fn open_manual(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("could not resolve resource directory: {e}"))?;

    let bundled = resource_dir.join("manual_usuario.pdf");
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("manual_usuario.pdf");

    let pdf_path = if bundled.exists() {
        bundled
    } else if dev_path.exists() {
        dev_path
    } else {
        return Err("manual_usuario.pdf not found".into());
    };

    log::info!("open_manual: opening {}", pdf_path.display());
    open::that(&pdf_path).map_err(|e| format!("failed to open PDF: {e}"))
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        if let Some(mut backend) = self.0.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = backend.child.kill();
            let _ = backend.child.wait();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // A second launch must not start a competing backend (H2 is
            // single-writer); focus the existing window instead.
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![open_manual, backend_status, close_ready])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Manager;
                api.prevent_close();
                begin_close(window.app_handle());
            }
        })
        .manage(BackendProcess(Mutex::new(None)))
        .manage(CloseGate {
            closing: AtomicBool::new(false),
            ready: Mutex::new(None),
        })
        .manage(BackendStatusState(Mutex::new(BackendStatus::Unmanaged)))
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                use std::process::{Command, Stdio};
                use tauri::Manager;

                let resource_dir = app.path().resource_dir().map_err(|e| {
                    log::error!("could not resolve resource directory: {e}");
                    e
                })?;
                let resource_dir = strip_verbatim_prefix(&resource_dir);

                log::info!("resource_dir = {}", resource_dir.display());

                let java_bin = if cfg!(target_os = "windows") {
                    resource_dir.join("jre").join("bin").join("java.exe")
                } else {
                    resource_dir.join("jre").join("bin").join("java")
                };
                let jar = resource_dir.join("backend.jar");

                log::info!("java_bin = {}", java_bin.display());
                log::info!("jar      = {}", jar.display());

                if port_is_open(LEGACY_BACKEND_PORT) {
                    log::info!(
                        "a pre-1.2.2 backend is on 127.0.0.1:{LEGACY_BACKEND_PORT}; terminating it so it releases the H2 lock"
                    );
                    terminate_orphan_backend();
                    if !wait_until_port_closed(
                        LEGACY_BACKEND_PORT,
                        25,
                        std::time::Duration::from_millis(200),
                    ) {
                        log::warn!(
                            "legacy backend on 127.0.0.1:{LEGACY_BACKEND_PORT} did not exit; the new backend may fail on the H2 lock"
                        );
                    }
                }

                if port_is_open(BACKEND_PORT) {
                    log::info!(
                        "a backend is already on 127.0.0.1:{BACKEND_PORT} (orphaned from a previous run); terminating it before spawning our own"
                    );
                    terminate_orphan_backend();
                    // Wait for the port — and therefore the H2 file lock — to be
                    // released so our new backend doesn't collide on the single-writer DB.
                    if !wait_until_port_closed(
                        BACKEND_PORT,
                        25,
                        std::time::Duration::from_millis(200),
                    ) {
                        // Couldn't kill it (e.g. an elevated/AV-held JVM). Reusing the
                        // stubborn backend is safe; spawning a second would crash on the
                        // H2 lock. We don't own it, so it won't be torn down on exit.
                        log::warn!(
                            "backend on 127.0.0.1:{BACKEND_PORT} did not exit after termination; reusing it instead of spawning a duplicate"
                        );
                        return Ok(());
                    }
                }

                let port_free_at_spawn = port_is_bindable(BACKEND_PORT);
                if !port_free_at_spawn {
                    log::warn!(
                        "127.0.0.1:{BACKEND_PORT} is not bindable (likely another program's socket holds it); the backend will probably fail to start"
                    );
                }

                let home_dir = std::env::var("USERPROFILE")
                    .or_else(|_| std::env::var("HOME"))
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|_| std::path::PathBuf::from("."));
                let stderr_log_dir = home_dir.join(".planilla").join("logs");
                std::fs::create_dir_all(&stderr_log_dir).ok();

                let (stdout_stdio, stderr_stdio) = match std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(stderr_log_dir.join("backend-stderr.log"))
                {
                    Ok(log_file) => match log_file.try_clone() {
                        Ok(log_clone) => (Stdio::from(log_clone), Stdio::from(log_file)),
                        Err(e) => {
                            log::warn!("failed to clone log file handle; backend stdout will not be captured: {e}");
                            (Stdio::null(), Stdio::from(log_file))
                        }
                    },
                    Err(e) => {
                        log::warn!("failed to open backend log file; backend stdout/stderr will not be captured: {e}");
                        (Stdio::null(), Stdio::null())
                    }
                };

                let shutdown_token = new_shutdown_token();
                let mut command = Command::new(&java_bin);
                command
                    .args(["-jar", jar.to_str().unwrap_or_default()])
                    .env("PLANILLA_SHUTDOWN_TOKEN", &shutdown_token)
                    .stdout(stdout_stdio)
                    .stderr(stderr_stdio);

                // Don't pop up a console window for the backend JVM on Windows.
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
                    command.creation_flags(CREATE_NO_WINDOW);
                }

                let child = command.spawn().map_err(|e| {
                    log::error!(
                        "failed to spawn backend (java={} jar={}): {e}",
                        java_bin.display(),
                        jar.display()
                    );
                    e
                })?;

                log::info!("backend process spawned (pid={})", child.id());

                let state = app.state::<BackendProcess>();
                *state.0.lock().unwrap() = Some(ManagedBackend { child, shutdown_token });
                let status = app.state::<BackendStatusState>();
                *status.0.lock().unwrap() = BackendStatus::Running { port_free_at_spawn };
            }

            let _ = app;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    // Exits that skip the window's close button (quit from the OS, a crash in the
    // close flow) still stop the backend here — don't rely solely on `Drop`, which
    // may not run if the process fast-exits, leaving an orphaned JVM that locks the
    // DB (and, on Windows, the JRE DLLs during the next install).
    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if let Some(backend) = take_backend(app_handle) {
                log::info!("app exiting; stopping backend (pid={})", backend.child.id());
                stop_backend(backend, BACKEND_PORT, BACKEND_EXIT_WAIT);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::strip_verbatim_prefix;
    use std::path::{Path, PathBuf};

    /// Serializes tests that bind real ports or spawn processes: a child spawned
    /// mid-test briefly inherits open sockets, keeping a "released" port bound.
    static NET_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn net_lock() -> std::sync::MutexGuard<'static, ()> {
        NET_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn spawn_exiting(code: i32) -> std::process::Child {
        #[cfg(target_os = "windows")]
        let child = std::process::Command::new("cmd")
            .args(["/C", &format!("exit {code}")])
            .spawn();
        #[cfg(not(target_os = "windows"))]
        let child = std::process::Command::new("sh")
            .args(["-c", &format!("exit {code}")])
            .spawn();
        let mut child = child.unwrap();
        child.wait().unwrap();
        child
    }

    fn spawn_long_running() -> std::process::Child {
        #[cfg(target_os = "windows")]
        let child = std::process::Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
            .spawn();
        #[cfg(not(target_os = "windows"))]
        let child = std::process::Command::new("sleep").arg("30").spawn();
        child.unwrap()
    }

    #[test]
    fn port_is_bindable_reflects_listener_presence() {
        let _guard = net_lock();
        use super::port_is_bindable;
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(!port_is_bindable(port), "bound port must not be bindable");

        drop(listener);
        assert!(port_is_bindable(port), "released port must be bindable");
    }

    #[test]
    fn refresh_reports_exit_code_when_backend_dies_with_free_port() {
        let _guard = net_lock();
        use super::{refresh_backend_status, BackendStatus};
        let mut child = spawn_exiting(3);
        let status = refresh_backend_status(
            BackendStatus::Running { port_free_at_spawn: true },
            Some(&mut child),
            41301,
        );
        assert_eq!(status, BackendStatus::Exited { exit_code: Some(3) });
    }

    #[test]
    fn refresh_reports_port_blocked_when_backend_dies_after_failed_bind_check() {
        let _guard = net_lock();
        use super::{refresh_backend_status, BackendStatus};
        let mut child = spawn_exiting(1);
        let status = refresh_backend_status(
            BackendStatus::Running { port_free_at_spawn: false },
            Some(&mut child),
            41301,
        );
        assert_eq!(status, BackendStatus::PortBlocked { port: 41301 });
    }

    #[test]
    fn refresh_keeps_running_while_backend_is_alive() {
        let _guard = net_lock();
        use super::{refresh_backend_status, BackendStatus};
        let mut child = spawn_long_running();
        let running = BackendStatus::Running { port_free_at_spawn: true };
        let status = refresh_backend_status(running, Some(&mut child), 41301);
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(status, running);
    }

    #[test]
    fn refresh_leaves_non_running_statuses_untouched() {
        use super::{refresh_backend_status, BackendStatus};
        for status in [
            BackendStatus::Unmanaged,
            BackendStatus::PortBlocked { port: 41301 },
            BackendStatus::Exited { exit_code: None },
        ] {
            assert_eq!(refresh_backend_status(status, None, 41301), status);
        }
        let running = BackendStatus::Running { port_free_at_spawn: true };
        assert_eq!(refresh_backend_status(running, None, 41301), running);
    }

    #[test]
    fn backend_status_serializes_to_the_frontend_contract() {
        use super::BackendStatus;
        let json = |s: BackendStatus| serde_json::to_value(s).unwrap();
        assert_eq!(json(BackendStatus::Unmanaged), serde_json::json!({"state": "unmanaged"}));
        assert_eq!(
            json(BackendStatus::PortBlocked { port: 41301 }),
            serde_json::json!({"state": "port_blocked", "port": 41301})
        );
        assert_eq!(
            json(BackendStatus::Exited { exit_code: Some(1) }),
            serde_json::json!({"state": "exited", "exitCode": 1})
        );
        assert_eq!(
            json(BackendStatus::Running { port_free_at_spawn: true })["state"],
            "running"
        );
    }

    #[test]
    fn backend_ports_stay_out_of_windows_ephemeral_range() {
        use super::{BACKEND_PORT, LEGACY_BACKEND_PORT};
        assert!(BACKEND_PORT < 49152, "BACKEND_PORT must be below the Windows ephemeral range");
        assert_ne!(BACKEND_PORT, LEGACY_BACKEND_PORT);
    }

    #[test]
    fn shutdown_tokens_are_long_hex_and_differ() {
        use super::new_shutdown_token;
        let a = new_shutdown_token();
        let b = new_shutdown_token();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    /// A one-shot fake backend: records the request and answers with `status_line`.
    fn fake_backend(status_line: &'static str) -> (u16, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            conn.set_read_timeout(Some(std::time::Duration::from_secs(2))).unwrap();
            let mut buf = [0u8; 1024];
            let n = conn.read(&mut buf).unwrap_or(0);
            let _ = write!(conn, "{status_line}\r\nContent-Length: 0\r\n\r\n");
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (port, handle)
    }

    #[test]
    fn request_shutdown_sends_the_token_and_accepts_202() {
        let _guard = net_lock();
        let (port, server) = fake_backend("HTTP/1.1 202 Accepted");
        super::request_shutdown(port, "tok123").unwrap();
        let request = server.join().unwrap();
        assert!(request.starts_with("POST /api/system/shutdown HTTP/1.1\r\n"), "{request}");
        assert!(request.contains("\r\nX-Shutdown-Token: tok123\r\n"), "{request}");
    }

    #[test]
    fn request_shutdown_fails_when_refused_or_nobody_listens() {
        let _guard = net_lock();
        let (port, server) = fake_backend("HTTP/1.1 403 Forbidden");
        assert!(super::request_shutdown(port, "wrong").is_err());
        server.join().unwrap();

        let free = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(super::request_shutdown(free, "tok").is_err());
    }

    #[test]
    fn wait_for_exit_reports_exit_and_timeout() {
        let _guard = net_lock();
        use std::time::Duration;
        let mut quick = spawn_exiting(0);
        assert!(super::wait_for_exit(&mut quick, Duration::from_millis(500)));

        let mut slow = spawn_long_running();
        let started = std::time::Instant::now();
        assert!(!super::wait_for_exit(&mut slow, Duration::from_millis(200)));
        assert!(started.elapsed() < Duration::from_secs(2));
        let _ = slow.kill();
        let _ = slow.wait();
    }

    #[test]
    fn stop_backend_kills_a_backend_that_cannot_be_asked() {
        let _guard = net_lock();
        use std::time::Duration;
        let free = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let child = spawn_long_running();
        let pid = child.id();
        let backend = super::ManagedBackend { child, shutdown_token: "t".into() };
        let started = std::time::Instant::now();
        super::stop_backend(backend, free, Duration::from_millis(200));
        assert!(started.elapsed() < Duration::from_secs(3));
        assert!(!process_alive(pid), "the backend must be killed");
    }

    #[test]
    fn stop_backend_kills_a_backend_that_accepts_but_never_exits() {
        let _guard = net_lock();
        use std::time::Duration;
        let (port, server) = fake_backend("HTTP/1.1 202 Accepted");
        let child = spawn_long_running();
        let pid = child.id();
        let backend = super::ManagedBackend { child, shutdown_token: "t".into() };
        super::stop_backend(backend, port, Duration::from_millis(200));
        server.join().unwrap();
        assert!(!process_alive(pid), "the backend must be killed after the grace period");
    }

    #[test]
    fn stop_backend_leaves_a_gracefully_exited_backend_alone() {
        let _guard = net_lock();
        use std::time::Duration;
        let (port, server) = fake_backend("HTTP/1.1 202 Accepted");
        let child = spawn_exiting(0);
        let backend = super::ManagedBackend { child, shutdown_token: "t".into() };
        let started = std::time::Instant::now();
        super::stop_backend(backend, port, Duration::from_secs(5));
        assert!(started.elapsed() < Duration::from_secs(1), "an exited backend must not wait out the grace period");
        server.join().unwrap();
    }

    fn process_alive(pid: u32) -> bool {
        #[cfg(target_os = "windows")]
        {
            let out = std::process::Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/NH"])
                .output()
                .unwrap();
            String::from_utf8_lossy(&out.stdout).contains(&pid.to_string())
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }
    }

    #[test]
    fn strips_verbatim_disk_prefix() {
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"\\?\C:\Users\me\App\backend.jar")),
            PathBuf::from(r"C:\Users\me\App\backend.jar")
        );
    }

    #[test]
    fn leaves_plain_windows_path_untouched() {
        let p = PathBuf::from(r"C:\Users\me\App\backend.jar");
        assert_eq!(strip_verbatim_prefix(&p), p);
    }

    #[test]
    fn leaves_unc_verbatim_path_untouched() {
        let p = PathBuf::from(r"\\?\UNC\server\share\backend.jar");
        assert_eq!(strip_verbatim_prefix(&p), p);
    }

    #[test]
    fn leaves_unix_path_untouched() {
        let p = PathBuf::from("/home/me/.local/app/backend.jar");
        assert_eq!(strip_verbatim_prefix(&p), p);
    }

    #[test]
    fn port_is_open_detects_listener_presence() {
        let _guard = net_lock();
        use super::port_is_open;
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(port_is_open(port), "should detect an active listener");

        drop(listener);
        assert!(!port_is_open(port), "should report closed once listener is gone");
    }

    #[test]
    fn wait_until_port_closed_reflects_listener_lifecycle() {
        let _guard = net_lock();
        use super::wait_until_port_closed;
        use std::net::TcpListener;
        use std::time::Duration;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // Still listening → gives up after the attempts and reports still-open.
        assert!(
            !wait_until_port_closed(port, 3, Duration::from_millis(10)),
            "should report still-open while a listener is bound"
        );

        drop(listener);
        // Freed → reports closed.
        assert!(
            wait_until_port_closed(port, 3, Duration::from_millis(10)),
            "should report closed once the listener is gone"
        );
    }
}
