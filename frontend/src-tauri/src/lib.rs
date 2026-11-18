use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

/// The backend we spawned, and the per-launch secret that lets us ask it to shut down.
struct ManagedBackend {
    child: std::process::Child,
    shutdown_token: String,
}

struct BackendProcess(Mutex<Option<ManagedBackend>>);

/// Tracks close attempts: a second click while closing is ignored, and the frontend's
/// `close_ready(attempt, proceed)` answer reaches the thread waiting on that same attempt (a late
/// answer to an attempt that was already called off is dropped).
struct CloseGate {
    closing: AtomicBool,
    next_attempt: AtomicU64,
    waiting: Mutex<Option<(u64, mpsc::Sender<bool>)>>,
}

impl CloseGate {
    fn new() -> Self {
        CloseGate { closing: AtomicBool::new(false), next_attempt: AtomicU64::new(1), waiting: Mutex::new(None) }
    }

    /// Starts a close; None when one is already running.
    fn begin(&self) -> Option<(u64, mpsc::Receiver<bool>)> {
        if self.closing.swap(true, Ordering::SeqCst) {
            return None;
        }
        let attempt = self.next_attempt.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        *self.waiting.lock().unwrap_or_else(|e| e.into_inner()) = Some((attempt, tx));
        Some((attempt, rx))
    }

    fn answer(&self, attempt: u64, proceed: bool) {
        let mut waiting = self.waiting.lock().unwrap_or_else(|e| e.into_inner());
        if waiting.as_ref().is_some_and(|(current, _)| *current == attempt) {
            if let Some((_, tx)) = waiting.take() {
                let _ = tx.send(proceed);
            }
        }
    }

    /// The close was called off: the next click starts a new one.
    fn cancel(&self) {
        *self.waiting.lock().unwrap_or_else(|e| e.into_inner()) = None;
        self.closing.store(false, Ordering::SeqCst);
    }
}

/// The frontend's answer, or "go ahead" if it doesn't answer in time (a hung page must not
/// keep the app from closing).
fn await_frontend(answer: &mpsc::Receiver<bool>, timeout: Duration) -> bool {
    match answer.recv_timeout(timeout) {
        Ok(proceed) => proceed,
        Err(_) => {
            log::warn!("frontend did not answer the close within {timeout:?}; closing anyway");
            true
        }
    }
}

/// How long the window waits for the frontend to save its draft before closing anyway.
const FRONTEND_SAVE_WAIT: Duration = Duration::from_secs(2);
/// How long the backend gets to close H2 and exit after the shutdown request, before kill().
const BACKEND_EXIT_WAIT: Duration = Duration::from_secs(5);
/// On an exit that can't be called off (the window is already gone: OS logoff, Cmd+Q) with a
/// submission running, how long to keep asking: the backend itself waits up to 30 s for a batch.
const FORCED_EXIT_JOB_WAIT: Duration = Duration::from_secs(35);
const APP_CLOSE_EVENT: &str = "app-close-requested";
const APP_CLOSE_BLOCKED_EVENT: &str = "app-close-blocked";

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
fn close_ready(attempt: u64, proceed: bool, gate: tauri::State<CloseGate>) {
    gate.answer(attempt, proceed);
}

