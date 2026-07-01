use std::path::PathBuf;
use std::sync::Mutex;

struct BackendProcess(Mutex<Option<std::process::Child>>);

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

/// The fixed loopback port the bundled backend listens on.
#[cfg(any(not(debug_assertions), test))]
const BACKEND_PORT: u16 = 49301;

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
        if let Some(mut child) = self.0.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![open_manual])
        .manage(BackendProcess(Mutex::new(None)))
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

                if port_is_open(BACKEND_PORT) {
                    log::info!(
                        "backend already listening on 127.0.0.1:{BACKEND_PORT}; reusing it instead of spawning a duplicate"
                    );
                    return Ok(());
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

                let mut command = Command::new(&java_bin);
                command
                    .args(["-jar", jar.to_str().unwrap_or_default()])
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
                *state.0.lock().unwrap() = Some(child);
            }

            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::strip_verbatim_prefix;
    use std::path::{Path, PathBuf};

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
        use super::port_is_open;
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(port_is_open(port), "should detect an active listener");

        drop(listener);
        assert!(!port_is_open(port), "should report closed once listener is gone");
    }
}
