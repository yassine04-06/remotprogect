use crate::commands::credentials::resolve_credentials_internal;
use crate::database;
use crate::ssh::{self, JumpHostParams};
use crate::state::AppState;
use crate::{lock_err, touch_activity};

/// HIGH-A1: now async — russh requires an async runtime.
/// CRIT-A4: `connection_id` only; credentials resolved server-side.
/// `passphrase` is `None` on the first call.  When the backend returns
/// `AppError::KeyEncrypted`, the frontend shows a prompt and retries with
/// the user-supplied passphrase.
#[tauri::command]
pub async fn ssh_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    session_id: String,
    connection_id: String,
    passphrase: Option<String>,
) -> Result<(), crate::error::AppError> {
    // ── Extract everything from state before the first .await ─────────────────
    // (keeps the borrow short; avoids holding DashMap refs across awaits)
    let db = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;

    let all_conns = database::get_connections(&db)?;
    let connection = all_conns
        .into_iter()
        .find(|c| c.id == connection_id)
        .ok_or("Connection not found")?;

    let host = connection.host.clone();
    let port = connection.port;
    let ssh_tunnels = connection.ssh_tunnels.clone();
    let jump_host_id = connection.jump_host_id.clone();
    let ssh_key_id = connection.ssh_key_id.clone();
    let use_agent = connection.use_ssh_agent;

    // ── Resolve target credentials ─────────────────────────────────────────────
    let master_key: [u8; 32] = {
        let g = state.encryption_key.read().map_err(lock_err)?;
        *g.as_ref().ok_or("Vault locked")?
    };
    let creds = resolve_credentials_internal(&db, &master_key, &connection_id)?;

    touch_activity(&state);

    // ── Resolve jump-host info + credentials ───────────────────────────────────
    let jump: Option<JumpHostParams> = if let Some(ref jid) = jump_host_id {
        let all = database::get_connections(&db)?;
        if let Some(jconn) = all.into_iter().find(|c| &c.id == jid) {
            let jcreds = resolve_credentials_internal(&db, &master_key, jid).unwrap_or_else(|_| {
                crate::commands::credentials::ResolvedCredentials {
                    username: jconn.username.clone(),
                    password_decrypted: None,
                    private_key_decrypted: None,
                    domain: None,
                }
            });
            Some(JumpHostParams {
                host: jconn.host,
                port: jconn.port,
                username: jcreds.username,
                key_pem: jcreds.private_key_decrypted,
                password: jcreds.password_decrypted,
            })
        } else {
            None
        }
    } else {
        None
    };

    // ── Resolve private key from vault (ssh_key_id overrides credential profile)
    let key_pem: Option<String> = if let Some(ref kid) = ssh_key_id {
        let db2 = state
            .db
            .get()
            .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
        let row = database::ssh_key_get(&db2, kid)?;
        let plain = crate::encryption::decrypt_auto(&row.private_key_encrypted, &master_key)
            .map_err(|e| format!("Decrypt SSH key: {}", e))?;
        Some(plain)
    } else {
        creds.private_key_decrypted.clone()
    };

    let data_dir = state.data_dir.clone();
    let recording = state.recording_sessions.get(&session_id).map(|r| r.clone());

    // ── Guard against duplicate sessions ──────────────────────────────────────
    if state.ssh_sessions.contains_key(&session_id) {
        return Ok(());
    }

    drop(db); // release pool connection before awaiting

    // ── Connect (async — may take several seconds) ────────────────────────────
    // HIGH-A4: `state` is an Arc-backed tauri::State and is Send, so it is safe
    // to hold across this .await.  We do NOT hold any DashMap Ref or RwLockGuard.
    let _ = use_agent; // SSH agent forwarding is TODO for russh (needs russh-agent)
    let ssh_session = ssh::ssh_connect(
        &app,
        &session_id,
        &host,
        port,
        &creds.username,
        key_pem.as_deref(),
        creds.password_decrypted.as_deref(),
        passphrase.as_deref(),
        ssh_tunnels,
        &data_dir,
        jump,
        recording,
    )
    .await?;

    state.ssh_sessions.insert(session_id.clone(), ssh_session);

    if let Ok(db) = state.db.get() {
        let _ = database::audit_log_insert(
            &db,
            "connect",
            "connection",
            &session_id,
            &host,
            "success",
            "",
        );
    }

    Ok(())
}

#[tauri::command]
pub fn ssh_send_input(
    state: tauri::State<AppState>,
    session_id: String,
    data: String,
) -> Result<(), crate::error::AppError> {
    let session = state
        .ssh_sessions
        .get(&session_id)
        .ok_or("SSH session not found")?;
    ssh::ssh_send_input(&session, &data)
}

#[tauri::command]
pub fn ssh_resize(
    state: tauri::State<AppState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), crate::error::AppError> {
    let session = state
        .ssh_sessions
        .get(&session_id)
        .ok_or("SSH session not found")?;
    ssh::ssh_resize(&session, rows, cols)
}

#[tauri::command]
pub fn ssh_disconnect(
    state: tauri::State<AppState>,
    session_id: String,
) -> Result<(), crate::error::AppError> {
    if let Some((_, session)) = state.ssh_sessions.remove(&session_id) {
        ssh::ssh_disconnect(&session)?;
    }
    Ok(())
}
