use std::sync::{Mutex, RwLock};
use dashmap::DashMap;
use std::process::Child;

/// Sessione SSH attiva in memoria.
pub struct SshSession {
    pub child: std::sync::Arc<Mutex<Option<std::process::Child>>>,
    pub stdin_tx: std::sync::Arc<Mutex<Option<Box<dyn std::io::Write + Send>>>>,
    pub askpass_path: Option<std::path::PathBuf>,
}

/// Sessione shell locale attiva.
pub struct LocalShellSession {
    pub master: std::sync::Arc<Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>>,
    pub writer: std::sync::Arc<Mutex<Option<Box<dyn std::io::Write + Send>>>>,
    pub child: std::sync::Arc<Mutex<Option<Box<dyn portable_pty::Child + Send>>>>,
}

/// Stato condiviso dell'applicazione gestito da Tauri.
pub struct AppState {
    /// Connessione SQLite (thread-safe via Mutex).
    pub db: Mutex<rusqlite::Connection>,

    /// Chiave di cifratura derivata dalla master password. None = vault bloccato.
    pub encryption_key: RwLock<Option<[u8; 32]>>,

    /// Salt usato per PBKDF2.
    pub salt: RwLock<Option<Vec<u8>>>,

    /// Token di verifica per controllare la correttezza della master password.
    pub verification_token: RwLock<Option<String>>,

    /// Percorso del file di configurazione (salt + token).
    pub config_path: String,

    /// Processi RDP/VNC attivi, indicizzati per session ID.
    pub rdp_processes: DashMap<String, Child>,

    /// Sessioni SSH attive, indicizzate per session ID.
    /// FIX: spostate da OnceLock globale a stato Tauri per un ciclo di vita corretto.
    pub ssh_sessions: DashMap<String, SshSession>,

    /// Sessioni shell locale attive, indicizzate per session ID.
    /// FIX: idem — fuori dai globali, dentro lo stato gestito.
    pub shell_sessions: DashMap<String, LocalShellSession>,
}
