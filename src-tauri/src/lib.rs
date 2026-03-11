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
    CreateConnectionRequest, CreateSavedCommandRequest, ExportData, UpdateConnectionRequest, UpdateSavedCommandRequest,
};
use crate::state::AppState;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, RwLock};

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
) -> Result<(), String> {
    let salt = encryption::generate_salt();
    let key = encryption::derive_key(&request.password, &salt);
    let token = encryption::create_verification_token(&key)?;

    // Save config
    let config = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &salt),
        "verification_token": token,
    });
    std::fs::write(&state.config_path, serde_json::to_string_pretty(&config).unwrap())
        .map_err(|e| format!("Failed to save config: {}", e))?;

    // Update state
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
) -> Result<(), String> {
    let salt_guard = state.salt.read().unwrap();
    let salt = salt_guard
        .as_ref()
        .ok_or("No vault configured — please set a master password first")?;

    let key = encryption::derive_key(&request.password, salt);

    let token_guard = state.verification_token.read().unwrap();
    let token = token_guard
        .as_ref()
        .ok_or("No verification token found")?;

    if !encryption::verify_master_password(token, &key) {
        return Err("Invalid master password".to_string());
    }

    *state.encryption_key.write().unwrap() = Some(key);
    Ok(())
}

#[tauri::command]
fn lock_vault(state: tauri::State<AppState>) {
    *state.encryption_key.write().unwrap() = None;
}

// ── Encryption helpers (called from frontend before storing) ──

#[tauri::command]
fn encrypt_value(state: tauri::State<AppState>, plaintext: String) -> Result<String, String> {
    let key_guard = state.encryption_key.read().unwrap();
    let key = key_guard.as_ref().ok_or("Vault is locked")?;
    encryption::encrypt(&plaintext, key)
}

#[tauri::command]
fn decrypt_value(state: tauri::State<AppState>, ciphertext: String) -> Result<String, String> {
    let key_guard = state.encryption_key.read().unwrap();
    let key = key_guard.as_ref().ok_or("Vault is locked")?;
    encryption::decrypt(&ciphertext, key)
}

// ── Connection CRUD Commands ─────────────────────────────

#[tauri::command]
fn create_connection(
    state: tauri::State<AppState>,
    request: CreateConnectionRequest,
) -> Result<database::ServerConnection, String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::create_connection(&conn, request)
}

#[tauri::command]
fn update_connection(
    state: tauri::State<AppState>,
    request: UpdateConnectionRequest,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::update_connection(&conn, request)
}

#[tauri::command]
fn delete_connection(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::delete_connection(&conn, &id)
}

#[tauri::command]
fn get_connections(
    state: tauri::State<AppState>,
) -> Result<Vec<database::ServerConnection>, String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::get_connections(&conn)
}

// ── Group CRUD Commands ──────────────────────────────────

#[tauri::command]
fn create_group(
    state: tauri::State<AppState>,
    name: String,
    parent_id: Option<String>,
) -> Result<database::Group, String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::create_group(&conn, &name, parent_id.as_deref())
}

#[tauri::command]
fn update_group(state: tauri::State<AppState>, id: String, name: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::update_group(&conn, &id, &name)
}

#[tauri::command]
fn delete_group(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::delete_group(&conn, &id)
}

#[tauri::command]
fn get_groups(state: tauri::State<AppState>) -> Result<Vec<database::Group>, String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::get_groups(&conn)
}

// ── Export / Import ──────────────────────────────────────

#[tauri::command]
fn export_connections(state: tauri::State<AppState>) -> Result<ExportData, String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::export_all(&conn)
}

#[tauri::command]
fn import_connections(state: tauri::State<AppState>, data: ExportData) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::import_all(&conn, data)
}

// ── Saved Commands ────────────────────────────────────────

#[tauri::command]
fn create_saved_command(
    state: tauri::State<AppState>,
    request: CreateSavedCommandRequest,
) -> Result<database::SavedCommand, String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::create_saved_command(&conn, request)
}

#[tauri::command]
fn get_saved_commands(state: tauri::State<AppState>) -> Result<Vec<database::SavedCommand>, String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::get_saved_commands(&conn)
}

#[tauri::command]
fn update_saved_command(
    state: tauri::State<AppState>,
    request: UpdateSavedCommandRequest,
) -> Result<database::SavedCommand, String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::update_saved_command(&conn, request)
}

#[tauri::command]
fn delete_saved_command(state: tauri::State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| format!("DB lock error: {}", e))?;
    database::delete_saved_command(&conn, &id)
}

// ── SSH Commands ─────────────────────────────────────────

use std::collections::HashMap;
use std::sync::OnceLock;

