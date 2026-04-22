mod error;
mod database;
mod encryption;
mod local_shell;
mod rdp;
mod ssh;
mod state;
mod vnc;
mod tools;
mod network;
mod sftp_ftp;
mod proxmox;
mod docker;

use crate::database::{
    CreateConnectionRequest, CreateSavedCommandRequest, ExportData,
    UpdateConnectionRequest, UpdateSavedCommandRequest,
    CredentialProfile, CreateCredentialProfileRequest, UpdateCredentialProfileRequest,
};
use crate::state::AppState;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, RwLock};
use tauri::Emitter;

// ── Vault / Encryption Commands ──────────────────────────

#[derive(Serialize)]
struct VaultStatus {
    unlocked: bool,
    first_run: bool,
}

#[tauri::command]
fn is_vault_unlocked(state: tauri::State<AppState>) -> VaultStatus {
    let key_guard = state.encryption_key.read().unwrap();
    let token_guard = state.verification_token.read().unwrap();
    VaultStatus {
        unlocked: key_guard.is_some(),
        first_run: token_guard.is_none(),
    }
}

#[derive(Deserialize)]
struct SetMasterPasswordRequest {
    password: String,
}

#[tauri::command]
fn set_master_password(
    state: tauri::State<AppState>,
    request: SetMasterPasswordRequest,
) -> Result<(), crate::error::AppError> {
    let salt = encryption::generate_salt();
    let key = encryption::derive_key(&request.password, &salt);
    let token = encryption::create_verification_token(&key)?;

    let config = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &salt),
        "verification_token": token,
    });
    std::fs::write(&state.config_path, serde_json::to_string_pretty(&config).unwrap())
        .map_err(|e| format!("Impossibile salvare la configurazione: {}", e))?;

    *state.encryption_key.write().unwrap() = Some(key);
    *state.salt.write().unwrap() = Some(salt.to_vec());
    *state.verification_token.write().unwrap() = Some(token);

    Ok(())
}

#[derive(Deserialize)]
struct UnlockVaultRequest {
    password: String,
}

#[tauri::command]
fn unlock_vault(
    state: tauri::State<AppState>,
    request: UnlockVaultRequest,
) -> Result<(), crate::error::AppError> {
    let salt_guard = state.salt.read().unwrap();
    let salt = salt_guard
        .as_ref()
        .ok_or("Vault non configurato — imposta prima una master password")?;

    let key = encryption::derive_key(&request.password, salt);

    let token_guard = state.verification_token.read().unwrap();
    let token = token_guard.as_ref().ok_or("Token di verifica assente")?;

    if !encryption::verify_master_password(token, &key) {
        return Err(crate::error::AppError::AuthFailed("Master password errata".to_string()));
    }

    *state.encryption_key.write().unwrap() = Some(key);
    Ok(())
}

#[tauri::command]
fn lock_vault(state: tauri::State<AppState>) {
    *state.encryption_key.write().unwrap() = None;
}

#[tauri::command]
fn encrypt_value(state: tauri::State<AppState>, plaintext: String) -> Result<String, crate::error::AppError> {
    let key_guard = state.encryption_key.read().unwrap();
    let key = key_guard.as_ref().ok_or("Vault bloccato")?;
    Ok(encryption::encrypt(&plaintext, key)?)
}

#[tauri::command]
fn decrypt_value(state: tauri::State<AppState>, ciphertext: String) -> Result<String, crate::error::AppError> {
    let key_guard = state.encryption_key.read().unwrap();
    let key = key_guard.as_ref().ok_or("Vault bloccato")?;
    Ok(encryption::decrypt(&ciphertext, key)?)
}

// ── Connection CRUD Commands ─────────────────────────────

#[tauri::command]
fn create_connection(
    state: tauri::State<AppState>,
    request: CreateConnectionRequest,
) -> Result<database::ServerConnection, crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::create_connection(&conn, request)?)
}

#[tauri::command]
fn update_connection(
    state: tauri::State<AppState>,
    request: UpdateConnectionRequest,
) -> Result<(), crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::update_connection(&conn, request)?)
}

#[tauri::command]
fn delete_connection(state: tauri::State<AppState>, id: String) -> Result<(), crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::delete_connection(&conn, &id)?)
}

#[tauri::command]
fn get_connections(state: tauri::State<AppState>) -> Result<Vec<database::ServerConnection>, crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::get_connections(&conn)?)
}

