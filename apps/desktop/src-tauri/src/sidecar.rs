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

/// Locate the directory containing the Next.js standalone `server.js`
/// entrypoint. In production that's the `apps/web/` subdirectory of the
/// bundled standalone tree; in dev it's the monorepo `apps/web/` directly.
///
/// Bundle layout (Tauri 2 stores `../resources/next` under `_up_/resources/next`
/// because the source path traverses up out of `src-tauri/`):
///
/// ```text
/// Workflow Miner.app/Contents/Resources/_up_/resources/next/
///   ├── apps/web/server.js     ← entrypoint we spawn
///   ├── node_modules/
///   ├── package.json
///   └── packages/engine/
/// ```
fn locate_next_root() -> Result<PathBuf, SidecarError> {
    if let Ok(custom) = env::var("WORKFLOW_MINER_NEXT_ROOT") {
        let p = PathBuf::from(custom);
        if p.exists() {
            return Ok(p);
        }
    }

    // Production: resolve relative to the executable.
    // Contents/MacOS/workflow-miner-desktop -> Contents/Resources/_up_/resources/next/apps/web
    if let Ok(exe) = env::current_exe() {
        let candidate = exe
            .parent()
            .and_then(|p| p.parent())
            .map(|p| {
                p.join("Resources")
                    .join("_up_")
                    .join("resources")
                    .join("next")
                    .join("apps")
                    .join("web")
            });
        if let Some(path) = candidate {
            if path.join("server.js").exists() {
                return Ok(path);
            }
        }
    }

    // Dev fallback: monorepo apps/web with a built standalone bundle.
    let dev_standalone = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("web")
        .join(".next")
        .join("standalone")
        .join("apps")
        .join("web");
    if dev_standalone.join("server.js").exists() {
        return Ok(dev_standalone);
    }

    // Last-ditch dev fallback: raw apps/web (no standalone build yet — only
    // useful with WORKFLOW_MINER_DEV_SERVER pointing at `next dev`).
    let dev_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("web");
    if dev_root.exists() {
        return Ok(dev_root);
    }

    Err(SidecarError::MissingResource(
        "next.js standalone bundle (apps/web/server.js)".into(),
    ))
}

/// Locate the bundled `node` binary.
///
/// In a packaged `.app`, Tauri's `externalBin` mechanism places the binary
/// alongside the main executable at `Contents/MacOS/node` (the target-triple
/// suffix is stripped during bundling). In dev — when running via
/// `cargo run` or `tauri dev` — we fall back to whatever `node` is on PATH
/// so contributors don't need to populate `src-tauri/binaries/` to iterate.
fn locate_node() -> PathBuf {
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("node");
            if bundled.exists() {
                return bundled;
            }
        }
    }
    PathBuf::from("node")
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

    // Next.js standalone produces `server.js` as its self-bootstrapping
    // entrypoint. It honours PORT/HOSTNAME from env, so no wrapper script
    // is needed in production.
    let script = next_root.join("server.js");
    if !script.exists() {
        return Err(SidecarError::MissingResource(
            format!("server.js not found at {}", script.display()),
        ));
    }

    let node_bin = locate_node();
    log::info!("using node binary: {}", node_bin.display());

    let mut command = Command::new(&node_bin);
    command
        .arg(&script)
        .current_dir(&next_root)
        .env("HOSTNAME", "127.0.0.1")
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
