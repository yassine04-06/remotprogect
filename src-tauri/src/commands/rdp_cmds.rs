use crate::commands::credentials::resolve_credentials_internal;
use crate::database;
use crate::lock_err;
use crate::rdp;
use crate::state::AppState;

#[tauri::command]
pub fn rdp_check_available() -> rdp::RdpAvailability {
    rdp::check_rdp_available()
}

/// CRIT-A4: `connection_id` replaces explicit `host`, `port`, `username`, `password`, `domain`.
/// Credentials are resolved server-side so plaintext passwords never cross the IPC boundary.
#[cfg(target_os = "windows")]
#[tauri::command]
pub fn rdp_connect(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    session_id: String,
    connection_id: String,
    width: i32,
    height: i32,
    fullscreen: bool,
    color_depth: i32,
    audio: bool,
    printers: bool,
    drives: bool,
) -> Result<String, crate::error::AppError> {
    use tauri::Manager;

    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    let all_conns = database::get_connections(&conn)?;
    let connection = all_conns
        .into_iter()
        .find(|c| c.id == connection_id)
        .ok_or("Connection not found")?;

    let host = connection.host.clone();
    let port = connection.port;
    let nla = connection.rdp_nla;

    let key_guard = state.encryption_key.read().map_err(|e| lock_err(e))?;
    let master_key = key_guard.as_ref().ok_or("Vault locked")?;
    let creds = resolve_credentials_internal(&conn, master_key, &connection_id)?;
    drop(key_guard);
    drop(conn);

    let username = creds.username;
    let password = creds.password_decrypted.unwrap_or_default();
    let domain = creds.domain.unwrap_or_default();

    let full_username = if domain.is_empty() {
        username.clone()
    } else {
        format!("{}\\{}", domain, username)
    };

    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    let parent_hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as i64;

    match rdp::launch_rdp_embedded(
        &state.data_dir,
        &host,
        port,
        &full_username,
        &password,
        parent_hwnd,
        -32000,
        -32000,
        width,
        height,
    ) {
        Ok(mut session) => {
            if let Some(stderr) = session.child.stderr.take() {
                let app2 = app.clone();
                let sid2 = session_id.clone();
                std::thread::spawn(move || {
                    use std::io::BufRead;
                    let reader = std::io::BufReader::new(stderr);
                    for line in reader.lines().flatten() {
                        let _ = tauri::Emitter::emit(&app2, &format!("rdp-stderr-{}", sid2), &line);
                    }
                });
            }
            state.rdp_sessions.insert(session_id.clone(), session);
            Ok(session_id)
        }
        Err(e) => {
            tracing::warn!(
                "Failed to launch embedded RDP: {}. Falling back to mstsc...",
                e
            );
            let child = rdp::launch_rdp_mstsc(
                &host,
                port,
                &username,
                &password,
                width,
                height,
                fullscreen,
                &domain,
                color_depth,
                audio,
                printers,
                drives,
                nla,
            )?;
            state.rdp_processes.insert(session_id.clone(), child);
            Ok(session_id)
        }
    }
}

/// CRIT-A4: non-Windows variant — same credential isolation.
#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn rdp_connect(
    state: tauri::State<AppState>,
    session_id: String,
    connection_id: String,
    width: i32,
    height: i32,
    fullscreen: bool,
    color_depth: i32,
    audio: bool,
    printers: bool,
    drives: bool,
) -> Result<String, crate::error::AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    let all_conns = database::get_connections(&conn)?;
    let connection = all_conns
        .into_iter()
        .find(|c| c.id == connection_id)
        .ok_or("Connection not found")?;

    let host = connection.host.clone();
    let port = connection.port;
    let nla = connection.rdp_nla;

    let key_guard = state.encryption_key.read().map_err(|e| lock_err(e))?;
    let master_key = key_guard.as_ref().ok_or("Vault locked")?;
    let creds = resolve_credentials_internal(&conn, master_key, &connection_id)?;
    drop(key_guard);
    drop(conn);

    let username = creds.username;
    let password = creds.password_decrypted.unwrap_or_default();
    let domain = creds.domain.unwrap_or_default();

    let child = rdp::launch_rdp_mstsc(
        &host,
        port,
        &username,
        &password,
        width,
        height,
        fullscreen,
        &domain,
        color_depth,
        audio,
        printers,
        drives,
        nla,
    )?;
    state.rdp_processes.insert(session_id.clone(), child);
    Ok(session_id)
}

#[tauri::command]
pub fn rdp_disconnect(
    state: tauri::State<AppState>,
    session_id: String,
) -> Result<(), crate::error::AppError> {
    if let Some((_, session)) = state.rdp_sessions.remove(&session_id) {
        rdp::close_embedded(&session);
    }
    if let Some((_, mut child)) = state.rdp_processes.remove(&session_id) {
        let _ = child.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn rdp_embed_window(
    state: tauri::State<AppState>,
    session_id: String,
) -> Result<bool, crate::error::AppError> {
    Ok(state.rdp_sessions.contains_key(&session_id))
}

#[tauri::command]
pub fn rdp_resize_embedded(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    session_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    // devicePixelRatio forwarded from JavaScript.  JS has the updated value the
    // moment onScaleChanged fires; Rust's window.scale_factor() may lag by
    // several frames when the Tauri window crosses monitor boundaries.
    dpr: f64,
) -> Result<(), crate::error::AppError> {
    use tauri::Manager;
    if let Some(session) = state.rdp_sessions.get(&session_id) {
        if let Some(window) = app.get_webview_window("main") {
            let pos = window.inner_position().map_err(|e| e.to_string())?;

            // Use the DPR forwarded by JavaScript — it is already correct for the
            // current monitor.  We fall back to Rust's scale_factor() only if the
            // caller passes an unreasonable value (guard against JS bugs).
            let scale = if dpr > 0.5 && dpr < 8.0 {
                dpr
            } else {
                window.scale_factor().map_err(|e| e.to_string())?
            };

            let screen_x = (pos.x as f64 + x * scale).round() as i32;
            let screen_y = (pos.y as f64 + y * scale).round() as i32;
            let screen_w = (width * scale).round() as i32;
            let screen_h = (height * scale).round() as i32;

            rdp::resize_embedded(&session, screen_x, screen_y, screen_w, screen_h)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn rdp_set_visibility(
    state: tauri::State<AppState>,
    session_id: String,
    visible: bool,
) -> Result<(), crate::error::AppError> {
    if let Some(session) = state.rdp_sessions.get(&session_id) {
        if visible {
            rdp::show_embedded(&session)?;
        } else {
            rdp::hide_embedded(&session)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn rdp_focus(
    state: tauri::State<AppState>,
    session_id: String,
) -> Result<(), crate::error::AppError> {
    if let Some(session) = state.rdp_sessions.get(&session_id) {
        let _ = rdp::send_command(session.value(), "FOCUS");
    }
    Ok(())
}

#[tauri::command]
pub fn rdp_send_command(
    state: tauri::State<AppState>,
    session_id: String,
    command: String,
) -> Result<(), crate::error::AppError> {
    if let Some(session) = state.rdp_sessions.get(&session_id) {
        let _ = rdp::send_command(session.value(), &command);
    }
    Ok(())
}

#[tauri::command]
pub fn rdp_is_window_alive(state: tauri::State<AppState>, session_id: String) -> bool {
    if let Some(mut session) = state.rdp_sessions.get_mut(&session_id) {
        rdp::is_embedded_alive(&mut session)
    } else {
        false
    }
}
