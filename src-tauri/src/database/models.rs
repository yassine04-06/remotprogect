use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ── Data Models ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum CredentialType {
    SSH,
    RDP,
    FTP,
    Generic,
}

impl std::fmt::Display for CredentialType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CredentialType::SSH => write!(f, "ssh"),
            CredentialType::RDP => write!(f, "rdp"),
            CredentialType::FTP => write!(f, "ftp"),
            CredentialType::Generic => write!(f, "generic"),
        }
    }
}

impl std::str::FromStr for CredentialType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "ssh" => Ok(CredentialType::SSH),
            "rdp" => Ok(CredentialType::RDP),
            "ftp" => Ok(CredentialType::FTP),
            "generic" => Ok(CredentialType::Generic),
            _ => Ok(CredentialType::Generic),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CredentialProfile {
    pub id: String,
    pub name: String,
    #[ts(type = "CredentialType")]
    pub r#type: String,
    pub description: Option<String>,
    pub username: Option<String>,
    pub password_encrypted: Option<String>,
    pub private_key_encrypted: Option<String>,
    pub domain: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateCredentialProfileRequest {
    pub name: String,
    #[ts(type = "CredentialType")]
    pub r#type: String,
    pub description: Option<String>,
    pub username: Option<String>,
    /// Preferred: send plaintext here and let the server encrypt it.
    pub password_plaintext: Option<String>,
    /// Legacy: pre-encrypted ciphertext (still accepted for back-compat).
    pub password_encrypted: Option<String>,
    /// Preferred: send plaintext here and let the server encrypt it.
    pub private_key_plaintext: Option<String>,
    /// Legacy: pre-encrypted ciphertext (still accepted for back-compat).
    pub private_key_encrypted: Option<String>,
    pub domain: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UpdateCredentialProfileRequest {
    pub id: String,
    pub name: String,
    #[ts(type = "CredentialType")]
    pub r#type: String,
    pub description: Option<String>,
    pub username: Option<String>,
    /// Preferred: send plaintext here and let the server encrypt it.
    pub password_plaintext: Option<String>,
    /// Legacy: pre-encrypted ciphertext (still accepted for back-compat).
    pub password_encrypted: Option<String>,
    /// Preferred: send plaintext here and let the server encrypt it.
    pub private_key_plaintext: Option<String>,
    /// Legacy: pre-encrypted ciphertext (still accepted for back-compat).
    pub private_key_encrypted: Option<String>,
    pub domain: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SshTunnel {
    pub id: String,
    #[ts(type = "'Local' | 'Remote' | 'Dynamic'")]
    pub r#type: String,
    #[serde(rename = "localPort")]
    pub local_port: i32,
    #[serde(rename = "destinationHost")]
    pub destination_host: Option<String>,
    #[serde(rename = "destinationPort")]
    pub destination_port: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ServerConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    #[ts(type = "'SSH' | 'RDP' | 'VNC' | 'SFTP' | 'FTP' | 'PROXMOX' | 'DOCKER'")]
    pub protocol: String,
    pub username: String,
    pub password_encrypted: Option<String>,
    pub private_key_encrypted: Option<String>,
    pub group_id: Option<String>,
    pub use_private_key: bool,
    pub rdp_width: i32,
    pub rdp_height: i32,
    pub rdp_fullscreen: bool,
    pub domain: String,
    pub rdp_color_depth: i32,
    pub rdp_redirect_audio: bool,
    pub rdp_redirect_printers: bool,
    pub rdp_redirect_drives: bool,
    pub ssh_tunnels: Option<Vec<SshTunnel>>,
    pub credential_profile_id: Option<String>,
    pub override_credentials: bool,
    pub jump_host_id: Option<String>,
    pub use_ssh_agent: bool,          // 90-2 (v9)
    pub ssh_key_id: Option<String>,   // 90-1 (v9)
    pub tags: Option<String>,         // 90-7 (v10) comma-separated
    pub last_connected_at: Option<i64>, // 90-7 (v10) unix timestamp
    pub is_favorite: bool,            // 90-7 (v10)
    pub notes: Option<String>,        // 90-8 (v10)
    pub use_ftps: bool,               // 90-14 (v11)
    pub rdp_nla: bool,                // 90-12 (v11)
    #[ts(type = "'tcp' | 'socket' | 'https'")]
    pub docker_transport: String,     // 90-13 (v11) "tcp" | "socket" | "https" (H-3)
    pub docker_socket_path: Option<String>, // 90-13 (v11) path to unix socket
    pub docker_tls_ca_path: Option<String>,   // H-3 (v12) CA cert PEM path
    pub docker_tls_cert_path: Option<String>, // H-3 (v12) client cert PEM path
    pub docker_tls_key_path: Option<String>,  // H-3 (v12) client key PEM path
    pub proxmox_api_token_id: Option<String>,             // 90-15 (v11)
    pub proxmox_api_token_secret_encrypted: Option<String>, // 90-15 (v11)
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateConnectionRequest {
    pub name: String,
    pub host: String,
    pub port: i32,
    #[ts(type = "'SSH' | 'RDP' | 'VNC' | 'SFTP' | 'FTP' | 'PROXMOX' | 'DOCKER'")]
    pub protocol: String,
    pub username: String,
    /// Preferred: send plaintext here and let the server encrypt it.
    pub password_plaintext: Option<String>,
    /// Legacy: pre-encrypted ciphertext (still accepted for back-compat).
    pub password_encrypted: Option<String>,
    /// Preferred: send plaintext here and let the server encrypt it.
    pub private_key_plaintext: Option<String>,
    /// Legacy: pre-encrypted ciphertext (still accepted for back-compat).
    pub private_key_encrypted: Option<String>,
    pub group_id: Option<String>,
    pub use_private_key: bool,
    pub rdp_width: Option<i32>,
    pub rdp_height: Option<i32>,
    pub rdp_fullscreen: Option<bool>,
    pub domain: Option<String>,
    pub rdp_color_depth: Option<i32>,
    pub rdp_redirect_audio: Option<bool>,
    pub rdp_redirect_printers: Option<bool>,
    pub rdp_redirect_drives: Option<bool>,
    pub ssh_tunnels: Option<Vec<SshTunnel>>,
    pub credential_profile_id: Option<String>,
    pub override_credentials: Option<bool>,
    pub jump_host_id: Option<String>,
    pub ssh_key_id: Option<String>,
    pub use_ssh_agent: Option<bool>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub use_ftps: Option<bool>,
    pub rdp_nla: Option<bool>,
    pub docker_transport: Option<String>,
    pub docker_socket_path: Option<String>,
    pub docker_tls_ca_path: Option<String>,
    pub docker_tls_cert_path: Option<String>,
    pub docker_tls_key_path: Option<String>,
    pub proxmox_api_token_id: Option<String>,
    pub proxmox_api_token_secret_encrypted: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UpdateConnectionRequest {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    #[ts(type = "'SSH' | 'RDP' | 'VNC' | 'SFTP' | 'FTP' | 'PROXMOX' | 'DOCKER'")]
    pub protocol: String,
    pub username: String,
    /// Preferred: send plaintext here and let the server encrypt it.
    pub password_plaintext: Option<String>,
    /// Legacy: pre-encrypted ciphertext (still accepted for back-compat).
    pub password_encrypted: Option<String>,
    /// Preferred: send plaintext here and let the server encrypt it.
    pub private_key_plaintext: Option<String>,
    /// Legacy: pre-encrypted ciphertext (still accepted for back-compat).
    pub private_key_encrypted: Option<String>,
    pub group_id: Option<String>,
    pub use_private_key: bool,
    pub rdp_width: Option<i32>,
    pub rdp_height: Option<i32>,
    pub rdp_fullscreen: Option<bool>,
    pub domain: Option<String>,
    pub rdp_color_depth: Option<i32>,
    pub rdp_redirect_audio: Option<bool>,
    pub rdp_redirect_printers: Option<bool>,
    pub rdp_redirect_drives: Option<bool>,
    pub ssh_tunnels: Option<Vec<SshTunnel>>,
    pub credential_profile_id: Option<String>,
    pub override_credentials: Option<bool>,
    pub jump_host_id: Option<String>,
    pub ssh_key_id: Option<String>,
    pub use_ssh_agent: Option<bool>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub use_ftps: Option<bool>,
    pub rdp_nla: Option<bool>,
    pub docker_transport: Option<String>,
    pub docker_socket_path: Option<String>,
    pub docker_tls_ca_path: Option<String>,
    pub docker_tls_cert_path: Option<String>,
    pub docker_tls_key_path: Option<String>,
    pub proxmox_api_token_id: Option<String>,
    pub proxmox_api_token_secret_encrypted: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ExportData {
    pub version: i32,
    pub connections: Vec<ServerConnection>,
    pub groups: Vec<Group>,
    pub credential_profiles: Vec<CredentialProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SavedCommand {
    pub id: String,
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateSavedCommandRequest {
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UpdateSavedCommandRequest {
    pub id: String,
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SshKey {
    pub id: String,
    pub name: String,
    pub key_type: String,
    pub public_key: String,
    /// Private key encrypted with the vault master key (never leave backend plaintext).
    pub private_key_encrypted: String,
    pub fingerprint: String,
    pub comment: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateSshKeyRequest {
    pub name: String,
    pub key_type: String,
    pub public_key: String,
    pub private_key_encrypted: String,
    pub fingerprint: String,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct AuditEntry {
    pub id: String,
    pub timestamp: i64,
    pub action: String,
    pub entity_type: String,
    pub entity_id: String,
    pub entity_name: String,
    pub outcome: String,
    pub details: String,
    /// CRIT-A3: SHA-256 hash-chain node. Empty string for entries written before
    /// v13 (treated as "legacy" by audit_log_verify).
    pub chain_hash: String,
}

/// CRIT-A3: result of verifying a single audit log entry.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct AuditVerifyEntry {
    pub entry: AuditEntry,
    /// `true` if the stored chain_hash matches the recomputed value.
    pub hash_valid: bool,
    /// `true` for rows written before v13 (chain_hash is empty — cannot verify).
    pub is_legacy: bool,
}

/// CRIT-A3: overall chain verification result.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct AuditVerifyResult {
    pub entries: Vec<AuditVerifyEntry>,
    /// `true` only if every post-v13 entry has a valid hash and the chain is intact.
    pub chain_intact: bool,
    /// Number of legacy (pre-v13) entries that could not be verified.
    pub legacy_count: usize,
    /// Number of entries with invalid hashes (tampered or reordered).
    pub tampered_count: usize,
}
