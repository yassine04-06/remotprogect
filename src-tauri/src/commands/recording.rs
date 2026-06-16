use crate::state::AppState;
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;

#[tauri::command]
pub fn ssh_recording_start(
    state: tauri::State<AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), crate::error::AppError> {
    let rec = crate::state::SessionRecording {
        start_time: std::time::Instant::now(),
        events: Vec::new(),
        cols,
        rows,
    };
    state
        .recording_sessions
        .insert(session_id, Arc::new(std::sync::Mutex::new(rec)));
    Ok(())
}

#[tauri::command]
pub fn ssh_recording_stop(
    state: tauri::State<AppState>,
    session_id: String,
) -> Result<String, crate::error::AppError> {
    let rec_arc = state
        .recording_sessions
        .remove(&session_id)
        .map(|(_, v)| v)
        .ok_or("No active recording for this session")?;

    let rec = rec_arc.lock().map_err(|_| "Recording lock poisoned")?;

    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let header = serde_json::json!({
        "version": 2,
        "width": rec.cols,
        "height": rec.rows,
        "timestamp": now_unix,
        "title": format!("NexoRC session {}", session_id),
    });

    let mut cast = header.to_string();
    cast.push('\n');
    // M-6: serialise output ('o'), input ('i') and resize ('r') events.
    for (elapsed, kind, data) in &rec.events {
        let kind_str = kind.to_string();
        let line = serde_json::json!([elapsed, kind_str, data]);
        cast.push_str(&line.to_string());
        cast.push('\n');
    }

    // Encrypt with the vault key if the vault is unlocked.  When locked (vault
    // auto-locked mid-session), fall back to plaintext with a warning — the
    // user is explicitly notified via the RecordingInfo.encrypted flag on list.
    let content = {
        let key_guard = state
            .encryption_key
            .read()
            .map_err(|_| crate::error::AppError::Internal("Encryption key lock poisoned".into()))?;
        if let Some(mlocked) = key_guard.as_ref() {
            crate::encryption::encrypt_v2(&cast, mlocked.expose()).map_err(|e| {
                crate::error::AppError::Internal(format!("Encrypt recording: {}", e))
            })?
        } else {
            tracing::warn!("ssh_recording_stop: vault locked — saving recording unencrypted");
            cast
        }
    };

    let rec_dir = std::path::Path::new(&state.data_dir).join("recordings");
    let _ = std::fs::create_dir_all(&rec_dir);
    // MED-A6: full session_id + unix timestamp + full UUID v4 as suffix.
    // Using only 8 hex chars of the UUID gives 16^8 ≈ 4 billion possibilities
    // which sounds large but can still collide under rapid automated testing or
    // when many sessions end in the same second.  The full UUID (32 hex chars)
    // makes collisions cryptographically impossible.
    let suffix = uuid::Uuid::new_v4().to_string();
    // Remove hyphens so the filename stays clean on all platforms.
    let suffix_hex = suffix.replace('-', "");
    let filename = format!("{}_{}_{}.cast", session_id, now_unix, suffix_hex);
    let path = rec_dir.join(&filename);
    std::fs::write(&path, &content).map_err(|e| format!("Failed to save recording: {}", e))?;

    // Restrict file permissions on Unix so only the owner can read the recording.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(&path, perms);
        }
    }

    tracing::info!("Recording saved: {:?} ({} events)", path, rec.events.len());
    Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
pub struct RecordingInfo {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    /// True when the file was encrypted with the vault key (AES-256-GCM v2 prefix).
    /// False for recordings saved while the vault was locked, or legacy plaintext files.
    pub encrypted: bool,
}

#[tauri::command]
pub fn ssh_recording_list(
    state: tauri::State<AppState>,
) -> Result<Vec<RecordingInfo>, crate::error::AppError> {
    let rec_dir = std::path::Path::new(&state.data_dir).join("recordings");
    if !rec_dir.exists() {
        return Ok(vec![]);
    }
    let mut list = vec![];
    if let Ok(entries) = std::fs::read_dir(&rec_dir) {
        for entry in entries.flatten() {
            if entry.path().extension().and_then(|e| e.to_str()) == Some("cast") {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                let filename = entry.file_name().to_string_lossy().to_string();
                // Peek at the first 3 bytes to detect the "v2:" encryption prefix.
                let encrypted = std::fs::read(entry.path())
                    .ok()
                    .and_then(|b| String::from_utf8(b.get(..3)?.to_vec()).ok())
                    .map(|s| s == "v2:")
                    .unwrap_or(false);
                list.push(RecordingInfo {
                    path: entry.path().to_string_lossy().to_string(),
                    filename,
                    size_bytes: size,
                    encrypted,
                });
            }
        }
    }
    list.sort_by(|a, b| b.filename.cmp(&a.filename));
    Ok(list)
}

#[tauri::command]
pub fn ssh_recording_read(
    state: tauri::State<AppState>,
    filename: String,
) -> Result<String, crate::error::AppError> {
    let rec_dir = Path::new(&state.data_dir).join("recordings");
    let joined = rec_dir.join(&filename);

    // Path traversal guard: canonicalize and ensure it stays within recordings dir
    let path = joined.canonicalize().map_err(|_| {
        crate::error::AppError::NotFound(format!("Recording not found: {}", filename))
    })?;
    let canon_rec_dir = rec_dir
        .canonicalize()
        .map_err(|_| crate::error::AppError::Internal("recordings dir missing".into()))?;
    if !path.starts_with(&canon_rec_dir) {
        return Err(crate::error::AppError::Validation(
            "Invalid filename".into(),
        ));
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::Internal(format!("Read failed: {}", e)))?;

    // Decrypt if the file carries the AES-256-GCM v2 envelope; return plaintext
    // as-is for legacy unencrypted recordings (backwards compatibility).
    if content.trim_start().starts_with("v2:") {
        let key_guard = state
            .encryption_key
            .read()
            .map_err(|_| crate::error::AppError::Internal("Encryption key lock poisoned".into()))?;
        let mlocked = key_guard.as_ref().ok_or_else(|| {
            crate::error::AppError::Internal(
                "Vault locked — unlock the vault to read this recording".into(),
            )
        })?;
        crate::encryption::decrypt_auto(content.trim(), mlocked.expose())
            .map_err(|e| crate::error::AppError::Internal(format!("Decrypt recording: {}", e)))
    } else {
        Ok(content)
    }
}
