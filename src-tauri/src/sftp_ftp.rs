use crate::error::AppError;
use serde::Serialize;
use serde_json;
use ts_rs::TS;
use ssh2::Session;
use std::io::{Read, Seek, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::{Arc, Mutex};
use suppaftp::{FtpStream, NativeTlsFtpStream, NativeTlsConnector};
use native_tls::TlsConnector;
use tauri::Emitter;
use base64;

// ── CRIT-A4: resolved connection auth, looked up entirely server-side ─────────
struct ResolvedConn {
    host: String,
    port: i32,
    username: String,
    password: Option<String>,
    private_key_decrypted: Option<String>,
    use_ftps: bool,
}

fn resolve_conn_internal(
    state: &crate::state::AppState,
    connection_id: &str,
) -> Result<ResolvedConn, AppError> {
    let conn = state.db.get().map_err(|e| AppError::Internal(format!("DB pool: {}", e)))?;
    let all = crate::database::get_connections(&conn)
        .map_err(|e| AppError::Internal(e))?;
    let connection = all.into_iter().find(|c| c.id == connection_id)
        .ok_or_else(|| AppError::Internal("Connection not found".to_string()))?;

    let key_guard = state.encryption_key.read()
        .map_err(|e| AppError::Internal(format!("Lock: {}", e)))?;
    let master_key = key_guard.as_ref()
        .ok_or_else(|| AppError::AuthFailed("Vault locked".to_string()))?;

    let creds = crate::commands::credentials::resolve_credentials_internal(&conn, master_key, connection_id)?;

    Ok(ResolvedConn {
        host: connection.host,
        port: connection.port,
        username: creds.username,
        password: creds.password_decrypted,
        private_key_decrypted: creds.private_key_decrypted,
        use_ftps: connection.use_ftps,
    })
}

// ── 30-11: SFTP connection pool ───────────────────────────
//
// ssh2::Session is not Send, so we wrap it in a newtype with an unsafe impl.
// Safety: we only ever access a CachedSftpSession while holding its Mutex.

pub struct CachedSftpSession {
    pub inner: SftpSessionSend,
    pub last_used: std::time::Instant,
}

pub struct SftpSessionSend(ssh2::Session);
unsafe impl Send for SftpSessionSend {}
unsafe impl Sync for SftpSessionSend {}

/// MED-A3: idle TTL for pooled SFTP sessions.
/// Sessions unused for longer than this are evicted by the background sweep
/// or on the next `pool_take` call (lazy eviction).
const POOL_TTL_SECS: u64 = 3600; // 60 minutes (MED-A3)

fn pool_key(host: &str, port: i32, username: &str) -> String {
    format!("{}:{}:{}", host, port, username)
}

fn pool_take(
    pool: &dashmap::DashMap<String, Arc<Mutex<Option<CachedSftpSession>>>>,
    key: &str,
) -> Option<ssh2::Session> {
    let entry = pool.get(key)?;
    let mut guard = entry.lock().ok()?;
    let cached = guard.take()?;
    if cached.last_used.elapsed().as_secs() < POOL_TTL_SECS
        && cached.inner.0.authenticated()
    {
        Some(cached.inner.0)
    } else {
        None // stale or dead — drop it
    }
}

fn pool_return(
    pool: &dashmap::DashMap<String, Arc<Mutex<Option<CachedSftpSession>>>>,
    key: &str,
    sess: ssh2::Session,
) {
    let entry = pool
        .entry(key.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(None)));
    // Clone the Arc out of the DashMap RefMut before releasing the shard lock.
    let arc = Arc::clone(&*entry);
    drop(entry);
    if let Ok(mut guard) = arc.lock() {
        *guard = Some(CachedSftpSession {
            inner: SftpSessionSend(sess),
            last_used: std::time::Instant::now(),
        });
    };
}

