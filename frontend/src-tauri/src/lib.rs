use std::path::PathBuf;
use std::sync::Mutex;

struct BackendProcess(Mutex<Option<std::process::Child>>);

#[tauri::command]
fn resolve_manual_path(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("could not resolve resource directory: {e}"))?;

    let bundled = resource_dir.join("manual_usuario.pdf");
    if bundled.exists() {
        return path_to_string(&bundled);
    }

    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join("manual_usuario.pdf");
    if dev_path.exists() {
        return path_to_string(&dev_path);
    }

    Err("manual_usuario.pdf not found".into())
}

fn path_to_string(p: &PathBuf) -> Result<String, String> {
    p.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "path contains invalid UTF-8".into())
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![resolve_manual_path])
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

                log::info!("resource_dir = {}", resource_dir.display());

                let java_bin = if cfg!(target_os = "windows") {
                    resource_dir.join("jre").join("bin").join("java.exe")
                } else {
                    resource_dir.join("jre").join("bin").join("java")
                };
                let jar = resource_dir.join("backend.jar");

                log::info!("java_bin = {}", java_bin.display());
                log::info!("jar      = {}", jar.display());

                let child = Command::new(&java_bin)
                    .args(["-jar", jar.to_str().unwrap_or_default()])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|e| {
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
