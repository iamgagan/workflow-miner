//! OAuth loopback helper for installed-app authorization flows.
//!
//! Google's OAuth 2.0 spec for installed apps (RFC 8252) allows the redirect
//! URI to be `http://127.0.0.1:<port>` where the desktop app spins up a
//! short-lived loopback HTTP server, captures the auth code from the query
//! string, then closes itself. This module provides the `oauth_loopback_listen`
//! Tauri command that the JavaScript layer can call to do exactly that.
//!
//! Flow from the renderer's perspective:
//!   1. JS calls `invoke('oauth_loopback_listen', { timeoutSecs: 120 })`.
//!   2. Rust binds to a free port on 127.0.0.1 and returns the URL.
//!   3. JS opens the OAuth provider's authorize URL with that loopback URL
//!      as the `redirect_uri`.
//!   4. The provider redirects back, this server captures `?code=...`,
//!      replies with a friendly "you can close this window" page, and
//!      resolves the Rust future with the captured code.
//!   5. JS exchanges the code for tokens and stores them in the keychain.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use serde::Serialize;

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

/// Listen on a free loopback port for an OAuth callback. Blocks until the
/// provider redirects back with a `code` (or `error`) query parameter, or
/// until the timeout elapses.
#[tauri::command]
pub async fn oauth_loopback_listen(
    timeout_secs: Option<u64>,
) -> Result<LoopbackResult, OauthErrorResponse> {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(180));

    // Bind on the OS-assigned port to avoid collisions.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(OauthError::from)?;
    listener
        .set_nonblocking(false)
        .map_err(OauthError::from)?;
    let local_addr = listener.local_addr().map_err(OauthError::from)?;
    let redirect_uri = format!("http://127.0.0.1:{}", local_addr.port());

    // Run the blocking accept on a worker so we don't stall the Tauri loop.
    let result = tokio::task::spawn_blocking(move || -> Result<LoopbackResult, OauthError> {
        listener
            .set_nonblocking(true)
            .map_err(OauthError::from)?;
        let started = std::time::Instant::now();

        loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    return handle_request(stream, &redirect_uri);
                }
                Err(ref err) if err.kind() == std::io::ErrorKind::WouldBlock => {
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
    })??;

    Ok(result)
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