/// MED-A3: sweep the SFTP pool and remove entries that are stale (idle ≥ TTL)
/// or no longer authenticated.
///
/// Called from the auto-lock watcher thread every ~5 minutes, and also on
/// `lock_vault` via `sftp_pool.clear()`.  Uses `try_lock` so an entry that is
/// currently in use (another thread holds its Mutex) is left untouched.
pub fn pool_evict_stale(
    pool: &dashmap::DashMap<String, Arc<Mutex<Option<CachedSftpSession>>>>,
) {
    pool.retain(|_key, arc| {
        // If Mutex is currently held by an active SFTP command, skip eviction.
        let Ok(guard) = arc.try_lock() else { return true };
        match &*guard {
            None => false, // already vacated — remove the shell entry
            Some(c) => {
                let age = c.last_used.elapsed().as_secs();
                let alive = c.inner.0.authenticated();
                age < POOL_TTL_SECS && alive
            }
        }
    });
}

/// MED-A3: Tauri command — explicitly evict the SFTP pool entry for the given
/// connection.  The frontend calls this when FileManagerView unmounts so that
/// dead TCP sockets are closed promptly instead of waiting for the 60-min TTL.
#[tauri::command]
pub fn sftp_disconnect(
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
) -> Result<(), AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    let key = pool_key(&rc.host, rc.port, &rc.username);
    state.sftp_pool.remove(&key);
    tracing::debug!("SFTP pool: evicted '{}' (explicit disconnect)", key);
    Ok(())
}

#[derive(Serialize, TS)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: Option<u64>,
}

#[derive(Serialize, TS)]
pub struct FileListResult {
    pub files: Vec<FileNode>,
    pub current_path: String,
}

#[derive(Clone, Serialize)]
struct TransferProgress {
    transfer_id: String,
    transferred: u64,
    total: u64,
    percent: u8,
    done: bool,
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn emit_progress(app: &tauri::AppHandle, id: &str, transferred: u64, total: u64, done: bool) {
    let percent = if total > 0 { (transferred * 100 / total).min(100) as u8 } else { 0 };
    let _ = app.emit(
        "transfer:progress",
        TransferProgress {
            transfer_id: id.to_string(),
            transferred,
            total,
            percent,
            done,
        },
    );
}

fn connect_ssh2(
    host: &str,
    port: i32,
    username: &str,
    password: Option<&str>,
    private_key_path: Option<&str>,
    data_dir: &str,
) -> Result<Session, AppError> {
    let tcp = TcpStream::connect(format!("{}:{}", host, port))
        .map_err(|e| AppError::Network(format!("TCP connect error: {}", e)))?;
    let mut sess =
        Session::new().map_err(|e| AppError::Internal(format!("Failed to create ssh session: {}", e)))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| AppError::Network(format!("SSH handshake failed: {}", e)))?;

    // ── NXS-001 fix: host-key TOFU verification ──────────────────────
    // Without this, libssh2 accepts any server key silently → trivial MITM.
    let (raw_key, key_type) = sess
        .host_key()
        .ok_or_else(|| AppError::Network("Server presented no host key".to_string()))?;
    let key_type_str = match key_type {
        ssh2::HostKeyType::Rsa => "ssh-rsa",
        ssh2::HostKeyType::Dss => "ssh-dss",
        ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
        _ => "unknown",
    };
    match crate::known_hosts::verify(data_dir, host, port, key_type_str, raw_key) {
        crate::known_hosts::VerifyResult::Trusted => {
            // OK — key matches a previously trusted entry
        }
        crate::known_hosts::VerifyResult::Unknown { fingerprint_sha256, .. } => {
            // CRIT-2 fix: do NOT silently auto-trust on first encounter.
            // Return a structured error that the frontend can parse to show a
            // "Trust this host?" confirmation dialog.  The raw key is base64-encoded
            // so the frontend can call ssh_trust_host_key after the user confirms.
            let raw_key_b64 = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                raw_key,
            );
            tracing::warn!(
                "SFTP host key unknown — refusing to auto-trust {}:{} {} {}",
                host, port, key_type_str, fingerprint_sha256
            );
            return Err(AppError::AuthFailed(format!(
                "UNKNOWN_HOST_KEY:{}",
                serde_json::json!({
                    "host": host,
                    "port": port,
                    "key_type": key_type_str,
                    "fingerprint": fingerprint_sha256,
                    "raw_key_b64": raw_key_b64,
                })
            )));
        }
        crate::known_hosts::VerifyResult::Mismatch {
            fingerprint_sha256,
            stored_fingerprint_sha256,
            ..
        } => {
            // Refuse to connect — possible MITM.
            tracing::error!(
                "SSH host key MISMATCH for {}:{} — stored {} got {}",
                host, port, stored_fingerprint_sha256, fingerprint_sha256
            );
            return Err(AppError::AuthFailed(format!(
                "REMOTE HOST IDENTIFICATION HAS CHANGED for {}:{}.\n\
                 Stored fingerprint: {}\n\
                 Server fingerprint: {}\n\
                 This could be a man-in-the-middle attack. Refusing to connect.",
                host, port, stored_fingerprint_sha256, fingerprint_sha256
            )));
        }
    }

    if let Some(key) = private_key_path {
        if !key.is_empty() {
            sess.userauth_pubkey_file(username, None, Path::new(key), password)
                .map_err(|e| AppError::AuthFailed(format!("Pubkey auth failed: {}", e)))?;
            return Ok(sess);
        }
    }

    if let Some(pass) = password {
        sess.userauth_password(username, pass)
            .map_err(|e| AppError::AuthFailed(format!("Password auth failed: {}", e)))?;
    } else {
        return Err(AppError::AuthFailed("No authentication method provided".to_string()));
    }

    if !sess.authenticated() {
        return Err(AppError::AuthFailed("Authentication failed".to_string()));
    }

    Ok(sess)
}