// ── Group CRUD Commands ──────────────────────────────────

#[tauri::command]
fn create_group(
    state: tauri::State<AppState>,
    name: String,
    parent_id: Option<String>,
) -> Result<database::Group, crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::create_group(&conn, &name, parent_id.as_deref())?)
}

#[tauri::command]
fn update_group(state: tauri::State<AppState>, id: String, name: String) -> Result<(), crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::update_group(&conn, &id, &name)?)
}

#[tauri::command]
fn delete_group(state: tauri::State<AppState>, id: String) -> Result<(), crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::delete_group(&conn, &id)?)
}

#[tauri::command]
fn get_groups(state: tauri::State<AppState>) -> Result<Vec<database::Group>, crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::get_groups(&conn)?)
}

// ── Credential Profiles CRUD ───────────────────────────────

#[tauri::command]
fn create_credential_profile(
    state: tauri::State<AppState>,
    request: CreateCredentialProfileRequest,
) -> Result<CredentialProfile, crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::create_credential_profile(&conn, request)?)
}

#[tauri::command]
fn get_credential_profiles(state: tauri::State<AppState>) -> Result<Vec<CredentialProfile>, crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::get_credential_profiles(&conn)?)
}

#[tauri::command]
fn update_credential_profile(
    state: tauri::State<AppState>,
    request: UpdateCredentialProfileRequest,
) -> Result<(), crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::update_credential_profile(&conn, request)?)
}

#[tauri::command]
fn delete_credential_profile(state: tauri::State<AppState>, id: String) -> Result<(), crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::delete_credential_profile(&conn, &id)?)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedCredentials {
    pub username: String,
    pub password_decrypted: Option<String>,
    pub private_key_decrypted: Option<String>,
    pub domain: Option<String>,
}

#[tauri::command]
fn resolve_credentials(
    state: tauri::State<AppState>,
    connection_id: String,
) -> Result<ResolvedCredentials, crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    let connections = database::get_connections(&conn)?; // Simple array scan, fine for local SQLite
    let connection = connections.into_iter().find(|c| c.id == connection_id)
        .ok_or("Connection not found")?;

    let key_guard = state.encryption_key.read().unwrap();
    let master_key = key_guard.as_ref().ok_or("Vault locked")?;

    if connection.override_credentials || connection.credential_profile_id.is_none() {
        let p_decrypted = connection.password_encrypted.and_then(|c| encryption::decrypt(&c, master_key).ok());
        let k_decrypted = connection.private_key_encrypted.and_then(|c| encryption::decrypt(&c, master_key).ok());
        Ok(ResolvedCredentials {
            username: connection.username,
            password_decrypted: p_decrypted,
            private_key_decrypted: k_decrypted,
            domain: Some(connection.domain),
        })
    } else {
        let profile_id = connection.credential_profile_id.unwrap();
        let profiles = database::get_credential_profiles(&conn)?;
        let profile = profiles.into_iter().find(|p| p.id == profile_id)
            .ok_or("Linked credential profile not found")?;
            
        let p_decrypted = profile.password_encrypted.and_then(|c| encryption::decrypt(&c, master_key).ok());
        let k_decrypted = profile.private_key_encrypted.and_then(|c| encryption::decrypt(&c, master_key).ok());
        
        Ok(ResolvedCredentials {
            username: profile.username.unwrap_or(connection.username),
            password_decrypted: p_decrypted,
            private_key_decrypted: k_decrypted,
            domain: profile.domain.or(Some(connection.domain)),
        })
    }
}

// ── Export / Import ──────────────────────────────────────

#[tauri::command]
fn export_connections(state: tauri::State<AppState>) -> Result<ExportData, crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::export_all(&conn)?)
}

#[tauri::command]
fn import_connections(state: tauri::State<AppState>, data: ExportData) -> Result<(), crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::import_all(&conn, data)?)
}

// ── Saved Commands ────────────────────────────────────────

#[tauri::command]
fn create_saved_command(
    state: tauri::State<AppState>,
    request: CreateSavedCommandRequest,
) -> Result<database::SavedCommand, crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::create_saved_command(&conn, request)?)
}

#[tauri::command]
fn get_saved_commands(state: tauri::State<AppState>) -> Result<Vec<database::SavedCommand>, crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::get_saved_commands(&conn)?)
}

#[tauri::command]
fn update_saved_command(
    state: tauri::State<AppState>,
    request: UpdateSavedCommandRequest,
) -> Result<database::SavedCommand, crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::update_saved_command(&conn, request)?)
}

