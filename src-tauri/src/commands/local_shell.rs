use crate::local_shell;
use crate::state::AppState;

#[tauri::command]
pub fn shell_spawn(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    session_id: String,
) -> Result<(), crate::error::AppError> {
    if state.shell_sessions.contains_key(&session_id) {
        return Ok(());
    }
    let session = local_shell::spawn_local_shell(&app, &session_id)?;
    state.shell_sessions.insert(session_id, session);
    Ok(())
}

#[tauri::command]
pub fn shell_send_input(
    state: tauri::State<AppState>,
    session_id: String,
    data: String,
) -> Result<(), crate::error::AppError> {
    let session = state
        .shell_sessions
        .get(&session_id)
        .ok_or("Local shell session not found")?;
    Ok(local_shell::shell_send_input(&session, &data)?)
}

#[tauri::command]
pub fn shell_disconnect(
    state: tauri::State<AppState>,
    session_id: String,
) -> Result<(), crate::error::AppError> {
    if let Some((_, session)) = state.shell_sessions.remove(&session_id) {
        local_shell::shell_disconnect(&session)?;
    }
    Ok(())
}

#[tauri::command]
pub fn shell_resize(
    state: tauri::State<AppState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), crate::error::AppError> {
    if let Some(session) = state.shell_sessions.get(&session_id) {
        local_shell::shell_resize(&session, rows, cols)?;
    }
    Ok(())
}