// ==========================================
// SFTP Implementation (using ssh2)
// ==========================================

/// CRIT-A4: connect_ssh2_from_resolved wraps connect_ssh2 using server-resolved creds.
/// If the creds include a private key, the content is written to a temp file first.
fn connect_ssh2_resolved(rc: &ResolvedConn, data_dir: &str) -> Result<(Session, Option<std::path::PathBuf>), AppError> {
    // Write private key content to a temp file if present
    let tmp: Option<std::path::PathBuf> = if let Some(ref key_content) = rc.private_key_decrypted {
        let p = std::env::temp_dir().join(format!("nxsftp_{}.pem", uuid::Uuid::new_v4()));
        std::fs::write(&p, key_content.as_bytes())
            .map_err(|e| AppError::Internal(format!("Write key: {}", e)))?;
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)); }
        Some(p)
    } else {
        None
    };
    let key_path_str = tmp.as_ref().map(|p| p.to_string_lossy().into_owned());
    let sess = connect_ssh2(&rc.host, rc.port, &rc.username, rc.password.as_deref(), key_path_str.as_deref(), data_dir)?;
    Ok((sess, tmp))
}

#[tauri::command]
pub fn sftp_list_dir(
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    path: String,
) -> Result<FileListResult, AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    let pool_k = pool_key(&rc.host, rc.port, &rc.username);
    let (sess, tmp) = if let Some(existing) = pool_take(&state.sftp_pool, &pool_k) {
        (existing, None)
    } else {
        connect_ssh2_resolved(&rc, &state.data_dir)?
    };
    if let Some(t) = tmp { let _ = std::fs::remove_file(t); }

    let sftp = sess.sftp().map_err(|e| AppError::Network(format!("SFTP subsystem error: {}", e)))?;

    let stat = sftp
        .stat(Path::new(&path))
        .map_err(|e| AppError::Network(format!("Failed to stat path: {}", e)))?;
    if !stat.is_dir() {
        return Err(AppError::Validation("Path is not a directory".to_string()));
    }

    let files = sftp
        .readdir(Path::new(&path))
        .map_err(|e| AppError::Network(format!("Failed to read dir: {}", e)))?;
    let mut nodes = Vec::new();

    for (file_path, stat) in files {
        let name = file_path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }

        nodes.push(FileNode {
            name,
            path: file_path.to_string_lossy().to_string().replace("\\", "/"),
            is_dir: stat.is_dir(),
            size: stat.size.unwrap_or(0),
            modified_at: stat.mtime,
        });
    }

    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    // Return session to pool
    drop(sftp);
    pool_return(&state.sftp_pool, &pool_k, sess);
    Ok(FileListResult {
        files: nodes,
        current_path: path.trim_end_matches('/').to_string(),
    })
}