#[tauri::command]
fn delete_saved_command(state: tauri::State<AppState>, id: String) -> Result<(), crate::error::AppError> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    Ok(database::delete_saved_command(&conn, &id)?)
}

// ── SSH Commands ─────────────────────────────────────────
// FIX: le sessioni sono ora in AppState invece di OnceLock globali.

#[tauri::command]
fn ssh_connect(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    session_id: String,
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    ssh_tunnels: Option<Vec<database::SshTunnel>>,
) -> Result<(), crate::error::AppError> {
    if state.ssh_sessions.contains_key(&session_id) {
        return Ok(()); // Sessione già attiva
    }

    let session = ssh::ssh_connect(
        &app,
        &session_id,
        &host,
        port,
        &username,
        password.as_deref(),
        private_key_path.as_deref(),
        ssh_tunnels,
    )?;

    state.ssh_sessions.insert(session_id, session);
    Ok(())
}

#[tauri::command]
fn ssh_send_input(
    state: tauri::State<AppState>,
    session_id: String,
    data: String,
) -> Result<(), crate::error::AppError> {
    let session = state.ssh_sessions
        .get(&session_id)
        .ok_or("Sessione SSH non trovata")?;
    Ok(ssh::ssh_send_input(&session, &data)?)
}

#[tauri::command]
fn ssh_disconnect(state: tauri::State<AppState>, session_id: String) -> Result<(), crate::error::AppError> {
    if let Some((_, session)) = state.ssh_sessions.remove(&session_id) {
        ssh::ssh_disconnect(&session)?;
    }
    Ok(())
}

// ── Local Shell Commands ─────────────────────────────────
// FIX: idem — sessioni in AppState.

#[tauri::command]
fn shell_spawn(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    session_id: String,
) -> Result<(), crate::error::AppError> {
    if state.shell_sessions.contains_key(&session_id) {
        return Ok(());
    }
    let session = local_shell::spawn_local_shell(&app, &session_id)?;
    state.shell_sessions.insert(session_id, session);
    Ok(())
}

#[tauri::command]
fn shell_send_input(
    state: tauri::State<AppState>,
    session_id: String,
    data: String,
) -> Result<(), crate::error::AppError> {
    let session = state.shell_sessions
        .get(&session_id)
        .ok_or("Sessione shell non trovata")?;
    Ok(local_shell::shell_send_input(&session, &data)?)
}

#[tauri::command]
fn shell_disconnect(state: tauri::State<AppState>, session_id: String) -> Result<(), crate::error::AppError> {
    if let Some((_, session)) = state.shell_sessions.remove(&session_id) {
        local_shell::shell_disconnect(&session)?;
    }
    Ok(())
}

#[tauri::command]
fn shell_resize(
    state: tauri::State<AppState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), crate::error::AppError> {
    if let Some(session) = state.shell_sessions.get(&session_id) {
        local_shell::shell_resize(&session, rows, cols)?;
    }
    Ok(())
}

// ── RDP Commands ─────────────────────────────────────────────────────────────────────────────────────────────────────