// Global SSH sessions store (since SshSession isn't Send-safe for Tauri state)
static SSH_SESSIONS: OnceLock<Mutex<HashMap<String, ssh::SshSession>>> = OnceLock::new();

fn get_ssh_sessions() -> &'static Mutex<HashMap<String, ssh::SshSession>> {
    SSH_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
fn ssh_connect(
    app: tauri::AppHandle,
    session_id: String,
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    private_key_path: Option<String>,
    ssh_tunnels: Option<Vec<database::SshTunnel>>,
) -> Result<(), String> {
    let sessions = get_ssh_sessions();
    let mut map = sessions.lock().map_err(|_| "Lock error")?;
    
    // Prevent double-connect if same session ID is already active
    if map.contains_key(&session_id) {
        return Ok(());
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

    map.insert(session_id, session);
    Ok(())
}

#[tauri::command]
fn ssh_send_input(session_id: String, data: String) -> Result<(), String> {
    let sessions = get_ssh_sessions();
    let map = sessions.lock().map_err(|_| "Lock error")?;
    let session = map.get(&session_id).ok_or("Session not found")?;
    ssh::ssh_send_input(session, &data)
}

#[tauri::command]
fn ssh_disconnect(session_id: String) -> Result<(), String> {
    let sessions = get_ssh_sessions();
    let mut map = sessions.lock().map_err(|_| "Lock error")?;
    if let Some(session) = map.remove(&session_id) {
        ssh::ssh_disconnect(&session)?;
    }
    Ok(())
}

// ── Local Shell Commands ─────────────────────────────────

static SHELL_SESSIONS: OnceLock<Mutex<HashMap<String, local_shell::LocalShellSession>>> = OnceLock::new();

fn get_shell_sessions() -> &'static Mutex<HashMap<String, local_shell::LocalShellSession>> {
    SHELL_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
fn shell_spawn(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let sessions = get_shell_sessions();
    let mut map = sessions.lock().map_err(|_| "Lock error")?;
    if map.contains_key(&session_id) {
        return Ok(());
    }
    let session = local_shell::spawn_local_shell(&app, &session_id)?;
    map.insert(session_id, session);
    Ok(())
}

#[tauri::command]
fn shell_send_input(session_id: String, data: String) -> Result<(), String> {
    let sessions = get_shell_sessions();
    let map = sessions.lock().map_err(|_| "Lock error")?;
    let session = map.get(&session_id).ok_or("Shell session not found")?;
    local_shell::shell_send_input(session, &data)
}

#[tauri::command]
fn shell_disconnect(session_id: String) -> Result<(), String> {
    let sessions = get_shell_sessions();
    let mut map = sessions.lock().map_err(|_| "Lock error")?;
    if let Some(session) = map.remove(&session_id) {
        local_shell::shell_disconnect(&session)?;
    }
    Ok(())
}

#[tauri::command]
fn shell_resize(session_id: String, rows: u16, cols: u16) -> Result<(), String> {
    let sessions = get_shell_sessions();
    let map = sessions.lock().map_err(|_| "Lock error")?;
    if let Some(session) = map.get(&session_id) {
        local_shell::shell_resize(session, rows, cols)?;
    }
    Ok(())
}

// ── RDP Commands ─────────────────────────────────────────

#[tauri::command]
fn rdp_check_available() -> rdp::RdpAvailability {
    rdp::check_rdp_available()
}

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
) -> Result<String, String> {
    let (sid, child) = rdp::launch_rdp(&host, port, &username, &password, width, height, fullscreen, &domain, color_depth, audio, printers, drives)?;
    state.rdp_processes.insert(session_id.clone(), child);
    Ok(sid)
}

#[tauri::command]
fn rdp_disconnect(state: tauri::State<AppState>, session_id: String) -> Result<(), String> {
    if let Some((_, mut child)) = state.rdp_processes.remove(&session_id) {
        let _ = child.kill();
    }
    Ok(())
}

// ── App Entry Point ──────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Setup data directory
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("nexus-remote-manager");
    std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");

    let db_path = data_dir.join("connections.db");
    let config_path = data_dir.join("config.json");

    // Initialize database
    let db = database::initialize_database(db_path.to_str().unwrap())
        .expect("Failed to initialize database");

    // Load config (salt + verification token) if it exists
    let (salt, verification_token) = if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path).unwrap_or_default();
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&config_str) {
            let salt = config["salt"]
                .as_str()
                .and_then(|s| base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s).ok());
            let token = config["verification_token"]
                .as_str()
                .map(|s| s.to_string());
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
        rdp_processes: DashMap::new(),
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
            // Docker
            docker::docker_get_containers,
            docker::docker_container_action,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
