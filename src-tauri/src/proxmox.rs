use crate::commands::credentials::resolve_credentials_internal;
use crate::error::AppError;
use crate::lock_err;
use crate::state::AppState;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::ToSocketAddrs;
use std::path::Path;
use std::time::Duration;
use ts_rs::TS;

#[derive(Serialize, Deserialize, Debug, Clone, TS)]
#[allow(non_snake_case)]
pub struct ProxmoxAuthResponse {
    pub CSRFPreventionToken: String,
    pub ticket: String,
    pub username: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, TS)]
pub struct ProxmoxResource {
    pub id: String,
    pub r#type: String,
    pub node: String,
    pub status: String,
    pub name: String,
    pub uptime: u64,
    pub cpu: f64,
    pub maxcpu: u64,
    pub mem: u64,
    pub maxmem: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct ProxmoxAuthData {
    data: ProxmoxAuthResponse,
}

#[derive(Serialize, Deserialize, Debug)]
struct ProxmoxResourceData {
    data: Vec<ProxmoxResource>,
}

// ── C-2: TLS certificate pinning (Trust-On-First-Use) ────────────────────────
//
// Proxmox almost always uses a self-signed certificate, so the public CA chain
// cannot be used. Instead the certificate is pinned TOFU:
//   • first connection to a host → the cert fingerprint is fetched and stored
//   • later connections          → that exact cert is the ONLY trust anchor of
//     the host's HTTP client, so any other certificate (a MITM) fails the TLS
//     handshake
//   • a changed fingerprint      → the connection is refused with a MITM warning
//
// This replaces the previous `danger_accept_invalid_certs(true)`, which accepted
// ANY certificate and left every Proxmox login wide open to interception.

#[derive(Serialize, Deserialize, Default)]
struct ProxmoxCertStore {
    hosts: HashMap<String, ProxmoxCertEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ProxmoxCertEntry {
    fingerprint_sha256: String,
    cert_der_b64: String,
    added_at: i64,
}

fn cert_store_path(data_dir: &str) -> std::path::PathBuf {
    Path::new(data_dir).join("proxmox_certs.json")
}

fn load_cert_store(data_dir: &str) -> ProxmoxCertStore {
    std::fs::read_to_string(cert_store_path(data_dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_cert_store(data_dir: &str, store: &ProxmoxCertStore) -> Result<(), AppError> {
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| AppError::Internal(format!("Cert store serialize error: {}", e)))?;
    std::fs::write(cert_store_path(data_dir), json)
        .map_err(|e| AppError::Internal(format!("Cert store write error: {}", e)))
}

/// Opens a raw TLS connection and returns the peer certificate as
/// `(sha256_fingerprint, der_bytes)`. Any certificate is accepted here *only to
/// read it* — the security guarantee comes from comparing the fingerprint and
/// from pinning it as the sole trust anchor afterwards.
fn peek_proxmox_cert(host: &str, port: u16) -> Result<(String, Vec<u8>), AppError> {
    use sha2::{Digest, Sha256};
    use std::net::TcpStream as StdTcpStream;

    let addr = format!("{}:{}", host, port);
    let sock_addr = addr
        .to_socket_addrs()
        .map_err(|e| AppError::Network(format!("Invalid Proxmox address {}: {}", addr, e)))?
        .next()
        .ok_or_else(|| AppError::Network(format!("Could not resolve {}", addr)))?;
    let tcp = StdTcpStream::connect_timeout(&sock_addr, Duration::from_secs(5))
        .map_err(|e| AppError::Network(format!("TCP connect to {} failed: {}", addr, e)))?;

    let connector = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| AppError::Internal(format!("TLS connector error: {}", e)))?;
    let tls = connector
        .connect(host, tcp)
        .map_err(|e| AppError::Network(format!("TLS handshake with {} failed: {}", addr, e)))?;

    let cert = tls
        .peer_certificate()
        .map_err(|e| AppError::Internal(format!("Failed to read peer cert: {}", e)))?
        .ok_or_else(|| AppError::Network("Proxmox host presented no certificate".to_string()))?;
    let der = cert
        .to_der()
        .map_err(|e| AppError::Internal(format!("Cert DER encode error: {}", e)))?;

    let fingerprint = Sha256::digest(&der)
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(":");
    Ok((fingerprint, der))
}

/// Builds an HTTPS client pinned to the host's TOFU-trusted certificate.
/// Blocking (TLS handshake + file IO) — must be called via `spawn_blocking`.
fn build_pinned_client(host: &str, port: u16, data_dir: &str) -> Result<Client, AppError> {
    let (fingerprint, der) = peek_proxmox_cert(host, port)?;
    let id = format!("{}:{}", host, port);

    let mut store = load_cert_store(data_dir);
    match store.hosts.get(&id) {
        None => {
            store.hosts.insert(
                id.clone(),
                ProxmoxCertEntry {
                    fingerprint_sha256: fingerprint.clone(),
                    cert_der_b64: BASE64.encode(&der),
                    added_at: chrono::Utc::now().timestamp(),
                },
            );
            save_cert_store(data_dir, &store)?;
            tracing::info!(
                "Proxmox TOFU: pinned new certificate for {} ({})",
                id,
                fingerprint
            );
        }
        Some(entry) if entry.fingerprint_sha256 == fingerprint => {
            tracing::debug!("Proxmox: certificate for {} matches pinned fingerprint", id);
        }
        Some(entry) => {
            tracing::error!(
                "Proxmox: certificate MISMATCH for {} — pinned {}, server presents {}",
                id,
                entry.fingerprint_sha256,
                fingerprint
            );
            // Validation → errorMapper forwards the full message to the user verbatim.
            return Err(AppError::Validation(format!(
                "Proxmox TLS certificate for {} has CHANGED — possible man-in-the-middle attack.\n\n\
                 Pinned fingerprint:  {}\n\
                 Server now presents: {}\n\n\
                 Connection refused. If this change is legitimate (e.g. the certificate was \
                 renewed), remove this host from 'proxmox_certs.json' in the app data directory \
                 and reconnect.",
                id, entry.fingerprint_sha256, fingerprint
            )));
        }
    }

    // Pin: the host's own certificate is the ONLY accepted trust anchor.
    // Hostname verification is relaxed because self-signed Proxmox certs carry
    // the node name (≠ the IP/host used to connect) — the exact-certificate pin
    // is what provides the security guarantee here.
    let pinned = reqwest::Certificate::from_der(&der)
        .map_err(|e| AppError::Internal(format!("Invalid pinned certificate: {}", e)))?;
    Client::builder()
        .add_root_certificate(pinned)
        .danger_accept_invalid_hostnames(true)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build pinned HTTP client: {}", e)))
}

/// Async wrapper: builds the pinned client on the runtime's blocking pool.
async fn pinned_client(host: &str, port: u16, data_dir: &str) -> Result<Client, AppError> {
    let (h, dd) = (host.to_string(), data_dir.to_string());
    tokio::task::spawn_blocking(move || build_pinned_client(&h, port, &dd))
        .await
        .map_err(|e| AppError::Internal(format!("Cert-pin task join error: {}", e)))?
}

// MED-A14: retry helper — retries on 5xx / timeout / connection-refused up to
// `max_attempts` times with truncated-exponential jitter.  4xx errors are NOT
// retried (bad request / auth failure → no point in retrying).
async fn with_retry<F, Fut>(max_attempts: u32, mut f: F) -> Result<Response, AppError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<Response, AppError>>,
{
    use std::time::Duration;
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        match f().await {
            Ok(res) if res.status().is_server_error() && attempt < max_attempts => {
                // 5xx — wait and retry
                let jitter_ms = (rand::random::<u64>() % 200) as u64;
                let backoff = Duration::from_millis(500u64 * (1 << (attempt - 1)) + jitter_ms);
                tracing::warn!(
                    "Proxmox API returned {}; retrying in {}ms (attempt {}/{})",
                    res.status(),
                    backoff.as_millis(),
                    attempt,
                    max_attempts
                );
                tokio::time::sleep(backoff).await;
            }
            Ok(res) => return Ok(res),
            Err(e) if attempt < max_attempts => {
                // connection-refused / timeout — worth retrying
                let jitter_ms = (rand::random::<u64>() % 200) as u64;
                let backoff = Duration::from_millis(500u64 * (1 << (attempt - 1)) + jitter_ms);
                tracing::warn!(
                    "Proxmox API network error: {}; retrying in {}ms (attempt {}/{})",
                    e,
                    backoff.as_millis(),
                    attempt,
                    max_attempts
                );
                tokio::time::sleep(backoff).await;
            }
            Err(e) => return Err(e),
        }
    }
}

/// CRIT-A4: `connection_id` replaces explicit `host`, `port`, `username`, `password`.
/// Credentials are resolved server-side; plaintext passwords never cross the IPC boundary.
#[tauri::command]
pub async fn proxmox_auth(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<ProxmoxAuthResponse, AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("DB pool: {}", e)))?;
    let all = crate::database::get_connections(&conn)?;
    let connection = all
        .into_iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| AppError::Internal("Connection not found".to_string()))?;

    let host = connection.host.clone();
    let port = connection.port as u16;

    // Copy key out of the RwLockReadGuard so no non-Send guard crosses the await.
    let master_key: [u8; 32] = {
        let key_guard = state.encryption_key.read().map_err(lock_err)?;
        *key_guard
            .as_ref()
            .ok_or_else(|| AppError::AuthFailed("Vault locked".to_string()))?
    };
    let creds = resolve_credentials_internal(&conn, &master_key, &connection_id)?;
    drop(conn);

    let username = creds.username;
    let password = creds.password_decrypted.unwrap_or_default();

    let client = pinned_client(&host, port, &state.data_dir).await?;
    let url = format!("https://{}:{}/api2/json/access/ticket", host, port);

    // MED-A14: retry up to 3× on 5xx / network error; no retry on 4xx (auth failure)
    let res: Response = with_retry(3, || {
        let c = client.clone();
        let u = url.clone();
        let user = username.clone();
        let pass = password.clone();
        async move {
            c.post(&u)
                .form(&[("username", user.as_str()), ("password", pass.as_str())])
                .send()
                .await
                .map_err(|e| AppError::Network(format!("Request failed: {}", e)))
        }
    })
    .await?;

    if !res.status().is_success() {
        return Err(AppError::AuthFailed(format!(
            "Authentication failed. Status: {}",
            res.status()
        )));
    }

    let auth_data: ProxmoxAuthData = res
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Response parse error: {}", e)))?;

    Ok(auth_data.data)
}

