use std::sync::Mutex;

struct BackendProcess(Mutex<Option<std::process::Child>>);

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