#[tauri::command]
fn rdp_check_available() -> rdp::RdpAvailability {
    rdp::check_rdp_available()
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn rdp_connect(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    session_id: String,
    host: String,
    port: i32,
    username: String,
    password: String,
    width: i32,
    height: i32,
    fullscreen: bool,
    domain: String,
    color_depth: i32,
    audio: bool,
    printers: bool,
    drives: bool,
) -> Result<String, crate::error::AppError> {
    use tauri::Manager;
    let window = app.get_webview_window("main").ok_or("Main window not found")?;
    let parent_hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as i64;

    let full_username = if domain.is_empty() {
        username.clone()
    } else {
        format!("{}\\{}", domain, username)
    };

    // Launch hidden off-screen; the frontend will call rdp_resize_embedded once
    // it knows the container's position.
    match rdp::launch_rdp_embedded(
        &state.data_dir, &host, port, &full_username, &password,
        parent_hwnd, -32000, -32000, width, height,
    ) {
        Ok(mut session) => {
            // Take stdout NOW (before inserting) so we can forward events.
            // The child's stdout was left open after the HWND handshake.
            // launch_rdp_embedded already drained READY+HWND lines; the rest
            // go to the event reader thread.
            // We need to re-take stdout — it wasn't taken inside launch_rdp_embedded
            // to keep the API clean, so we pass it from here via a secondary pipe.
            // Actually: stdout is already consumed by the BufReader inside
            // launch_rdp_embedded. We use stderr as the event channel for safety.
            // — See rdp.rs: after HWND we pass a new ChildStdout-derived reader
            //   back via session.  For simplicity we spawn a thread on stderr to
            //   forward EVENT: lines (stderr is untouched after init).
            if let Some(stderr) = session.child.stderr.take() {
                // stderr carries [RdpEmbed] debug lines — forward for devtools
                let app2 = app.clone();
                let sid2 = session_id.clone();
                std::thread::spawn(move || {
                    use std::io::BufRead;
                    let reader = std::io::BufReader::new(stderr);
                    for line in reader.lines().flatten() {
                        let _ = app2.emit(&format!("rdp-stderr-{}", sid2), &line);
                    }
                });
            }
            state.rdp_sessions.insert(session_id.clone(), session);
            Ok(session_id)
        }
        Err(e) => {
            tracing::warn!("Failed to launch embedded RDP: {}. Falling back to mstsc...", e);
            let child = rdp::launch_rdp_mstsc(
                &host, port, &username, &password,
                width, height, fullscreen, &domain,
                color_depth, audio, printers, drives,
            )?;
            state.rdp_processes.insert(session_id.clone(), child);
            Ok(session_id)
        }
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn rdp_connect(
    state: tauri::State<AppState>,
    session_id: String,
    host: String,
    port: i32,
    username: String,
    password: String,
    width: i32,
    height: i32,
    fullscreen: bool,
    domain: String,
    color_depth: i32,
    audio: bool,
    printers: bool,
    drives: bool,
) -> Result<String, crate::error::AppError> {
    let child = rdp::launch_rdp_mstsc(
        &host, port, &username, &password,
        width, height, fullscreen, &domain,
        color_depth, audio, printers, drives,
    )?;
    state.rdp_processes.insert(session_id.clone(), child);
    Ok(session_id)
}

#[tauri::command]
fn rdp_disconnect(state: tauri::State<AppState>, session_id: String) -> Result<(), crate::error::AppError> {
    if let Some((_, session)) = state.rdp_sessions.remove(&session_id) {
        rdp::close_embedded(&session);
    }
    if let Some((_, mut child)) = state.rdp_processes.remove(&session_id) {
        let _ = child.kill();
    }
    Ok(())
}

#[tauri::command]
fn rdp_embed_window(
    state: tauri::State<AppState>,
    session_id: String,
) -> Result<bool, crate::error::AppError> {
    // With the C# helper the window is already embedded at launch time.
    Ok(state.rdp_sessions.contains_key(&session_id))
}

/// Resize/reposition the embedded RDP window.
/// `x` and `y` are CSS/logical pixel offsets relative to the Tauri webview.
/// We convert them to physical screen coordinates using the window's inner
/// position and the DPI scale factor.
#[tauri::command]
fn rdp_resize_embedded(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    session_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), crate::error::AppError> {
    use tauri::Manager;
    if let Some(session) = state.rdp_sessions.get(&session_id) {
        if let Some(window) = app.get_webview_window("main") {
            // Physical position of the inner (client) area of the Tauri window
            let pos = window.inner_position().map_err(|e| e.to_string())?;
            // DPI scaling factor (e.g. 1.5 on a 150% monitor)
            let scale = window.scale_factor().map_err(|e| e.to_string())?;

            let screen_x = (pos.x as f64 + x * scale).round() as i32;
            let screen_y = (pos.y as f64 + y * scale).round() as i32;
            let screen_w = (width  * scale).round() as i32;
            let screen_h = (height * scale).round() as i32;

            rdp::resize_embedded(&session, screen_x, screen_y, screen_w, screen_h)?;
        }
    }
    Ok(())
}

/// Hide or show the embedded RDP window without off-screen hacks.
#[tauri::command]
fn rdp_set_visibility(
    state: tauri::State<AppState>,
    session_id: String,
    visible: bool,
) -> Result<(), crate::error::AppError> {
    if let Some(session) = state.rdp_sessions.get(&session_id) {
        if visible {
            rdp::show_embedded(&session)?;
        } else {
            rdp::hide_embedded(&session)?;
        }
    }
    Ok(())
}

/// Send keyboard focus to the embedded RDP ActiveX control.
#[tauri::command]
fn rdp_focus(state: tauri::State<AppState>, session_id: String) -> Result<(), crate::error::AppError> {
    if let Some(session) = state.rdp_sessions.get(&session_id) {
        let _ = rdp::send_command(session.value(), "FOCUS");
    }
    Ok(())
}

#[tauri::command]
fn rdp_send_command(state: tauri::State<AppState>, session_id: String, command: String) -> Result<(), crate::error::AppError> {
    if let Some(session) = state.rdp_sessions.get(&session_id) {
        let _ = rdp::send_command(session.value(), &command);
    }
    Ok(())
}

#[tauri::command]
fn rdp_is_window_alive(
    state: tauri::State<AppState>,
    session_id: String,
) -> bool {
    if let Some(mut session) = state.rdp_sessions.get_mut(&session_id) {
        rdp::is_embedded_alive(&mut session)
    } else {
        false
    }
}

// ── App Entry Point ──────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .with_target(false)
        .with_thread_ids(true)
        .init();

    tracing::info!("Starting Nexus Remote Manager backend...");

    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("nexus-remote-manager");
    std::fs::create_dir_all(&data_dir).expect("Impossibile creare la directory dati");

    let db_path = data_dir.join("connections.db");
    let config_path = data_dir.join("config.json");

    let db = database::initialize_database(db_path.to_str().unwrap())
        .expect("Impossibile inizializzare il database");

    let (salt, verification_token) = if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path).unwrap_or_default();
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&config_str) {
            let salt = config["salt"]
                .as_str()
                .and_then(|s| base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s).ok());
            let token = config["verification_token"].as_str().map(|s| s.to_string());
            (salt, token)
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    let app_state = AppState {
        db: Mutex::new(db),
        encryption_key: RwLock::new(None),
        salt: RwLock::new(salt),
        verification_token: RwLock::new(verification_token),
        config_path: config_path.to_str().unwrap().to_string(),
        data_dir: data_dir.to_str().unwrap().to_string(),
        rdp_processes: DashMap::new(),
        rdp_sessions: DashMap::new(),
        // FIX: sessioni SSH e shell inizializzate qui nello stato Tauri
        ssh_sessions: DashMap::new(),
        shell_sessions: DashMap::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Vault
            is_vault_unlocked,
            set_master_password,
            unlock_vault,
            lock_vault,
            encrypt_value,
            decrypt_value,
            // Connections
            create_connection,
            update_connection,
            delete_connection,
            get_connections,
            // Groups
            create_group,
            update_group,
            delete_group,
            get_groups,
            // Credential Profiles
            create_credential_profile,
            get_credential_profiles,
            update_credential_profile,
            delete_credential_profile,
            resolve_credentials,
            // Export / Import
            export_connections,
            import_connections,
            // SSH
            ssh_connect,
            ssh_send_input,
            ssh_disconnect,
            // Local Shell
            shell_spawn,
            shell_send_input,
            shell_disconnect,
            shell_resize,
            // RDP
            rdp_check_available,
            rdp_connect,
            rdp_disconnect,
            rdp_embed_window,
            rdp_is_window_alive,
            rdp_set_visibility,
            rdp_focus,
            rdp_send_command,
            rdp_resize_embedded,
            // VNC
            vnc::vnc_check_availability,
            vnc::vnc_connect,
            // Tools
            tools::run_external_tool,
            // Network
            network::scan_network,
            network::ping_server,
            // SFTP & FTP
            sftp_ftp::sftp_list_dir,
            sftp_ftp::sftp_upload,
            sftp_ftp::sftp_download,
            sftp_ftp::sftp_delete,
            sftp_ftp::sftp_rename,
            sftp_ftp::sftp_mkdir,
            sftp_ftp::ftp_list_dir,
            sftp_ftp::ftp_upload,
            sftp_ftp::ftp_download,
            sftp_ftp::ftp_delete,
            sftp_ftp::ftp_rename,
            sftp_ftp::ftp_mkdir,
            // Saved Commands
            create_saved_command,
            get_saved_commands,
            update_saved_command,
            delete_saved_command,
            // Proxmox
            proxmox::proxmox_auth,
            proxmox::proxmox_get_resources,
            proxmox::proxmox_vm_action,
            proxmox::proxmox_open_console,
            // Docker
            docker::docker_get_containers,
            docker::docker_container_action,
        ])
        .run(tauri::generate_context!())
        .expect("Errore durante l'esecuzione dell'applicazione Tauri");
}


