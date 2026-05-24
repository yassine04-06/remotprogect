use std::sync::{Arc, Mutex, RwLock};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64};
use dashmap::DashMap;
use std::process::Child;
use r2d2_sqlite::SqliteConnectionManager;
use crate::rdp::EmbeddedRdpSession;
use crate::docker::DockerExecSession;
use crate::vnc_client::VncSession;

// ── HIGH-A5: per-command rate limiter ─────────────────────────────────────────
// governor DashMapStateStore keyed on &'static str (command name).
// Each command gets its own independent 100 req/s bucket.
pub type CommandLimiter = governor::RateLimiter<
    &'static str,
    governor::state::keyed::DashMapStateStore<&'static str>,
    governor::clock::DefaultClock,
>;

/// Active SSH session held in memory.
///
/// HIGH-A1: migrated from portable_pty + OpenSSH subprocess to native russh.
/// `cmd_tx` is the channel into the background tokio task that owns the russh
/// session/channel. `recording` is shared with `ssh_send_input` / `ssh_resize`
/// so they can append 'i'/'r' events without touching the background task.
pub struct SshSession {
    pub cmd_tx: tokio::sync::mpsc::UnboundedSender<crate::ssh::SshCmd>,
    pub recording: Option<Arc<Mutex<SessionRecording>>>,
}

/// Active local shell session.
pub struct LocalShellSession {
    pub master: std::sync::Arc<Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>>,
    pub writer: std::sync::Arc<Mutex<Option<Box<dyn std::io::Write + Send>>>>,
    pub child: std::sync::Arc<Mutex<Option<Box<dyn portable_pty::Child + Send>>>>,
}

/// Shared application state managed by Tauri.
pub struct AppState {
    /// SQLite connection pool (WAL mode, up to 16 concurrent readers — HIGH-A2).
    pub db: r2d2::Pool<SqliteConnectionManager>,

    /// Encryption key derived from the master password. None = vault locked.
    pub encryption_key: RwLock<Option<[u8; 32]>>,

    /// PBKDF2 salt.
    pub salt: RwLock<Option<Vec<u8>>>,

    /// Verification token used to confirm the master password is correct.
    pub verification_token: RwLock<Option<String>>,

    /// Path to the configuration file (salt + token + kdf params).
    pub config_path: String,

    /// Application data directory.
    pub data_dir: String,

    // ── Vault hardening ───────────────────────────────────────────────────────

    /// PBKDF2 iteration count used when this vault was last (re-)keyed.
    /// Read from config.json so existing vaults unlock with their recorded count;
    /// bumped to DEFAULT_KDF_ITERATIONS on every set/change_master_password.
    pub kdf_iterations: RwLock<u32>,

    /// Unix-second timestamp of the last vault-touching IPC call.
    /// Written with Relaxed ordering — coarse-grained idle tracking only.
    pub last_activity_ts: Arc<AtomicU64>,

    /// Auto-lock idle timeout in seconds. 0 = disabled. Default 900 (15 min).
    /// Persisted to config.json via set_auto_lock_timeout (MED-A1).
    pub auto_lock_secs: RwLock<u64>,

    /// Consecutive failed unlock attempts since the last successful unlock.
    /// Reset to 0 on success; triggers a lockout at 5 failures.
    pub unlock_fail_count: Arc<AtomicU32>,

    /// Unix timestamp at or after which the next unlock attempt is allowed.
    /// 0 means no lockout is currently active.
    pub unlock_lockout_until: Arc<AtomicU64>,

    /// M-5: number of *consecutive lockouts* since the last successful unlock.
    /// Drives the escalating backoff (30s → 1m → 2m → 5m → 10m → 30m → 1h cap).
    /// Persisted to `lockout_state.json` so a restart cannot bypass the backoff.
    pub unlock_lockout_count: Arc<AtomicU32>,

    // ── Session maps ──────────────────────────────────────────────────────────

    /// Legacy RDP processes (mstsc), keyed by session ID.
    pub rdp_processes: DashMap<String, Child>,

    /// Embedded RDP sessions via the C# helper, keyed by session ID.
    pub rdp_sessions: DashMap<String, EmbeddedRdpSession>,

    /// Active SSH sessions, keyed by session ID.
    pub ssh_sessions: DashMap<String, SshSession>,

    /// Active local shell sessions, keyed by session ID.
    pub shell_sessions: DashMap<String, LocalShellSession>,

    /// Active Docker exec sessions, keyed by session ID.
    pub docker_exec_sessions: DashMap<String, DockerExecSession>,

    /// LOW-A8: Per-scan cancellation flags keyed by scan_id.
    /// Using a DashMap allows multiple concurrent scans and cancels
    /// only the targeted one via cancel_network_scan(scan_id).
    pub network_scan_cancel: DashMap<String, Arc<AtomicBool>>,

    // ── 30-11: SFTP session pool ──────────────────────────────────────────────
    /// Cached ssh2 sessions keyed by "host:port:username".
    pub sftp_pool: DashMap<String, Arc<std::sync::Mutex<Option<crate::sftp_ftp::CachedSftpSession>>>>,

    // ── 90-11: Native VNC sessions ────────────────────────────────────────────
    /// Active VNC streaming sessions keyed by session_id.
    pub vnc_sessions: DashMap<String, VncSession>,

    // ── 90-3: Session recordings ──────────────────────────────────────────────
    /// Active asciinema-format recordings keyed by session_id.
    pub recording_sessions: DashMap<String, Arc<std::sync::Mutex<SessionRecording>>>,

    // ── HIGH-A5: per-command rate limiter ─────────────────────────────────────
    /// Shared 100 req/s governor bucket, keyed by command name (&'static str).
    /// Prevents a runaway frontend effect loop from saturating the DB pool.
    pub command_limiter: Arc<CommandLimiter>,

    // ── HIGH-A7: re-key serialization lock ───────────────────────────────────
    /// Held for the entire duration of `change_master_password` (DB re-encrypt +
    /// config.json write + RAM key swap).  Prevents two concurrent re-key calls
    /// from interleaving and leaving encrypted blobs that belong to different keys.
    ///
    /// Note: this is a *contention* lock, not an *exclusion* lock for other vault
    /// reads — normal encrypt/decrypt operations run concurrently under the
    /// `encryption_key` RwLock as usual.  Only concurrent re-key operations are
    /// serialized here.
    pub rekey_lock: std::sync::Mutex<()>,

    // ── MED-A2: unlock serialization lock ────────────────────────────────────
    /// Serializes the entire `unlock_vault` flow so that a concurrent wrong-
    /// password attempt cannot set `unlock_lockout_until` *after* a concurrent
    /// correct-password attempt has already cleared it, which would leave the
    /// vault unlocked in RAM but permanently locked-out at the IPC level until
    /// the lockout timer expires.
    ///
    /// PBKDF2 at 600 k iterations takes ~100–300 ms; holding a blocking Mutex
    /// for that duration is acceptable on a single-user desktop app.
    pub unlock_mutex: std::sync::Mutex<()>,
}

/// In-memory state for a live session recording (asciinema v2 + 'i'/'r' ext).
pub struct SessionRecording {
    pub start_time: std::time::Instant,
    /// Buffered events: (elapsed_secs, kind, data).
    /// `kind` is one of:
    ///   'o' — terminal output (stdout/stderr from the remote PTY)
    ///   'i' — user input sent to the remote PTY
    ///   'r' — resize, with data formatted as "{cols}x{rows}" (non-standard
    ///         asciinema v2 extension; the frontend playback honors it).
    pub events: Vec<(f64, char, String)>,
    pub cols: u16,
    pub rows: u16,
}