#[tauri::command]
pub async fn proxmox_get_resources(
    state: tauri::State<'_, AppState>,
    host: String,
    port: u16,
    ticket: String,
) -> Result<Vec<ProxmoxResource>, AppError> {
    let client = pinned_client(&host, port, &state.data_dir).await?;
    let url = format!(
        "https://{}:{}/api2/json/cluster/resources?type=vm",
        host, port
    );

    let res: Response = client
        .get(&url)
        .header("Cookie", format!("PVEAuthCookie={}", ticket))
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Request failed: {}", e)))?;

    if !res.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to fetch resources. Status: {}",
            res.status()
        )));
    }

    let res_data: ProxmoxResourceData = res
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Parse error: {}", e)))?;

    Ok(res_data.data)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn proxmox_vm_action(
    state: tauri::State<'_, AppState>,
    host: String,
    port: u16,
    ticket: String,
    csrf: String,
    node: String,
    vmid: String,
    vm_type: String,
    action: String,
) -> Result<String, AppError> {
    // Validate the action to prevent injection into the URL
    let allowed = ["start", "stop", "shutdown", "reboot", "suspend", "resume"];
    if !allowed.contains(&action.as_str()) {
        return Err(AppError::Validation(format!(
            "Action not allowed: '{}'",
            action
        )));
    }

    let client = pinned_client(&host, port, &state.data_dir).await?;
    let url = format!(
        "https://{}:{}/api2/json/nodes/{}/{}/{}/status/{}",
        host, port, node, vm_type, vmid, action
    );

    let res: Response = client
        .post(&url)
        .header("Cookie", format!("PVEAuthCookie={}", ticket))
        .header("CSRFPreventionToken", csrf)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Request failed: {}", e)))?;

    let status = res.status();
    if !status.is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(AppError::Network(format!(
            "Action failed. Status: {} — {}",
            status, err_text
        )));
    }

    Ok("Action started successfully".to_string())
}