#[tauri::command]
pub fn sftp_upload(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
    resume: bool,
) -> Result<(), AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    let total = std::fs::metadata(&local_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Upload sessions are not pooled (see comment on original).
    let (sess, tmp) = connect_ssh2_resolved(&rc, &state.data_dir)?;
    if let Some(t) = tmp { let _ = std::fs::remove_file(t); }
    let sftp = sess.sftp().map_err(|e| AppError::Network(format!("SFTP subsystem error: {}", e)))?;

    // Check for an existing partial upload to resume from
    let skip_bytes: u64 = if resume && total > 0 {
        sftp.stat(Path::new(&remote_path))
            .ok()
            .and_then(|s| s.size)
            .filter(|&s| s > 0 && s < total)
            .unwrap_or(0)
    } else {
        0
    };

    let mut local_file =
        std::fs::File::open(&local_path).map_err(|e| AppError::Internal(format!("Failed to open local file: {}", e)))?;

    let mut remote_file = if skip_bytes > 0 {
        local_file
            .seek(std::io::SeekFrom::Start(skip_bytes))
            .map_err(|e| AppError::Internal(format!("Seek error: {}", e)))?;
        sftp.open_mode(
            Path::new(&remote_path),
            ssh2::OpenFlags::WRITE | ssh2::OpenFlags::APPEND,
            0o644,
            ssh2::OpenType::File,
        )
        .map_err(|e| AppError::Network(format!("Failed to open remote file for append: {}", e)))?
    } else {
        sftp.create(Path::new(&remote_path))
            .map_err(|e| AppError::Network(format!("Failed to create remote file: {}", e)))?
    };

    let mut transferred = skip_bytes;
    let mut last_emit: u64 = 0;
    let mut buffer = [0u8; 65536];

    loop {
        let n = local_file.read(&mut buffer).map_err(|e| AppError::Internal(format!("Read error: {}", e)))?;
        if n == 0 {
            break;
        }
        remote_file.write_all(&buffer[..n]).map_err(|e| AppError::Network(format!("Write error: {}", e)))?;
        transferred += n as u64;

        if transferred.saturating_sub(last_emit) >= 65536 {
            emit_progress(&app, &transfer_id, transferred, total, false);
            last_emit = transferred;
        }
    }

    emit_progress(&app, &transfer_id, total, total, true);
    Ok(())
}

#[tauri::command]
pub fn sftp_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
    resume: bool,
) -> Result<(), AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    let (sess, tmp) = connect_ssh2_resolved(&rc, &state.data_dir)?;
    if let Some(t) = tmp { let _ = std::fs::remove_file(t); }
    let sftp = sess.sftp().map_err(|e| AppError::Network(format!("SFTP subsystem error: {}", e)))?;

    let total = sftp
        .stat(Path::new(&remote_path))
        .ok()
        .and_then(|s| s.size)
        .unwrap_or(0);

    // Check for an existing partial local file to resume from
    let skip_bytes: u64 = if resume && total > 0 {
        std::fs::metadata(&local_path)
            .map(|m| m.len())
            .ok()
            .filter(|&s| s > 0 && s < total)
            .unwrap_or(0)
    } else {
        0
    };

    let mut remote_file = if skip_bytes > 0 {
        sftp.open_mode(
            Path::new(&remote_path),
            ssh2::OpenFlags::READ,
            0,
            ssh2::OpenType::File,
        )
        .map_err(|e| AppError::Network(format!("Failed to open remote file: {}", e)))?
    } else {
        sftp.open(Path::new(&remote_path))
            .map_err(|e| AppError::Network(format!("Failed to open remote file: {}", e)))?
    };

    if skip_bytes > 0 {
        remote_file
            .seek(std::io::SeekFrom::Start(skip_bytes))
            .map_err(|e| AppError::Internal(format!("Seek error: {}", e)))?;
    }

    let mut local_file = if skip_bytes > 0 {
        std::fs::OpenOptions::new()
            .append(true)
            .open(&local_path)
            .map_err(|e| AppError::Internal(format!("Failed to open local file for append: {}", e)))?
    } else {
        std::fs::File::create(&local_path)
            .map_err(|e| AppError::Internal(format!("Failed to create local file: {}", e)))?
    };

    let mut transferred = skip_bytes;
    let mut last_emit: u64 = 0;
    let mut buffer = [0u8; 65536];

    loop {
        let n =
            remote_file.read(&mut buffer).map_err(|e| AppError::Network(format!("Read error: {}", e)))?;
        if n == 0 {
            break;
        }
        local_file.write_all(&buffer[..n]).map_err(|e| AppError::Internal(format!("Write error: {}", e)))?;
        transferred += n as u64;

        if transferred.saturating_sub(last_emit) >= 65536 {
            emit_progress(&app, &transfer_id, transferred, total, false);
            last_emit = transferred;
        }
    }

    emit_progress(&app, &transfer_id, total, total, true);
    Ok(())
}

