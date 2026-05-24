/// Miscellaneous commands: favorites, recently-used, group assignment, audit log.
use crate::state::AppState;
use crate::database;

#[tauri::command]
pub fn toggle_favorite(state: tauri::State<AppState>, id: String) -> Result<bool, crate::error::AppError> {
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::toggle_favorite(&conn, &id)?)
}

#[tauri::command]
pub fn update_last_connected(state: tauri::State<AppState>, id: String) -> Result<(), crate::error::AppError> {
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::update_last_connected(&conn, &id)?)
}

#[tauri::command]
pub fn update_connection_group(
    state: tauri::State<AppState>,
    connection_id: String,
    group_id: Option<String>,
) -> Result<(), crate::error::AppError> {
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::update_connection_group(&conn, &connection_id, group_id.as_deref())?)
}

#[tauri::command]
pub fn audit_log_list(
    state: tauri::State<AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<database::AuditEntry>, crate::error::AppError> {
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::audit_log_list(&conn, limit.unwrap_or(200), offset.unwrap_or(0))?)
}

/// CRIT-A3: walk the entire audit log hash-chain and report tampered / legacy rows.
#[tauri::command]
pub fn audit_log_verify(
    state: tauri::State<AppState>,
) -> Result<database::AuditVerifyResult, crate::error::AppError> {
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::audit_log_verify(&conn)?)
}