/// A per-launch secret for the backend's shutdown endpoint, from the OS's CSPRNG.
#[cfg(any(not(debug_assertions), test))]
fn new_shutdown_token() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("the OS random source is unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug, PartialEq, Eq)]
enum ShutdownReply {
    Accepted,
    /// A payroll submission is running; the backend refused to stop.
    Busy,
}

/// Asks the backend to close its database and exit.
fn request_shutdown(port: u16, token: &str) -> std::io::Result<ShutdownReply> {
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
    match &status_line[9..12] {
        b"202" => Ok(ShutdownReply::Accepted),
        b"409" => Ok(ShutdownReply::Busy),
        _ => Err(std::io::Error::other(format!(
            "backend refused shutdown: {}",
            String::from_utf8_lossy(&status_line)
        ))),
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

#[derive(Debug, PartialEq, Eq)]
enum StopOutcome {
    Graceful,
    Killed,
    /// A submission is running; the backend was left alone.
    Busy,
}

/// Stops the backend so H2 closes cleanly; kill() only if it can't be asked or doesn't exit
/// within `grace`. A backend that is busy submitting is left running.
fn stop_backend(backend: &mut ManagedBackend, port: u16, grace: Duration) -> StopOutcome {
    let pid = backend.child.id();
    match request_shutdown(port, &backend.shutdown_token) {
        Ok(ShutdownReply::Busy) => return StopOutcome::Busy,
        Ok(ShutdownReply::Accepted) if wait_for_exit(&mut backend.child, grace) => {
            log::info!("backend (pid={pid}) shut down gracefully");
            return StopOutcome::Graceful;
        }
        Ok(ShutdownReply::Accepted) => {
            log::warn!("backend (pid={pid}) accepted shutdown but did not exit in {grace:?}; killing it")
        }
        Err(e) => log::warn!("graceful shutdown of backend (pid={pid}) failed: {e}; killing it"),
    }
    let _ = backend.child.kill();
    let _ = backend.child.wait();
    StopOutcome::Killed
}

/// For exits that can't be called off: keep asking while a submission runs (up to `patience`),
/// then stop the backend whatever it is doing.
fn stop_backend_patiently(
    backend: &mut ManagedBackend,
    port: u16,
    grace: Duration,
    patience: Duration,
    retry_every: Duration,
) -> StopOutcome {
    let deadline = std::time::Instant::now() + patience;
    loop {
        match stop_backend(backend, port, grace) {
            StopOutcome::Busy if std::time::Instant::now() < deadline => std::thread::sleep(retry_every),
            StopOutcome::Busy => {
                log::warn!("a submission was still running after {patience:?}; killing the backend");
                let _ = backend.child.kill();
                let _ = backend.child.wait();
                return StopOutcome::Killed;
            }
            outcome => return outcome,
        }
    }
}

fn take_backend(app: &tauri::AppHandle) -> Option<ManagedBackend> {
    use tauri::Manager;
    let state = app.state::<BackendProcess>();
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    guard.take()
}

fn put_backend_back(app: &tauri::AppHandle, backend: ManagedBackend) {
    use tauri::Manager;
    *app.state::<BackendProcess>().0.lock().unwrap_or_else(|e| e.into_inner()) = Some(backend);
}

fn set_main_window_visible(app: &tauri::AppHandle, visible: bool) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        let _ = if visible { window.show().and_then(|_| window.set_focus()) } else { window.hide() };
    }
}

/// The window's close button. The window hides at once (no edits after the final save), the
/// frontend saves its draft or refuses because a submission is running, then the backend is
/// stopped gracefully. A running submission calls the close off and brings the window back.
fn begin_close(app: &tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    let Some((attempt, answer)) = app.state::<CloseGate>().begin() else {
        return;
    };
    set_main_window_visible(app, false);
    if let Err(e) = app.emit(APP_CLOSE_EVENT, attempt) {
        log::warn!("could not ask the frontend to save before closing: {e}");
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let call_off = |app: &tauri::AppHandle, reason: &str| {
            log::info!("close called off: {reason}");
            app.state::<CloseGate>().cancel();
            set_main_window_visible(app, true);
        };
        if !await_frontend(&answer, FRONTEND_SAVE_WAIT) {
            // The frontend already told the user why.
            call_off(&app, "the frontend has a submission running");
            return;
        }
        if let Some(mut backend) = take_backend(&app) {
            if stop_backend(&mut backend, BACKEND_PORT, BACKEND_EXIT_WAIT) == StopOutcome::Busy {
                put_backend_back(&app, backend);
                call_off(&app, "the backend is submitting");
                let _ = app.emit(APP_CLOSE_BLOCKED_EVENT, ());
                return;
            }
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

/// Terminates the backend JVM bundled with this install (`<resource_dir>/jre/bin/java`)
/// left running from a previous, unclean exit. We must own exactly one backend (H2 is
/// single-writer), so rather than reuse an orphan we can't manage, we kill it and spawn
/// our own. Only this install's JVM is matched: another install's backend, or any other
/// Java program, is left alone.
#[cfg(not(debug_assertions))]
fn terminate_orphan_backend(resource_dir: &std::path::Path, java_bin: &std::path::Path) {
    use std::process::Command;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = java_bin;
        let script = powershell_encoded(STOP_BACKEND_SCRIPT);
        let status = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                script.as_str(),
            ])
            .env("PLANILLA_INSTDIR", resource_dir)
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        log_termination_result(status);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = resource_dir;
        let pids = match Command::new("ps").args(["-axo", "pid=,args="]).output() {
            Ok(out) => pids_running(&String::from_utf8_lossy(&out.stdout), java_bin),
            Err(e) => {
                log::warn!("failed to list processes: {e}");
                return;
            }
        };
        if pids.is_empty() {
            log::info!("no orphan backend running from {}", java_bin.display());
            return;
        }
        let status = Command::new("kill").args(pids.iter().map(u32::to_string)).status();
        log_termination_result(status);
    }
}

/// Shared with the installer hook, so both stop exactly the same process.
#[cfg(any(all(not(debug_assertions), target_os = "windows"), test))]
const STOP_BACKEND_SCRIPT: &str = include_str!("../stop-backend.ps1");

/// The form `powershell -EncodedCommand` takes: base64 of the script in UTF-16LE. The
/// script never goes through command-line quoting.
#[cfg(any(all(not(debug_assertions), target_os = "windows"), test))]
fn powershell_encoded(script: &str) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | (u32::from(*b) << (16 - 8 * i)));
        for i in 0..4 {
            out.push(if i <= chunk.len() { ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

/// Pids in `ps -axo pid=,args=` output whose program is exactly `exe`.
#[cfg(any(all(not(debug_assertions), not(target_os = "windows")), test))]
fn pids_running(ps_output: &str, exe: &std::path::Path) -> Vec<u32> {
    let exe = exe.to_string_lossy();
    ps_output
        .lines()
        .filter_map(|line| {
            let (pid, args) = line.trim_start().split_once(' ')?;
            let args = args.trim_start();
            let rest = args.strip_prefix(exe.as_ref())?;
            (rest.is_empty() || rest.starts_with(' ')).then(|| pid.parse().ok())?
        })
        .collect()
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
        .manage(CloseGate::new())
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
                    terminate_orphan_backend(&resource_dir, &java_bin);
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
                    terminate_orphan_backend(&resource_dir, &java_bin);
                    // Wait for the port — and therefore the H2 file lock — to be
                    // released so our new backend doesn't collide on the single-writer DB.
                    if !wait_until_port_closed(
                        BACKEND_PORT,
                        25,
                        std::time::Duration::from_millis(200),
                    ) {
                        // Another install's backend (left alone on purpose), or ours but
                        // unkillable (e.g. an elevated/AV-held JVM). Reusing the
                        // stubborn backend is safe; spawning a second would crash on the
                        // H2 lock. We don't own it, so it won't be torn down on exit.
                        log::warn!(
                            "backend on 127.0.0.1:{BACKEND_PORT} is still running: it is not this install's ({}) or could not be stopped; reusing it instead of spawning a duplicate",
                            java_bin.display()
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

    // The close button goes through `begin_close`. Other exits end here and can't be refused: a
    // Windows logoff (WM_ENDSESSION; Windows may end the session before the wait is over), Cmd+Q on
    // macOS (tao reports it only as `Exit`), or the last window being destroyed. Let a running
    // submission finish, then stop the backend. `Drop` alone may not run if the process fast-exits,
    // leaving an orphaned JVM that locks the DB and the JRE DLLs.
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
            if let Some(mut backend) = take_backend(app_handle) {
                log::info!("app exiting; stopping backend (pid={})", backend.child.id());
                set_main_window_visible(app_handle, false);
                stop_backend_patiently(
                    &mut backend,
                    BACKEND_PORT,
                    BACKEND_EXIT_WAIT,
                    FORCED_EXIT_JOB_WAIT,
                    Duration::from_secs(1),
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{pids_running, powershell_encoded, strip_verbatim_prefix, STOP_BACKEND_SCRIPT};
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
        assert_eq!(super::request_shutdown(port, "tok123").unwrap(), super::ShutdownReply::Accepted);
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
        let mut backend = super::ManagedBackend { child, shutdown_token: "t".into() };
        let started = std::time::Instant::now();
        assert_eq!(super::stop_backend(&mut backend, free, Duration::from_millis(200)), super::StopOutcome::Killed);
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
        let mut backend = super::ManagedBackend { child, shutdown_token: "t".into() };
        assert_eq!(super::stop_backend(&mut backend, port, Duration::from_millis(200)), super::StopOutcome::Killed);
        server.join().unwrap();
        assert!(!process_alive(pid), "the backend must be killed after the grace period");
    }

    #[test]
    fn stop_backend_leaves_a_gracefully_exited_backend_alone() {
        let _guard = net_lock();
        use std::time::Duration;
        let (port, server) = fake_backend("HTTP/1.1 202 Accepted");
        let child = spawn_exiting(0);
        let mut backend = super::ManagedBackend { child, shutdown_token: "t".into() };
        let started = std::time::Instant::now();
        assert_eq!(super::stop_backend(&mut backend, port, Duration::from_secs(5)), super::StopOutcome::Graceful);
        assert!(started.elapsed() < Duration::from_secs(1), "an exited backend must not wait out the grace period");
        server.join().unwrap();
    }

    /// A fake backend answering each connection in turn with the given status lines.
    fn fake_backend_seq(status_lines: Vec<&'static str>) -> (u16, std::thread::JoinHandle<usize>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let mut served = 0;
            for line in status_lines {
                let (mut conn, _) = listener.accept().unwrap();
                let mut buf = [0u8; 1024];
                let _ = conn.read(&mut buf);
                let _ = write!(conn, "{line}\r\nContent-Length: 0\r\n\r\n");
                served += 1;
            }
            served
        });
        (port, handle)
    }

    #[test]
    fn a_busy_backend_is_left_running() {
        let _guard = net_lock();
        use std::time::Duration;
        let (port, server) = fake_backend("HTTP/1.1 409 Conflict");
        let child = spawn_long_running();
        let pid = child.id();
        let mut backend = super::ManagedBackend { child, shutdown_token: "t".into() };
        assert_eq!(super::stop_backend(&mut backend, port, Duration::from_millis(200)), super::StopOutcome::Busy);
        server.join().unwrap();
        assert!(process_alive(pid), "a backend that is submitting must not be killed");
        let _ = backend.child.kill();
        let _ = backend.child.wait();
    }

    #[test]
    fn a_forced_exit_waits_for_the_submission_then_stops_gracefully() {
        let _guard = net_lock();
        use std::time::Duration;
        let (port, server) = fake_backend_seq(vec!["HTTP/1.1 409 Conflict", "HTTP/1.1 409 Conflict", "HTTP/1.1 202 Accepted"]);
        let mut backend = super::ManagedBackend { child: spawn_exiting(0), shutdown_token: "t".into() };
        let outcome = super::stop_backend_patiently(
            &mut backend, port, Duration::from_secs(1), Duration::from_secs(5), Duration::from_millis(50));
        assert_eq!(outcome, super::StopOutcome::Graceful);
        assert_eq!(server.join().unwrap(), 3);
    }

    #[test]
    fn a_forced_exit_kills_a_backend_still_busy_after_its_patience() {
        let _guard = net_lock();
        use std::time::Duration;
        let (port, server) = fake_backend_seq(vec!["HTTP/1.1 409 Conflict"; 50]);
        let child = spawn_long_running();
        let pid = child.id();
        let mut backend = super::ManagedBackend { child, shutdown_token: "t".into() };
        let outcome = super::stop_backend_patiently(
            &mut backend, port, Duration::from_millis(100), Duration::from_millis(300), Duration::from_millis(50));
        assert_eq!(outcome, super::StopOutcome::Killed);
        assert!(!process_alive(pid));
        drop(server);
    }

    #[test]
    fn close_gate_ignores_a_second_click_and_relays_the_answer() {
        use super::CloseGate;
        let gate = CloseGate::new();
        let (attempt, answer) = gate.begin().expect("first click starts a close");
        assert!(gate.begin().is_none(), "a second click while closing is ignored");
        gate.answer(attempt, false);
        assert!(!super::await_frontend(&answer, std::time::Duration::from_millis(100)));
        gate.cancel();
        let (again, answer) = gate.begin().expect("after a called-off close the next click starts a new one");
        assert_ne!(again, attempt);
        gate.answer(again, true);
        assert!(super::await_frontend(&answer, std::time::Duration::from_millis(100)));
    }

    #[test]
    fn a_late_answer_to_a_called_off_close_is_dropped() {
        use super::CloseGate;
        use std::time::Duration;
        let gate = CloseGate::new();
        let (first, _ignored) = gate.begin().unwrap();
        gate.cancel();
        let (_second, answer) = gate.begin().unwrap();
        gate.answer(first, true);
        assert!(answer.recv_timeout(Duration::from_millis(100)).is_err(), "the first attempt's answer must not decide the second");
    }

    #[test]
    fn a_silent_frontend_does_not_block_the_close() {
        let gate = super::CloseGate::new();
        let (_, answer) = gate.begin().unwrap();
        let started = std::time::Instant::now();
        assert!(super::await_frontend(&answer, std::time::Duration::from_millis(100)));
        assert!(started.elapsed() >= std::time::Duration::from_millis(100));
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
    fn encodes_powershell_commands_as_utf16_base64() {
        assert_eq!(powershell_encoded(""), "");
        assert_eq!(powershell_encoded("a"), "YQA=");
        assert_eq!(powershell_encoded("exit 2"), "ZQB4AGkAdAAgADIA");
        assert_eq!(powershell_encoded("é"), "6QA=");
    }

    #[test]
    fn the_shared_stop_script_is_embedded() {
        assert!(STOP_BACKEND_SCRIPT.contains("PLANILLA_INSTDIR"));
        assert!(STOP_BACKEND_SCRIPT.contains("GetFileInformationByHandle"));
    }

    #[test]
    fn finds_only_processes_running_exactly_this_java() {
        let java = Path::new("/Applications/Cargador.app/Contents/Resources/jre/bin/java");
        let ps = "  101 /Applications/Cargador.app/Contents/Resources/jre/bin/java -jar /Applications/Cargador.app/Contents/Resources/backend.jar\n\
                   202 /Users/me/Other.app/Contents/Resources/jre/bin/java -jar backend.jar\n\
                   303 /usr/bin/java -jar /Applications/Cargador.app/Contents/Resources/backend.jar\n\
                   404 /Applications/Cargador.app/Contents/Resources/jre/bin/javac Foo.java\n\
                   505 /Applications/Cargador.app/Contents/Resources/jre/bin/java\n\
                   garbage\n";
        assert_eq!(pids_running(ps, java), vec![101, 505]);
        assert!(pids_running("", java).is_empty());
    }

    #[test]
    fn the_encoded_stop_script_decodes_back_to_the_script() {
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let encoded = powershell_encoded(STOP_BACKEND_SCRIPT);
        let mut bytes = Vec::new();
        for chunk in encoded.as_bytes().chunks(4) {
            let n = chunk.iter().enumerate().fold(0u32, |n, (i, c)| {
                let v = alphabet.iter().position(|a| a == c).unwrap_or(0) as u32;
                n | (v << (18 - 6 * i))
            });
            let len = 3 - chunk.iter().filter(|c| **c == b'=').count();
            bytes.extend_from_slice(&n.to_be_bytes()[1..1 + len]);
        }
        let units: Vec<u16> = bytes.chunks(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
        assert_eq!(String::from_utf16(&units).unwrap(), STOP_BACKEND_SCRIPT);
    }

    #[test]
    fn finds_this_java_under_a_path_with_spaces() {
        let java = Path::new("/Applications/Cargador de Planilla.app/Contents/Resources/jre/bin/java");
        let ps = "  7 /Applications/Cargador de Planilla.app/Contents/Resources/jre/bin/java -jar /Applications/Cargador de Planilla.app/Contents/Resources/backend.jar\n\
                   8 /Applications/Cargador de Planilla Copy.app/Contents/Resources/jre/bin/java -jar backend.jar\n\
                   9 /Applications/Cargador\n";
        assert_eq!(pids_running(ps, java), vec![7]);
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
