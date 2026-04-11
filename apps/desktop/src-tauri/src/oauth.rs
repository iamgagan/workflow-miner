//! OAuth loopback helper for installed-app authorization flows.
//!
//! Google's OAuth 2.0 spec for installed apps (RFC 8252) allows the redirect
//! URI to be `http://127.0.0.1:<port>` where the desktop app spins up a
//! short-lived loopback HTTP server, captures the auth code from the query
//! string, then closes itself.
//!
//! This module exposes a two-step API so the renderer never has to race
//! between binding the listener and opening the browser:
//!
//!   1. `oauth_loopback_start()` binds a listener on a free 127.0.0.1 port
//!      and returns `{ id, redirect_uri }` immediately. The renderer uses
//!      `redirect_uri` to construct the provider's authorize URL and open
//!      the system browser.
//!
//!   2. `oauth_loopback_wait(id, timeoutSecs)` blocks until the loopback
//!      receives a redirect from the provider, then returns `{ code, error,
//!      state }`. The listener is consumed and removed from the registry on
//!      the first match.
//!
//!   3. `oauth_loopback_cancel(id)` lets the renderer abort an in-flight
//!      listener (e.g. if the user clicks Cancel in the connectors UI).
//!
//! Multiple concurrent listeners are supported via a global registry keyed
//! by an incrementing u64 id.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct LoopbackHandle {
    pub id: u64,
    pub redirect_uri: String,
}

#[derive(Debug, Serialize)]
pub struct LoopbackResult {
    pub redirect_uri: String,
    pub code: Option<String>,
    pub error: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum OauthError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("loopback listen timed out")]
    Timeout,
    #[error("invalid request line")]
    BadRequest,
    #[error("unknown listener id: {0}")]
    UnknownId(u64),
    #[error("listener was cancelled")]
    Cancelled,
}

impl serde::Serialize for OauthErrorResponse {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("OauthError", 1)?;
        s.serialize_field("message", &self.message)?;
        s.end()
    }
}

pub struct OauthErrorResponse {
    message: String,
}

impl From<OauthError> for OauthErrorResponse {
    fn from(err: OauthError) -> Self {
        OauthErrorResponse {
            message: err.to_string(),
        }
    }
}

const SUCCESS_HTML: &str = "<!doctype html><html><head><meta charset='utf-8'><title>Workflow Miner</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fafafa}div{text-align:center;padding:2rem}</style></head><body><div><h1>Connected</h1><p>You can close this window and return to Workflow Miner.</p></div></body></html>";

/// State held in the global registry for each in-flight listener.
struct ListenerSlot {
    listener: Option<TcpListener>,
    redirect_uri: String,
    cancelled: bool,
}

static REGISTRY: Lazy<Mutex<HashMap<u64, ListenerSlot>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Bind a free loopback port and register a listener. Returns a handle the
/// renderer uses to wait for / cancel the listener.
#[tauri::command]
pub fn oauth_loopback_start() -> Result<LoopbackHandle, OauthErrorResponse> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(OauthError::from)?;
    let local_addr = listener.local_addr().map_err(OauthError::from)?;
    let redirect_uri = format!("http://127.0.0.1:{}", local_addr.port());
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);

    let mut registry = REGISTRY.lock().unwrap();
    registry.insert(
        id,
        ListenerSlot {
            listener: Some(listener),
            redirect_uri: redirect_uri.clone(),
            cancelled: false,
        },
    );

    Ok(LoopbackHandle { id, redirect_uri })
}

/// Wait for the OAuth provider to redirect back to the loopback listener.
/// Blocks until a redirect arrives, the timeout elapses, or the listener
/// is cancelled. Removes the listener from the registry on completion.
#[tauri::command]
pub async fn oauth_loopback_wait(
    id: u64,
    timeout_secs: Option<u64>,
) -> Result<LoopbackResult, OauthErrorResponse> {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(180));

    // Take ownership of the listener for this call. The slot stays in the
    // registry (so cancel() can flag it) but with `listener: None` to mark
    // it as in-flight.
    let (listener, redirect_uri) = {
        let mut registry = REGISTRY.lock().unwrap();
        let slot = registry
            .get_mut(&id)
            .ok_or(OauthError::UnknownId(id))
            .map_err(OauthErrorResponse::from)?;
        let listener = slot
            .listener
            .take()
            .ok_or(OauthError::Cancelled)
            .map_err(OauthErrorResponse::from)?;
        (listener, slot.redirect_uri.clone())
    };

    let result = tokio::task::spawn_blocking(move || -> Result<LoopbackResult, OauthError> {
        listener.set_nonblocking(true)?;
        let started = std::time::Instant::now();

        loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    return handle_request(stream, &redirect_uri);
                }
                Err(ref err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    // Honor cancellation by checking the registry slot.
                    if let Ok(reg) = REGISTRY.try_lock() {
                        if let Some(slot) = reg.get(&id) {
                            if slot.cancelled {
                                return Err(OauthError::Cancelled);
                            }
                        }
                    }
                    if started.elapsed() >= timeout {
                        return Err(OauthError::Timeout);
                    }
                    std::thread::sleep(Duration::from_millis(100));
                    continue;
                }
                Err(err) => return Err(OauthError::from(err)),
            }
        }
    })
    .await
    .map_err(|e| OauthErrorResponse {
        message: format!("oauth task join error: {e}"),
    })?;

    // Remove the slot from the registry regardless of outcome — the listener
    // is consumed.
    {
        let mut registry = REGISTRY.lock().unwrap();
        registry.remove(&id);
    }

    Ok(result?)
}

/// Cancel an in-flight listener. The corresponding `oauth_loopback_wait`
/// call will return an error on its next poll iteration. Returns `true`
/// if a listener was cancelled, `false` if the id was not found.
#[tauri::command]
pub fn oauth_loopback_cancel(id: u64) -> Result<bool, OauthErrorResponse> {
    let mut registry = REGISTRY.lock().unwrap();
    match registry.get_mut(&id) {
        Some(slot) => {
            slot.cancelled = true;
            Ok(true)
        }
        None => Ok(false),
    }
}

fn handle_request(stream: TcpStream, redirect_uri: &str) -> Result<LoopbackResult, OauthError> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;

    // Parse "GET /?code=...&state=... HTTP/1.1"
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return Err(OauthError::BadRequest);
    }
    let path = parts[1];
    let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");

    let mut code: Option<String> = None;
    let mut error: Option<String> = None;
    let mut state: Option<String> = None;
    for kv in query.split('&') {
        let mut iter = kv.splitn(2, '=');
        let k = iter.next().unwrap_or("");
        let v = iter.next().unwrap_or("");
        let decoded = url_decode(v);
        match k {
            "code" => code = Some(decoded),
            "error" => error = Some(decoded),
            "state" => state = Some(decoded),
            _ => {}
        }
    }

    // Reply to the browser before returning so the user sees the
    // "you can close this window" page.
    let mut writer = stream;
    let body = SUCCESS_HTML.as_bytes();
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = writer.write_all(response.as_bytes());
    let _ = writer.write_all(body);
    let _ = writer.flush();

    Ok(LoopbackResult {
        redirect_uri: redirect_uri.to_string(),
        code,
        error,
        state,
    })
}

/// Minimal URL-decoder for the small number of percent-encoded characters
/// that may appear in OAuth query parameters. Avoids pulling in a full
/// `url` crate just for this.
fn url_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = hex_val(bytes[i + 1]);
                let lo = hex_val(bytes[i + 2]);
                if let (Some(hi), Some(lo)) = (hi, lo) {
                    out.push((hi << 4) | lo);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