#[tauri::command]
pub fn sftp_delete(
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    let pool_k = pool_key(&rc.host, rc.port, &rc.username);
    let (sess, tmp) = if let Some(existing) = pool_take(&state.sftp_pool, &pool_k) {
        (existing, None)
    } else {
        connect_ssh2_resolved(&rc, &state.data_dir)?
    };
    if let Some(t) = tmp { let _ = std::fs::remove_file(t); }
    let sftp = sess.sftp().map_err(|e| AppError::Network(format!("SFTP subsystem error: {}", e)))?;

    if is_dir {
        sftp.rmdir(Path::new(&path)).map_err(|e| AppError::Network(format!("Failed to remove directory: {}", e)))?;
    } else {
        sftp.unlink(Path::new(&path)).map_err(|e| AppError::Network(format!("Failed to remove file: {}", e)))?;
    }

    drop(sftp);
    pool_return(&state.sftp_pool, &pool_k, sess);
    Ok(())
}

#[tauri::command]
pub fn sftp_rename(
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    let pool_k = pool_key(&rc.host, rc.port, &rc.username);
    let (sess, tmp) = if let Some(existing) = pool_take(&state.sftp_pool, &pool_k) {
        (existing, None)
    } else {
        connect_ssh2_resolved(&rc, &state.data_dir)?
    };
    if let Some(t) = tmp { let _ = std::fs::remove_file(t); }
    let sftp = sess.sftp().map_err(|e| AppError::Network(format!("SFTP subsystem error: {}", e)))?;

    sftp.rename(Path::new(&old_path), Path::new(&new_path), None)
        .map_err(|e| AppError::Network(format!("Failed to rename: {}", e)))?;
    drop(sftp);
    pool_return(&state.sftp_pool, &pool_k, sess);
    Ok(())
}

#[tauri::command]
pub fn sftp_mkdir(
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    path: String,
) -> Result<(), AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    let pool_k = pool_key(&rc.host, rc.port, &rc.username);
    let (sess, tmp) = if let Some(existing) = pool_take(&state.sftp_pool, &pool_k) {
        (existing, None)
    } else {
        connect_ssh2_resolved(&rc, &state.data_dir)?
    };
    if let Some(t) = tmp { let _ = std::fs::remove_file(t); }
    let sftp = sess.sftp().map_err(|e| AppError::Network(format!("SFTP subsystem error: {}", e)))?;

    sftp.mkdir(Path::new(&path), 0o755)
        .map_err(|e| AppError::Network(format!("Failed to create directory: {}", e)))?;
    drop(sftp);
    pool_return(&state.sftp_pool, &pool_k, sess);
    Ok(())
}

// ==========================================
// FTP Implementation (using suppaftp)
// ==========================================

fn connect_ftp(
    host: &str,
    port: i32,
    username: &str,
    password: Option<&str>,
) -> Result<FtpStream, AppError> {
    let addr = format!("{}:{}", host, port);
    let mut ftp_stream =
        FtpStream::connect(addr).map_err(|e| AppError::Network(format!("FTP connect error: {}", e)))?;

    let pass = password.unwrap_or("");
    ftp_stream.login(username, pass).map_err(|e| AppError::AuthFailed(format!("FTP login failed: {}", e)))?;

    Ok(ftp_stream)
}

