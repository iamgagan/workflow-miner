//! macOS Keychain integration for OAuth token storage.
//!
//! All connector secrets (Google refresh tokens, Slack bot tokens, Linear API
//! keys) are stored in the system keychain rather than on disk in plaintext.
//! On macOS this is the user's login keychain; on Windows it's the Credential
//! Manager; on Linux it's libsecret/SecretService. The `keyring` crate
//! abstracts these behind a single API.
//!
//! The JavaScript layer (Next.js API routes running inside the Tauri webview)
//! calls these via `tauri-invoke` whenever it needs to read or write a
//! credential. The PGlite database only ever stores token *metadata* (which
//! providers are connected, when they were last refreshed, etc.) — never the
//! secret material itself.

use keyring::Entry;

const SERVICE_NAME: &str = "com.workflowminer.desktop";

#[derive(Debug, thiserror::Error)]
pub enum TokenError {
    #[error("keychain error: {0}")]
    Keychain(#[from] keyring::Error),
}

impl serde::Serialize for TokenErrorResponse {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("TokenError", 1)?;
        s.serialize_field("message", &self.message)?;
        s.end()
    }
}

pub struct TokenErrorResponse {
    message: String,
}

impl From<TokenError> for TokenErrorResponse {
    fn from(err: TokenError) -> Self {
        TokenErrorResponse {
            message: err.to_string(),
        }
    }
}

fn entry_for(provider: &str, key: &str) -> Result<Entry, TokenError> {
    Entry::new(SERVICE_NAME, &format!("{provider}::{key}")).map_err(Into::into)
}

/// Store a secret value in the keychain. Returns `true` on success.
#[tauri::command]
pub fn keychain_set(
    provider: String,
    key: String,
    value: String,
) -> Result<bool, TokenErrorResponse> {
    let entry = entry_for(&provider, &key)?;
    entry.set_password(&value).map_err(TokenError::from)?;
    Ok(true)
}

/// Retrieve a secret value from the keychain.
/// Returns `None` if the entry does not exist.
#[tauri::command]
pub fn keychain_get(provider: String, key: String) -> Result<Option<String>, TokenErrorResponse> {
    let entry = entry_for(&provider, &key)?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(TokenError::from(err).into()),
    }
}

/// Delete a secret from the keychain.
#[tauri::command]
pub fn keychain_delete(provider: String, key: String) -> Result<bool, TokenErrorResponse> {
    let entry = entry_for(&provider, &key)?;
    match entry.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(err) => Err(TokenError::from(err).into()),
    }
}
