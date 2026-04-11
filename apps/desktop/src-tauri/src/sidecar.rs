//! Next.js sidecar lifecycle.
//!
//! In production we ship a bundled Node.js runtime + the precompiled
//! Next.js standalone server under `apps/desktop/resources/next/`. The Tauri
//! shell launches that server as a child process bound to a free loopback
//! port. In development the Tauri dev runner can also point at the regular
//! `next dev` server via the `WORKFLOW_MINER_DEV_SERVER` env var.

use std::env;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use tauri::AppHandle;

/// How long to wait for the Next.js sidecar to start serving HTTP before
/// giving up and surfacing an error in the UI.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(20);
const POLL_INTERVAL: Duration = Duration::from_millis(150);

#[derive(Debug, thiserror::Error)]
pub enum SidecarError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("failed to allocate a free port")]
    NoFreePort,
    #[error("sidecar failed to start within {0:?}")]
    Timeout(Duration),
    #[error("could not resolve data directory")]
    DataDir,
    #[error("missing bundled resource: {0}")]
    MissingResource(String),
}

pub struct SidecarHandle {
    child: Child,
    url: String,
}

impl SidecarHandle {
    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn shutdown(&mut self) -> std::io::Result<()> {
        // Politely SIGTERM, then force kill if it doesn't exit.
        let _ = self.child.kill();
        let _ = self.child.wait();
        Ok(())
    }
}

/// Resolve the per-user application data directory.
///
/// macOS:   `~/Library/Application Support/WorkflowMiner`
/// Windows: `%APPDATA%\WorkflowMiner`
/// Linux:   `$XDG_DATA_HOME/workflow-miner` or `~/.local/share/workflow-miner`
pub fn resolve_data_dir(_app: &AppHandle) -> Result<PathBuf, SidecarError> {
    if let Ok(override_dir) = env::var("WORKFLOW_MINER_DATA_DIR") {
        let p = PathBuf::from(override_dir);
        std::fs::create_dir_all(&p)?;
        return Ok(p);
    }

    let base = dirs::data_dir().ok_or(SidecarError::DataDir)?;
    let dir = base.join("WorkflowMiner");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Pick a free TCP port on 127.0.0.1.
fn pick_port() -> Result<u16, SidecarError> {
    portpicker::pick_unused_port().ok_or(SidecarError::NoFreePort)
}

/// Locate the bundled Next.js standalone server. In dev this is the
/// monorepo `apps/web` directory; in prod it's a copy under
/// `apps/desktop/resources/next/`.
fn locate_next_root() -> Result<PathBuf, SidecarError> {
    if let Ok(custom) = env::var("WORKFLOW_MINER_NEXT_ROOT") {
        let p = PathBuf::from(custom);
        if p.exists() {
            return Ok(p);
        }
    }

    // Resolve relative to the current executable in production builds.
    if let Ok(exe) = env::current_exe() {
        let candidate = exe
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("Resources").join("next"));
        if let Some(path) = candidate {
            if path.exists() {
                return Ok(path);
            }
        }
    }

    // Fall back to the dev path under the monorepo.
    let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("web");
    if dev_root.exists() {
        return Ok(dev_root);
    }

    Err(SidecarError::MissingResource(
        "next.js standalone bundle".into(),
    ))
}

/// Spawn the Next.js sidecar and wait for it to be ready.
pub async fn start(_app: &AppHandle, data_dir: &Path) -> Result<SidecarHandle, SidecarError> {
    let port = pick_port()?;
    let url = format!("http://127.0.0.1:{port}");
    let next_root = locate_next_root()?;

    log::info!(
        "spawning next.js sidecar: cwd={} port={}",
        next_root.display(),
        port
    );

    // We launch via the bundled bootstrap script which knows how to invoke
    // either `next start` (production) or `next dev` (development).
    let script = next_root
        .parent()
        .map(|p| p.join("desktop").join("scripts").join("run-next.mjs"))
        .ok_or_else(|| SidecarError::MissingResource("run-next.mjs".into()))?;

    let mut command = Command::new("node");
    command
        .arg(&script)
        .current_dir(&next_root)
        .env("WORKFLOW_MINER_MODE", "desktop")
        .env("WORKFLOW_MINER_DATA_DIR", data_dir)
        .env("PORT", port.to_string())
        .env("NEXT_PUBLIC_APP_URL", &url)
        .env("NODE_ENV", if cfg!(debug_assertions) { "development" } else { "production" })
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let child = command.spawn()?;

    // Poll the loopback URL until it answers, or time out.
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    let probe_url = format!("{url}/api/dashboard");
    while Instant::now() < deadline {
        if tcp_probe(port) {
            // Give Next a brief moment after the port is open to finish
            // booting routes before we navigate the webview.
            tokio::time::sleep(Duration::from_millis(250)).await;
            log::info!("sidecar reachable, probe={}", probe_url);
            return Ok(SidecarHandle { child, url });
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }

    // If we never got a connection, terminate the child and fail.
    let mut handle = SidecarHandle { child, url };
    let _ = handle.shutdown();
    Err(SidecarError::Timeout(STARTUP_TIMEOUT))
}

/// Cheap TCP-level reachability check — avoids pulling in a full HTTP client
/// for what is essentially a "is the port accepting connections" probe.
fn tcp_probe(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(100)).is_ok()
}