/// CRIT-A4: API token auth — `connection_id` replaces explicit `host`, `port`,
/// `token_id`, `token_secret`. The encrypted token secret is decrypted server-side.
/// This also fixes the prior bug where the frontend was passing the *encrypted* token
/// as if it were the plaintext secret, causing Proxmox token auth to silently fail.
// 90-15: API Token authentication
// Format: "PVEAPIToken=user@realm!tokenid=secret" in Authorization header
#[tauri::command]
pub async fn proxmox_auth_token(
    state: tauri::State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<ProxmoxResource>, AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| AppError::Internal(format!("DB pool: {}", e)))?;
    let all = crate::database::get_connections(&conn)?;
    let connection = all
        .into_iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| AppError::Internal("Connection not found".to_string()))?;

    let host = connection.host.clone();
    let port = connection.port as u16;
    let token_id = connection
        .proxmox_api_token_id
        .clone()
        .ok_or_else(|| AppError::Internal("No API token ID on connection".to_string()))?;
    let token_secret_enc = connection
        .proxmox_api_token_secret_encrypted
        .clone()
        .ok_or_else(|| AppError::Internal("No API token secret on connection".to_string()))?;

    // Copy key out of the RwLockReadGuard so no non-Send guard crosses the await.
    let master_key: [u8; 32] = {
        let key_guard = state.encryption_key.read().map_err(lock_err)?;
        *key_guard
            .as_ref()
            .ok_or_else(|| AppError::AuthFailed("Vault locked".to_string()))?
    };
    let token_secret = crate::encryption::decrypt_auto(&token_secret_enc, &master_key)
        .map_err(|e| AppError::AuthFailed(format!("Decrypt API token: {}", e)))?;
    drop(conn);

    let auth_header = format!("PVEAPIToken={}={}", token_id, token_secret);
    let client = pinned_client(&host, port, &state.data_dir).await?;
    let url = format!(
        "https://{}:{}/api2/json/cluster/resources?type=vm",
        host, port
    );

    // MED-A14: retry up to 3× on 5xx / network errors
    let res: Response = with_retry(3, || {
        let c = client.clone();
        let u = url.clone();
        let hdr = auth_header.clone();
        async move {
            c.get(&u)
                .header("Authorization", hdr)
                .send()
                .await
                .map_err(|e| AppError::Network(format!("Request failed: {}", e)))
        }
    })
    .await?;

    if !res.status().is_success() {
        return Err(AppError::AuthFailed(format!(
            "API token auth failed. Status: {}",
            res.status()
        )));
    }

    let res_data: ProxmoxResourceData = res
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Parse error: {}", e)))?;

    Ok(res_data.data)
}

