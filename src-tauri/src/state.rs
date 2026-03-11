use std::sync::RwLock;
use std::sync::Mutex;
use dashmap::DashMap;
use std::process::Child;

/// Holds the shared application state managed by Tauri.
pub struct AppState {
    /// SQLite database connection (thread-safe via Mutex).
    pub db: Mutex<rusqlite::Connection>,
    /// Derived encryption key from the master password. None when vault is locked.
    pub encryption_key: RwLock<Option<[u8; 32]>>,
    /// Salt used for PBKDF2 key derivation.
    pub salt: RwLock<Option<Vec<u8>>>,
    /// Verification token to check if master password is correct.
    pub verification_token: RwLock<Option<String>>,
    /// Path to the config file storing salt and verification token.
    pub config_path: String,
    /// Active RDP child processes, keyed by session ID.
    pub rdp_processes: DashMap<String, Child>,
}
