use crate::state::AppState;
use crate::database::{self, ExportData};
use crate::{db_err, vault_err, net_err, touch_activity};

#[tauri::command]
pub fn export_connections(state: tauri::State<AppState>) -> Result<ExportData, crate::error::AppError> {
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::export_all(&conn)?)
}

#[tauri::command]
pub fn import_connections(state: tauri::State<AppState>, data: ExportData) -> Result<(), crate::error::AppError> {
    let conn = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::import_all(&conn, data)?)
}

#[tauri::command]
pub fn vault_export_file(state: tauri::State<AppState>, path: String) -> Result<(), crate::error::AppError> {
    touch_activity(&state);
    let conn = state.db.get().map_err(|e| db_err("DB pool", e))?;
    let data = database::export_all(&conn)?;
    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| vault_err("Serialisation", e))?;
    std::fs::write(&path, json.as_bytes())
        .map_err(|e| net_err("Write export file", e))?;
    Ok(())
}

#[tauri::command]
pub fn vault_import_file(state: tauri::State<AppState>, path: String) -> Result<(), crate::error::AppError> {
    touch_activity(&state);
    let bytes = std::fs::read(&path)
        .map_err(|e| net_err("Read import file", e))?;
    let data: ExportData = serde_json::from_slice(&bytes)
        .map_err(|e| vault_err("Invalid vault file format", e))?;
    let conn = state.db.get().map_err(|e| db_err("DB pool", e))?;
    Ok(database::import_all(&conn, data)?)
}
