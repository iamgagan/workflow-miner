//! Workflow Miner desktop shell
//!
//! Architecture
//! ============
//! This crate is the Tauri (Rust) host that wraps the Next.js dashboard as a
//! local desktop application. On startup it:
//!
//!   1. Resolves the on-disk app data directory under
//!      `~/Library/Application Support/WorkflowMiner` (macOS). This is where
//!      the local PGlite brain database, the SQLite cache, and any exported
//!      skill packs live.
//!
//!   2. Picks a free TCP port on `127.0.0.1`.
//!
//!   3. Spawns the bundled Next.js server as a sidecar process with the
//!      `WORKFLOW_MINER_MODE=desktop` flag and the chosen port. The sidecar
//!      script (`apps/desktop/scripts/run-next.mjs`) is responsible for
//!      booting `next start`.
//!
//!   4. Polls the loopback URL until the server returns 200, then loads it
//!      into the main webview window.
//!
//!   5. Registers Tauri commands that the JavaScript side can call to read
//!      and write OAuth tokens via the macOS Keychain (`tauri-plugin-keyring`
//!      backed) so secrets never touch disk in plaintext.
//!
//! Lifecycle
//! ---------
//! When the window is closed the sidecar Next.js process is terminated and
//! the PGlite database file is closed cleanly via the JavaScript shutdown
//! handler in `lib/supabase/local-shim.ts`. The Tauri auto-updater (when
//! configured against a GitHub Releases feed) also runs from this entrypoint.

mod oauth;
mod sidecar;
mod tokens;

use std::sync::Mutex;

use tauri::{Manager, RunEvent, WindowEvent};

/// Application state shared across Tauri commands.
pub struct AppState {
    /// Handle to the Next.js sidecar so we can terminate it on shutdown.
    pub sidecar: Mutex<Option<sidecar::SidecarHandle>>,
    /// The loopback URL the sidecar is serving on, e.g. `http://127.0.0.1:53412`.
    pub server_url: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info,workflow_miner_desktop_lib=debug"),
    )
    .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            sidecar: Mutex::new(None),
            server_url: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            tokens::keychain_set,
            tokens::keychain_get,
            tokens::keychain_delete,
            oauth::oauth_loopback_start,
            oauth::oauth_loopback_wait,
            oauth::oauth_loopback_cancel,
            commands::server_url,
            commands::open_data_dir,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let data_dir = sidecar::resolve_data_dir(&app_handle)?;
            log::info!("workflow-miner data dir: {}", data_dir.display());

            // Boot the Next.js sidecar in a background thread so the
            // setup hook returns immediately and the splash window appears.
            tauri::async_runtime::spawn(async move {
                match sidecar::start(&app_handle, &data_dir).await {
                    Ok(handle) => {
                        let url = handle.url().to_string();
                        log::info!("next.js sidecar ready at {url}");

                        let state = app_handle.state::<AppState>();
                        *state.sidecar.lock().unwrap() = Some(handle);
                        *state.server_url.lock().unwrap() = Some(url.clone());

                        // Navigate the main window to the loopback URL
                        if let Some(window) = app_handle.get_webview_window("main") {
                            if let Err(err) = window.eval(&format!(
                                "window.location.replace({:?});",
                                url
                            )) {
                                log::error!("failed to redirect main window: {err}");
                            }
                        }
                    }
                    Err(err) => {
                        log::error!("failed to start next.js sidecar: {err}");
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                let state = app_handle.state::<AppState>();
                if let Some(mut sidecar) = state.sidecar.lock().unwrap().take() {
                    let _ = sidecar.shutdown();
                }
            }
            RunEvent::WindowEvent {
                label: _,
                event: WindowEvent::CloseRequested { .. },
                ..
            } => {
                let state = app_handle.state::<AppState>();
                if let Some(mut sidecar) = state.sidecar.lock().unwrap().take() {
                    let _ = sidecar.shutdown();
                }
            }
            _ => {}
        });
}

mod commands {
    use crate::AppState;
    use tauri::{AppHandle, Manager};

    /// Return the loopback URL the Next.js sidecar is currently serving on.
    /// Returns `None` until the sidecar has finished booting.
    #[tauri::command]
    pub fn server_url(app: AppHandle) -> Option<String> {
        let state = app.state::<AppState>();
        state.server_url.lock().unwrap().clone()
    }

    /// Reveal the application data directory in Finder.
    #[tauri::command]
    pub fn open_data_dir(app: AppHandle) -> Result<(), String> {
        let dir = crate::sidecar::resolve_data_dir(&app).map_err(|e| e.to_string())?;
        // tauri-plugin-shell exposes `open` for revealing paths in the OS file
        // browser. We use the cross-platform `open` helper to launch Finder.
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&dir)
                .spawn()
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg(&dir)
                .spawn()
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            std::process::Command::new("xdg-open")
                .arg(&dir)
                .spawn()
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
}
