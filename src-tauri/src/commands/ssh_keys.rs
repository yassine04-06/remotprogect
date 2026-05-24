use crate::state::AppState;
use crate::database;
use crate::{lock_err};
use crate::encryption;
use serde::Deserialize;

#[tauri::command]
pub fn ssh_key_list(state: tauri::State<AppState>) -> Result<Vec<database::SshKey>, crate::error::AppError> {
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::ssh_key_list(&conn)?)
}

#[derive(Deserialize)]
pub struct SshKeyCreateRequest {
    name: String,
    key_type: String,
    public_key: String,
    private_key_plaintext: Option<String>,
    private_key_encrypted: Option<String>,
    fingerprint: String,
    comment: Option<String>,
}

#[tauri::command]
pub fn ssh_key_create(
    state: tauri::State<AppState>,
    request: SshKeyCreateRequest,
) -> Result<database::SshKey, crate::error::AppError> {
    let encrypted = if let Some(pt) = request.private_key_plaintext.filter(|s| !s.is_empty()) {
        let key_guard = state.encryption_key.read().map_err(|e| lock_err(e))?;
        let key = key_guard.as_ref().ok_or("Vault locked")?;
        encryption::encrypt_v2(&pt, key)?
    } else {
        request.private_key_encrypted
            .ok_or("Either private_key_plaintext or private_key_encrypted must be provided")?
    };

    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::ssh_key_create(&conn, database::CreateSshKeyRequest {
        name: request.name,
        key_type: request.key_type,
        public_key: request.public_key,
        private_key_encrypted: encrypted,
        fingerprint: request.fingerprint,
        comment: request.comment,
    })?)
}

#[tauri::command]
pub fn ssh_key_delete(state: tauri::State<AppState>, id: String) -> Result<(), crate::error::AppError> {
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::ssh_key_delete(&conn, &id)?)
}

#[tauri::command]
pub fn ssh_key_generate(
    state: tauri::State<AppState>,
    name: String,
    key_type: String,
    comment: Option<String>,
) -> Result<database::SshKey, crate::error::AppError> {
    let key_guard = state.encryption_key.read().map_err(|e| format!("Lock: {}", e))?;
    let master_key = key_guard.as_ref().ok_or("Vault locked")?;

    let tmp_dir = std::env::temp_dir().join(format!("nxk_{}", &uuid::Uuid::new_v4().to_string()[..8]));
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("tmp dir: {}", e))?;
    let key_path = tmp_dir.join("id_key");

    let kt = if key_type == "rsa" { "rsa" } else { "ed25519" };
    let comment_arg = comment.clone().unwrap_or_else(|| format!("nexorc@{}", name));

    let output = std::process::Command::new("ssh-keygen")
        .args(["-t", kt, "-C", &comment_arg, "-f", key_path.to_str().unwrap_or(""), "-N", "", "-q"])
        .output()
        .map_err(|e| format!("ssh-keygen not found: {}", e))?;

    if !output.status.success() {
        let _ = std::fs::remove_dir_all(&tmp_dir);
        return Err(format!("ssh-keygen failed: {}", String::from_utf8_lossy(&output.stderr)).into());
    }

    let pub_path = key_path.with_extension("pub");
    let priv_pem = std::fs::read_to_string(&key_path)
        .map_err(|e| format!("read private key: {}", e))?;
    let pub_key = std::fs::read_to_string(&pub_path)
        .map_err(|e| format!("read public key: {}", e))?;

    let _ = std::fs::remove_file(&key_path);
    let _ = std::fs::remove_file(&pub_path);
    let _ = std::fs::remove_dir_all(&tmp_dir);

    let fingerprint = compute_ssh_fingerprint(&pub_key);

    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    let priv_enc = encryption::encrypt_v2(priv_pem.trim(), master_key)
        .map_err(|e| format!("encrypt private key: {}", e))?;

    let key = database::ssh_key_create(&conn, database::CreateSshKeyRequest {
        name,
        key_type: kt.to_string(),
        public_key: pub_key.trim().to_string(),
        private_key_encrypted: priv_enc,
        fingerprint,
        comment,
    })?;

    tracing::info!("SSH key generated and stored: id={} type={}", key.id, key.key_type);
    Ok(key)
}

pub fn compute_ssh_fingerprint(pub_key_line: &str) -> String {
    let parts: Vec<&str> = pub_key_line.trim().splitn(3, ' ').collect();
    if parts.len() < 2 {
        return "unknown".to_string();
    }
    use base64::Engine;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(parts[1])
        .unwrap_or_default();
    use sha2::Digest;
    let digest = sha2::Sha256::digest(&raw);
    let b64 = base64::engine::general_purpose::STANDARD.encode(digest);
    format!("SHA256:{}", b64.trim_end_matches('='))
}
