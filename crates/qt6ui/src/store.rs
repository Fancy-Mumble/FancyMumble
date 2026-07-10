//! Shared settings & saved-server storage.
//!
//! Reads and writes the **same** Tauri-store JSON files as the full client
//! (`preferences.json`, `servers.json`, `passwords.json` in the app config
//! dir), so a setting or server saved in one client is immediately visible
//! in the other — no drifting copies. A store file is a flat JSON object of
//! `key -> value` (see `mumble-tauri/ui/src/serverStorage.ts` and
//! `preferencesStorage.ts` for the canonical shapes).
//!
//! Writes are whole-file read-modify-write, preserving keys this client
//! does not know about. The two clients do not normally run at the same
//! time (mode switching is exclusive), so cross-process write races are
//! not a practical concern; the full client's store plugin re-reads on
//! next launch.

use std::path::PathBuf;

use serde_json::{json, Value};

use crate::constants::{APP_IDENTIFIER, ENV_E2E_DATA_DIR};

const PREFERENCES_FILE: &str = "preferences.json";
const SERVERS_FILE: &str = "servers.json";
const PASSWORDS_FILE: &str = "passwords.json";

/// Shared config dir (same contract as the full client): honours the e2e
/// data-dir override, otherwise the platform config dir for the app id.
pub fn config_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var(ENV_E2E_DATA_DIR) {
        if !dir.trim().is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(APP_IDENTIFIER))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|d| {
            PathBuf::from(d)
                .join("Library/Application Support")
                .join(APP_IDENTIFIER)
        })
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|d| PathBuf::from(d).join(".config")))
            .map(|d| d.join(APP_IDENTIFIER))
    }
}

/// Read a store file into a JSON object (`{}` when absent or invalid).
/// BOM-safe: the web toolchain saves these files with a UTF-8 BOM.
fn read_store(file: &str) -> Value {
    let Some(dir) = config_dir() else { return json!({}) };
    match std::fs::read_to_string(dir.join(file)) {
        Ok(raw) => serde_json::from_str(raw.trim_start_matches('\u{feff}')).unwrap_or_else(|e| {
            tracing::warn!("store {file} is not valid JSON ({e}); treating as empty");
            json!({})
        }),
        Err(_) => json!({}),
    }
}

/// Persist a whole store file (pretty-printed like the Tauri store plugin).
fn write_store(file: &str, value: &Value) -> Result<(), String> {
    let dir = config_dir().ok_or_else(|| "could not resolve app config dir".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(file), body).map_err(|e| e.to_string())
}

// -- Preferences --------------------------------------------------------

/// `preferences.hideEmptyChannels` from the shared store (default false).
pub fn hide_empty_channels() -> bool {
    read_store(PREFERENCES_FILE)["preferences"]["hideEmptyChannels"]
        .as_bool()
        .unwrap_or(false)
}

/// Persist `preferences.hideEmptyChannels`, preserving all other keys.
pub fn set_hide_empty_channels(enabled: bool) {
    let mut store = read_store(PREFERENCES_FILE);
    if !store["preferences"].is_object() {
        store["preferences"] = json!({});
    }
    store["preferences"]["hideEmptyChannels"] = json!(enabled);
    if let Err(e) = write_store(PREFERENCES_FILE, &store) {
        tracing::error!("failed to persist hideEmptyChannels: {e}");
    }
}

// -- Saved servers -------------------------------------------------------

/// The saved-server list (see `SavedServer` in the web client's types):
/// `[{id, label, host, port, username, cert_label, favorite}, ...]`,
/// newest first. Returns an empty array when none are saved.
pub fn saved_servers() -> Value {
    let store = read_store(SERVERS_FILE);
    match &store["servers"] {
        Value::Array(a) => Value::Array(a.clone()),
        _ => json!([]),
    }
}

/// Look up one saved server by id.
pub fn saved_server(id: &str) -> Option<Value> {
    match saved_servers() {
        Value::Array(list) => list.into_iter().find(|s| s["id"].as_str() == Some(id)),
        _ => None,
    }
}

/// Persist a new saved server (newest first, like the web client) and
/// optionally its password. Returns the generated id.
pub fn add_server(
    label: &str,
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
) -> Result<String, String> {
    let id = new_id();
    let entry = json!({
        "id": id,
        "label": if label.trim().is_empty() { host } else { label },
        "host": host,
        "port": port,
        "username": username,
        "cert_label": Value::Null,
        "favorite": false,
    });
    let mut store = read_store(SERVERS_FILE);
    let mut list = match store["servers"].take() {
        Value::Array(a) => a,
        _ => Vec::new(),
    };
    list.insert(0, entry);
    store["servers"] = Value::Array(list);
    write_store(SERVERS_FILE, &store)?;

    if let Some(pw) = password {
        if !pw.is_empty() {
            set_server_password(&id, pw)?;
        }
    }
    Ok(id)
}

/// Toggle a saved server's favourite flag; returns the new state.
pub fn toggle_favorite(id: &str) -> Result<bool, String> {
    let mut store = read_store(SERVERS_FILE);
    let mut new_state = false;
    if let Value::Array(list) = &mut store["servers"] {
        for s in list.iter_mut() {
            if s["id"].as_str() == Some(id) {
                new_state = !s["favorite"].as_bool().unwrap_or(false);
                s["favorite"] = json!(new_state);
            }
        }
    }
    write_store(SERVERS_FILE, &store)?;
    Ok(new_state)
}

/// The stored password for a saved server, if any.
pub fn server_password(id: &str) -> Option<String> {
    read_store(PASSWORDS_FILE)["passwords"][id]
        .as_str()
        .map(ToOwned::to_owned)
}

fn set_server_password(id: &str, password: &str) -> Result<(), String> {
    let mut store = read_store(PASSWORDS_FILE);
    if !store["passwords"].is_object() {
        store["passwords"] = json!({});
    }
    store["passwords"][id] = json!(password);
    write_store(PASSWORDS_FILE, &store)
}

// -- Identities (TLS client certificates) --------------------------------

/// Load an identity's TLS client certificate + key PEMs from the shared
/// identity store (`{config_dir}/identities/{label}/tls.{cert,key}.pem`,
/// written by the full client's certificate commands).
pub fn identity_pems(label: &str) -> Option<(String, String)> {
    let dir = config_dir()?.join("identities").join(label);
    let cert = std::fs::read_to_string(dir.join("tls.cert.pem")).ok()?;
    let key = std::fs::read_to_string(dir.join("tls.key.pem")).ok()?;
    Some((cert, key))
}

/// Locally-unique id for a new saved server. The web client uses
/// `crypto.randomUUID()`; ids are opaque strings to every consumer, so a
/// timestamp-based id is fine here (no RNG dependency in this crate).
fn new_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    format!("qt6ui-{nanos:x}")
}