// 90-15 / C-2: Proxmox TOFU — fetch the TLS certificate fingerprint (SHA-256)
// for display. The actual pinning and verification happens transparently in
// `build_pinned_client` on every authenticated request.
#[tauri::command]
pub async fn proxmox_get_fingerprint(host: String, port: u16) -> Result<String, AppError> {
    let (fingerprint, _der) = tokio::task::spawn_blocking(move || peek_proxmox_cert(&host, port))
        .await
        .map_err(|e| AppError::Internal(format!("Cert-peek task join error: {}", e)))??;
    Ok(fingerprint)
}

// MED-A8: public info about a pinned Proxmox certificate (no DER bytes —
// those are large and only needed for TLS pinning, not for the UI).
#[derive(Serialize, TS)]
pub struct ProxmoxPinnedCert {
    /// The map key used in proxmox_certs.json (format: "host:port")
    pub host_key: String,
    /// SHA-256 fingerprint displayed to the user
    pub fingerprint_sha256: String,
    /// Unix timestamp when the cert was first pinned
    pub added_at: i64,
}

/// MED-A8: list all pinned Proxmox certificates from the TOFU store.
#[tauri::command]
pub fn proxmox_list_pinned_certs(state: tauri::State<AppState>) -> Vec<ProxmoxPinnedCert> {
    let store = load_cert_store(&state.data_dir);
    store
        .hosts
        .into_iter()
        .map(|(host_key, entry)| ProxmoxPinnedCert {
            host_key,
            fingerprint_sha256: entry.fingerprint_sha256,
            added_at: entry.added_at,
        })
        .collect()
}