// 90-14: FTPS (explicit TLS via AUTH TLS / STARTTLS)
fn connect_ftps(
    host: &str,
    port: i32,
    username: &str,
    password: Option<&str>,
) -> Result<NativeTlsFtpStream, AppError> {
    let addr = format!("{}:{}", host, port);
    // Must start as NativeTlsFtpStream so into_secure's T=NativeTlsStream matches NativeTlsConnector
    let ftp_stream =
        NativeTlsFtpStream::connect(addr).map_err(|e| AppError::Network(format!("FTPS connect error: {}", e)))?;

    let tls_connector = TlsConnector::new().map_err(|e| AppError::Internal(format!("TLS connector error: {}", e)))?;
    let connector = NativeTlsConnector::from(tls_connector);
    let mut ftps = ftp_stream
        .into_secure(connector, host)
        .map_err(|e| AppError::Network(format!("STARTTLS upgrade failed: {}", e)))?;

    let pass = password.unwrap_or("");
    ftps.login(username, pass).map_err(|e| AppError::AuthFailed(format!("FTPS login failed: {}", e)))?;

    Ok(ftps)
}

// 90-16: MLSD parser — parses a raw RFC 3659 MLSD line into a FileNode
// Format: "type=file;size=1234;modify=20200101120000; filename.txt"
fn mlsd_to_node(line: &str, base_path: &str) -> Option<FileNode> {
    // Split facts from name: last semicolon + space separates them
    let (facts_str, name) = if let Some(sp) = line.find("; ") {
        (&line[..sp], line[sp + 2..].trim())
    } else {
        return None;
    };

    if name.is_empty() || name == "." || name == ".." {
        return None;
    }

    let mut is_dir = false;
    let mut size: u64 = 0;
    let mut modified_at: Option<u64> = None;

    for fact in facts_str.split(';') {
        let mut parts = fact.splitn(2, '=');
        let key = parts.next().unwrap_or("").trim().to_lowercase();
        let val = parts.next().unwrap_or("").trim();
        match key.as_str() {
            "type" => {
                is_dir = val.eq_ignore_ascii_case("dir") || val.eq_ignore_ascii_case("cdir") || val.eq_ignore_ascii_case("pdir");
            }
            "size" => {
                size = val.parse::<u64>().unwrap_or(0);
            }
            "modify" => {
                // Format: YYYYMMDDHHmmss[.fractional]
                let ts_str = &val[..val.len().min(14)];
                if ts_str.len() >= 14 {
                    // Parse as naive datetime and convert to unix timestamp
                    if let (Ok(y), Ok(mo), Ok(d), Ok(h), Ok(mi), Ok(s)) = (
                        ts_str[0..4].parse::<i64>(),
                        ts_str[4..6].parse::<i64>(),
                        ts_str[6..8].parse::<i64>(),
                        ts_str[8..10].parse::<i64>(),
                        ts_str[10..12].parse::<i64>(),
                        ts_str[12..14].parse::<i64>(),
                    ) {
                        // Rough unix timestamp (ignores leap seconds)
                        let days_since_epoch = days_from_ymd(y, mo, d);
                        let ts = days_since_epoch * 86400 + h * 3600 + mi * 60 + s;
                        modified_at = Some(ts as u64);
                    }
                }
            }
            _ => {}
        }
    }

    let full_path = if base_path == "/" || base_path.is_empty() {
        format!("/{}", name)
    } else {
        format!("{}/{}", base_path.trim_end_matches('/'), name)
    };

    Some(FileNode { name: name.to_string(), path: full_path, is_dir, size, modified_at })
}

