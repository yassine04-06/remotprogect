use crate::state::AppState;
use std::sync::Arc;
use serde::Serialize;
use std::path::Path;

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
    state.recording_sessions.insert(session_id, Arc::new(std::sync::Mutex::new(rec)));
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
    std::fs::write(&path, &cast)
        .map_err(|e| format!("Failed to save recording: {}", e))?;

    tracing::info!("Recording saved: {:?} ({} events)", path, rec.events.len());
    Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
pub struct RecordingInfo {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub fn ssh_recording_list(state: tauri::State<AppState>) -> Result<Vec<RecordingInfo>, crate::error::AppError> {
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
                list.push(RecordingInfo {
                    path: entry.path().to_string_lossy().to_string(),
                    filename,
                    size_bytes: size,
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
    let path = joined
        .canonicalize()
        .map_err(|_| crate::error::AppError::NotFound(format!("Recording not found: {}", filename)))?;
    let canon_rec_dir = rec_dir
        .canonicalize()
        .map_err(|_| crate::error::AppError::Internal("recordings dir missing".into()))?;
    if !path.starts_with(&canon_rec_dir) {
        return Err(crate::error::AppError::Validation("Invalid filename".into()));
    }

    std::fs::read_to_string(&path)
        .map_err(|e| crate::error::AppError::Internal(format!("Read failed: {}", e)))
}
