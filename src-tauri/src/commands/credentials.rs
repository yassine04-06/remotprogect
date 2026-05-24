use crate::state::AppState;
use crate::database::{self, CredentialProfile, CreateCredentialProfileRequest, UpdateCredentialProfileRequest};
use crate::lock_err;
use crate::encryption;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
pub struct ResolvedCredentials {
    pub username: String,
    pub password_decrypted: Option<String>,
    pub private_key_decrypted: Option<String>,
    pub domain: Option<String>,
}

#[tauri::command]
pub fn create_credential_profile(
    state: tauri::State<AppState>,
    mut request: CreateCredentialProfileRequest,
) -> Result<CredentialProfile, crate::error::AppError> {
    {
        let key_guard = state.encryption_key.read().map_err(|e| lock_err(e))?;
        let key = key_guard.as_ref().ok_or("Vault locked")?;
        if let Some(pt) = request.password_plaintext.take() {
            if !pt.is_empty() {
                request.password_encrypted = Some(encryption::encrypt_v2(&pt, key)?);
            }
        }
        if let Some(pt) = request.private_key_plaintext.take() {
            if !pt.is_empty() {
                request.private_key_encrypted = Some(encryption::encrypt_v2(&pt, key)?);
            }
        }
    }
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::create_credential_profile(&conn, request)?)
}

#[tauri::command]
pub fn get_credential_profiles(state: tauri::State<AppState>) -> Result<Vec<CredentialProfile>, crate::error::AppError> {
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::get_credential_profiles(&conn)?)
}

#[tauri::command]
pub fn update_credential_profile(
    state: tauri::State<AppState>,
    mut request: UpdateCredentialProfileRequest,
) -> Result<(), crate::error::AppError> {
    {
        let key_guard = state.encryption_key.read().map_err(|e| lock_err(e))?;
        let key = key_guard.as_ref().ok_or("Vault locked")?;
        if let Some(pt) = request.password_plaintext.take() {
            if !pt.is_empty() {
                request.password_encrypted = Some(encryption::encrypt_v2(&pt, key)?);
            }
        }
        if let Some(pt) = request.private_key_plaintext.take() {
            if !pt.is_empty() {
                request.private_key_encrypted = Some(encryption::encrypt_v2(&pt, key)?);
            }
        }
    }
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::update_credential_profile(&conn, request)?)
}

#[tauri::command]
pub fn delete_credential_profile(state: tauri::State<AppState>, id: String) -> Result<(), crate::error::AppError> {
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::delete_credential_profile(&conn, &id)?)
}

/// CRIT-A4: internal credential resolution — never exposed over Tauri IPC.
///
/// Callers (ssh_connect, rdp_connect, vnc_native_connect, sftp_*, ftp_*) call this
/// server-side so plaintext passwords never leave the Rust process.
pub fn resolve_credentials_internal(
    conn: &rusqlite::Connection,
    master_key: &[u8; 32],
    connection_id: &str,
) -> Result<ResolvedCredentials, crate::error::AppError> {
    let connections = database::get_connections(conn)?;
    let connection = connections.into_iter().find(|c| c.id == connection_id)
        .ok_or("Connection not found")?;

    if connection.override_credentials || connection.credential_profile_id.is_none() {
        let p_decrypted = connection.password_encrypted.and_then(|c| encryption::decrypt_auto(&c, master_key).ok());
        let k_decrypted = connection.private_key_encrypted.and_then(|c| encryption::decrypt_auto(&c, master_key).ok());
        Ok(ResolvedCredentials {
            username: connection.username,
            password_decrypted: p_decrypted,
            private_key_decrypted: k_decrypted,
            domain: Some(connection.domain),
        })
    } else {
        let profile_id = connection.credential_profile_id.ok_or("Credential profile ID missing")?;
        let profiles = database::get_credential_profiles(conn)?;
        let profile = profiles.into_iter().find(|p| p.id == profile_id)
            .ok_or("Linked credential profile not found")?;

        let p_decrypted = profile.password_encrypted.and_then(|c| encryption::decrypt_auto(&c, master_key).ok());
        let k_decrypted = profile.private_key_encrypted.and_then(|c| encryption::decrypt_auto(&c, master_key).ok());

        Ok(ResolvedCredentials {
            username: profile.username.unwrap_or(connection.username),
            password_decrypted: p_decrypted,
            private_key_decrypted: k_decrypted,
            domain: profile.domain.or(Some(connection.domain)),
        })
    }
}