// Compute days since Unix epoch (1970-01-01) for a given date.
fn days_from_ymd(y: i64, m: i64, d: i64) -> i64 {
    // Algorithm from https://howardhinnant.github.io/date_algorithms.html
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn parse_ftp_list_line(line: &str, base_path: &str) -> Option<FileNode> {
    // Quick, highly naive UNIX `ls -l` parser.
    // Example: drwxr-xr-x    2 user     group        4096 Feb 25 15:00 FolderName
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 9 {
        return None;
    }

    let perms = parts[0];
    let is_dir = perms.starts_with('d');
    let size = parts[4].parse::<u64>().unwrap_or(0);

    // The filename might contain spaces, so we combine everything from index 8 onwards
    let name = parts[8..].join(" ");
    if name == "." || name == ".." {
        return None;
    }

    let full_path = if base_path == "/" || base_path.is_empty() {
        format!("/{}", name)
    } else {
        format!("{}/{}", base_path.trim_end_matches('/'), name)
    };

    Some(FileNode {
        name,
        path: full_path,
        is_dir,
        size,
        modified_at: None,
    })
}

/// CRIT-A4: `connection_id` replaces `host`, `port`, `username`, `password`, `use_ftps`.
#[tauri::command]
pub fn ftp_list_dir(
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    path: String,
) -> Result<FileListResult, AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    let safe_path = if path.is_empty() { "/".to_string() } else { path.clone() };

    let mut nodes: Vec<FileNode> = Vec::new();

    macro_rules! list_with {
        ($ftp:expr) => {{
            $ftp.cwd(&safe_path).map_err(|e| AppError::Network(format!("CWD failed: {}", e)))?;
            // 90-16: try MLSD first (RFC 3659 machine-readable listing)
            if let Ok(lines) = $ftp.mlsd(None) {
                for line in &lines {
                    if let Some(node) = mlsd_to_node(line, &safe_path) {
                        nodes.push(node);
                    }
                }
            } else {
                let list_data = $ftp.list(None).map_err(|e| AppError::Network(format!("LIST failed: {}", e)))?;
                for line in &list_data {
                    if let Some(node) = parse_ftp_list_line(line, &safe_path) {
                        nodes.push(node);
                    }
                }
            }
            $ftp.quit().ok();
        }};
    }

    if rc.use_ftps {
        let mut ftp = connect_ftps(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        list_with!(ftp);
    } else {
        let mut ftp = connect_ftp(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        list_with!(ftp);
    }

    nodes.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(FileListResult {
        files: nodes,
        current_path: safe_path,
    })
}

// Reader wrapper that emits progress events as bytes flow through it.
struct ProgressReader<R: Read> {
    inner: R,
    transferred: u64,
    total: u64,
    last_emit: u64,
    app: tauri::AppHandle,
    transfer_id: String,
}

impl<R: Read> Read for ProgressReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        if n > 0 {
            self.transferred += n as u64;
            if self.transferred.saturating_sub(self.last_emit) >= 65536 {
                emit_progress(&self.app, &self.transfer_id, self.transferred, self.total, false);
                self.last_emit = self.transferred;
            }
        }
        Ok(n)
    }
}

