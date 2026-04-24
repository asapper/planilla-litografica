#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            // Release only: spawn the bundled backend JAR using the bundled JRE.
            // In dev mode the developer runs the backend separately via `./mvnw spring-boot:run`.
            #[cfg(not(debug_assertions))]
            {
                use std::process::{Command, Stdio};
                use tauri::Manager;

                let resource_dir = app
                    .path()
                    .resource_dir()
                    .map_err(|e| {
                        log::error!("could not resolve resource directory: {e}");
                        e
                    })?;

                log::info!("resource_dir = {}", resource_dir.display());

                // Layout inside the bundle (see tauri.conf.json bundle.resources):
                //   resources/jre/bin/java[.exe]
                //   resources/backend.jar
                let java_bin = if cfg!(target_os = "windows") {
                    resource_dir.join("jre").join("bin").join("java.exe")
                } else {
                    resource_dir.join("jre").join("bin").join("java")
                };
                let jar = resource_dir.join("backend.jar");

                log::info!("java_bin = {}", java_bin.display());
                log::info!("jar      = {}", jar.display());

                // The child process is killed automatically by the OS when the
                // parent Tauri process exits, so no explicit cleanup is needed.
                Command::new(&java_bin)
                    .args(["-jar", jar.to_str().unwrap_or_default()])
                    // Suppress output — the backend writes to its own log file
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

                log::info!("backend process spawned successfully");
            }

            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