/// MED-A8: remove a pinned certificate entry so the next connection re-does TOFU.
/// The `host_key` is the "host:port" string returned by `proxmox_list_pinned_certs`.
#[tauri::command]
pub fn proxmox_forget_cert(
    state: tauri::State<AppState>,
    host_key: String,
) -> Result<(), AppError> {
    let mut store = load_cert_store(&state.data_dir);
    if store.hosts.remove(&host_key).is_none() {
        return Err(AppError::NotFound(format!(
            "No pinned cert for '{}'",
            host_key
        )));
    }
    save_cert_store(&state.data_dir, &store)?;
    tracing::info!("Proxmox TOFU: forgot pinned cert for '{}'", host_key);
    Ok(())
}

// ── H-5: Proxmox ticket + navigation hardening ────────────────────────────────
//
// Two-layer defence:
//   1. Sanitize the ticket string before embedding it in JS (no control chars,
//      length cap) — prevents cookie-header injection or JS string escape attacks.
//   2. Restrict the WebviewWindow's navigation to the Proxmox origin only —
//      prevents an XSS payload or server-side redirect from loading arbitrary URLs.

/// Validate a raw Proxmox auth ticket before embedding it in a JS cookie setter.
/// Returns `Err` for empty values, values > 2 KiB, or any control character.
fn validate_proxmox_ticket(ticket: &str) -> Result<(), AppError> {
    if ticket.is_empty() {
        return Err(AppError::Validation("Proxmox ticket is empty".to_string()));
    }
    if ticket.len() > 2048 {
        return Err(AppError::Validation(format!(
            "Proxmox ticket is too long ({} bytes, max 2048)",
            ticket.len()
        )));
    }
    // Reject any ASCII control character (0x00–0x1f) and DEL (0x7f).
    // These would allow HTTP header injection or break the JS cookie literal.
    if ticket.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Err(AppError::Validation(
            "Proxmox ticket contains illegal control characters".to_string(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn proxmox_open_console(
    app: tauri::AppHandle,
    url: String, // e.g. https://10.0.0.1:8006/?console=kvm&...
    label: String,
    title: String,
    ticket: String,
) -> Result<(), AppError> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    // ── 1. Sanitize ticket ────────────────────────────────────────────────────
    validate_proxmox_ticket(&ticket)?;

    // ── 2. Parse + validate URL ────────────────────────────────────────────────
    let parsed_url: reqwest::Url = url
        .parse()
        .map_err(|e| AppError::Internal(format!("Invalid Proxmox URL: {}", e)))?;

    // Reject anything that isn't HTTPS: Proxmox consoles are always HTTPS, and
    // this blocks javascript:/http:/file: URLs from being opened.
    if parsed_url.scheme() != "https" {
        return Err(AppError::Validation(
            "Proxmox console URL must use HTTPS".to_string(),
        ));
    }

    let allowed_host = parsed_url
        .host_str()
        .ok_or_else(|| AppError::Internal("Invalid host in Proxmox URL".to_string()))?
        .to_string();
    let allowed_port = parsed_url.port().unwrap_or(8006);

    let base_url = format!("https://{}:{}", allowed_host, allowed_port);

    // ── 3. Build initialization script ────────────────────────────────────────
    // Load the base URL (Proxmox login page), set the auth cookie via JS, then
    // redirect to the actual console URL.  Both the ticket and URL are serialized
    // via serde_json so they are properly escaped quoted JS string literals —
    // never raw-interpolated.
    let ticket_js = serde_json::to_string(&ticket)
        .map_err(|e| AppError::Internal(format!("ticket serialize error: {}", e)))?;
    let url_js = serde_json::to_string(&url)
        .map_err(|e| AppError::Internal(format!("url serialize error: {}", e)))?;
    let inject_script = format!(
        "if (!window.location.search.includes('console=')) {{\n\
         document.cookie = 'PVEAuthCookie=' + {ticket} + '; path=/; Secure; SameSite=Strict';\n\
         window.location.href = {url};\n\
         }}",
        ticket = ticket_js,
        url = url_js,
    );

    // ── 4. Close stale window ─────────────────────────────────────────────────
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.close();
    }

    // ── 5. Build WebviewWindow with origin-locked navigation ──────────────────
    // The on_navigation handler returns `false` (block) for any URL that doesn't
    // belong to the same Proxmox host:port.  This prevents XSS payloads or
    // server-side redirects from loading arbitrary content in the privileged
    // webview process.
    WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(
            base_url
                .parse()
                .map_err(|e| AppError::Internal(format!("Invalid console URL: {}", e)))?,
        ),
    )
    .title(title)
    .inner_size(1024.0, 768.0)
    .center()
    .resizable(true)
    .initialization_script(&inject_script)
    .on_navigation(move |nav_url| {
        let host_ok = nav_url.host_str() == Some(allowed_host.as_str());
        let port_ok = nav_url.port().unwrap_or(8006) == allowed_port;
        let scheme_ok = nav_url.scheme() == "https";
        let allowed = host_ok && port_ok && scheme_ok;
        if !allowed {
            tracing::warn!(
                "Proxmox console: blocked off-origin navigation to {}",
                nav_url
            );
        }
        allowed
    })
    .build()
    .map_err(|e| AppError::Internal(format!("Failed to open console window: {}", e)))?;

    Ok(())
}

// ── H-5 unit tests ─────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::validate_proxmox_ticket;

    #[test]
    fn ticket_empty_rejected() {
        assert!(validate_proxmox_ticket("").is_err());
    }

    #[test]
    fn ticket_too_long_rejected() {
        let long = "A".repeat(2049);
        assert!(validate_proxmox_ticket(&long).is_err());
    }

    #[test]
    fn ticket_newline_rejected() {
        assert!(validate_proxmox_ticket("PVE:root@pam:1234\nX-Header: injected").is_err());
    }

    #[test]
    fn ticket_null_byte_rejected() {
        assert!(validate_proxmox_ticket("PVE:root@pam:1234\x00").is_err());
    }

    #[test]
    fn ticket_valid_accepted() {
        // Proxmox API ticket format: PVE:user@realm:timestamp:hexsig
        let ok = validate_proxmox_ticket(
            "PVE:root@pam:1715745600:abc123DEF456abc123DEF456abc123DEF456abc123DEF456",
        );
        assert!(ok.is_ok(), "valid ticket should be accepted");
    }

    #[test]
    fn ticket_2048_bytes_accepted() {
        let max = "A".repeat(2048);
        assert!(
            validate_proxmox_ticket(&max).is_ok(),
            "2048 bytes is within the limit"
        );
    }
}