#[tauri::command]
pub fn ftp_upload(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
    resume: bool,
) -> Result<(), AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    let total = std::fs::metadata(&local_path)
        .map(|m| m.len())
        .unwrap_or(0);

    macro_rules! do_upload {
        ($ftp:expr) => {{
            let skip_bytes: u64 = if resume && total > 0 {
                $ftp.size(&remote_path).ok().map(|s| s as u64).filter(|&s| s > 0 && s < total).unwrap_or(0)
            } else { 0 };
            let mut local_file = std::fs::File::open(&local_path)
                .map_err(|e| AppError::Internal(format!("Failed to open local file: {}", e)))?;
            if skip_bytes > 0 {
                local_file.seek(std::io::SeekFrom::Start(skip_bytes))
                    .map_err(|e| AppError::Internal(format!("Seek error: {}", e)))?;
            }
            let mut reader = ProgressReader {
                inner: local_file, transferred: skip_bytes, total,
                last_emit: skip_bytes, app: app.clone(), transfer_id: transfer_id.clone(),
            };
            if skip_bytes > 0 {
                $ftp.append_file(&remote_path, &mut reader)
                    .map_err(|e| AppError::Network(format!("Failed to resume upload: {}", e)))?;
            } else {
                $ftp.put_file(&remote_path, &mut reader)
                    .map_err(|e| AppError::Network(format!("Failed to upload file: {}", e)))?;
            }
            $ftp.quit().ok();
            emit_progress(&app, &transfer_id, total, total, true);
        }};
    }

    if rc.use_ftps {
        let mut ftp = connect_ftps(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        do_upload!(ftp);
    } else {
        let mut ftp = connect_ftp(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        do_upload!(ftp);
    }
    Ok(())
}

#[tauri::command]
pub fn ftp_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
    resume: bool,
) -> Result<(), AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    macro_rules! do_download {
        ($ftp:expr) => {{
            let total = $ftp.size(&remote_path).ok().map(|s| s as u64).unwrap_or(0);
            let skip_bytes: u64 = if resume && total > 0 {
                std::fs::metadata(&local_path).map(|m| m.len()).ok()
                    .filter(|&s| s > 0 && s < total).unwrap_or(0)
            } else { 0 };
            if skip_bytes > 0 {
                $ftp.resume_transfer(skip_bytes as usize)
                    .map_err(|e| AppError::Network(format!("Failed to set resume offset: {}", e)))?;
            }
            let mut stream = $ftp.retr_as_stream(&remote_path)
                .map_err(|e| AppError::Network(format!("Failed to open remote file: {}", e)))?;
            let mut local_file = if skip_bytes > 0 {
                std::fs::OpenOptions::new().append(true).open(&local_path)
                    .map_err(|e| AppError::Internal(format!("Failed to open local file: {}", e)))?
            } else {
                std::fs::File::create(&local_path)
                    .map_err(|e| AppError::Internal(format!("Failed to create local file: {}", e)))?
            };
            let mut transferred = skip_bytes;
            let mut last_emit = skip_bytes;
            let mut buffer = [0u8; 65536];
            loop {
                let n = stream.read(&mut buffer).map_err(|e| AppError::Network(format!("Read error: {}", e)))?;
                if n == 0 { break; }
                local_file.write_all(&buffer[..n]).map_err(|e| AppError::Internal(format!("Write error: {}", e)))?;
                transferred += n as u64;
                if transferred.saturating_sub(last_emit) >= 65536 {
                    emit_progress(&app, &transfer_id, transferred, total, false);
                    last_emit = transferred;
                }
            }
            $ftp.finalize_retr_stream(stream)
                .map_err(|e| AppError::Network(format!("Failed to finalize transfer: {}", e)))?;
            $ftp.quit().ok();
            emit_progress(&app, &transfer_id, total, total, true);
        }};
    }

    if rc.use_ftps {
        let mut ftp = connect_ftps(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        do_download!(ftp);
    } else {
        let mut ftp = connect_ftp(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        do_download!(ftp);
    }
    Ok(())
}

#[tauri::command]
pub fn ftp_delete(
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    macro_rules! do_delete {
        ($ftp:expr) => {{
            if is_dir {
                $ftp.rmdir(&path).map_err(|e| AppError::Network(format!("Failed to remove directory: {}", e)))?;
            } else {
                $ftp.rm(&path).map_err(|e| AppError::Network(format!("Failed to remove file: {}", e)))?;
            }
            $ftp.quit().ok();
        }};
    }
    if rc.use_ftps {
        let mut ftp = connect_ftps(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        do_delete!(ftp);
    } else {
        let mut ftp = connect_ftp(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        do_delete!(ftp);
    }
    Ok(())
}

#[tauri::command]
pub fn ftp_rename(
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    macro_rules! do_rename {
        ($ftp:expr) => {{
            $ftp.rename(&old_path, &new_path).map_err(|e| AppError::Network(format!("Failed to rename: {}", e)))?;
            $ftp.quit().ok();
        }};
    }
    if rc.use_ftps {
        let mut ftp = connect_ftps(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        do_rename!(ftp);
    } else {
        let mut ftp = connect_ftp(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        do_rename!(ftp);
    }
    Ok(())
}

#[tauri::command]
pub fn ftp_mkdir(
    state: tauri::State<'_, crate::state::AppState>,
    connection_id: String,
    path: String,
) -> Result<(), AppError> {
    let rc = resolve_conn_internal(&state, &connection_id)?;
    macro_rules! do_mkdir {
        ($ftp:expr) => {{
            $ftp.mkdir(&path).map_err(|e| AppError::Network(format!("Failed to create dir: {}", e)))?;
            $ftp.quit().ok();
        }};
    }
    if rc.use_ftps {
        let mut ftp = connect_ftps(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        do_mkdir!(ftp);
    } else {
        let mut ftp = connect_ftp(&rc.host, rc.port, &rc.username, rc.password.as_deref())?;
        do_mkdir!(ftp);
    }
    Ok(())
}
