use crate::database::{self, CreateSavedCommandRequest, UpdateSavedCommandRequest};
use crate::state::AppState;

#[tauri::command]
pub fn create_saved_command(
    state: tauri::State<AppState>,
    request: CreateSavedCommandRequest,
) -> Result<database::SavedCommand, crate::error::AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::create_saved_command(&conn, request)?)
}

#[tauri::command]
pub fn get_saved_commands(
    state: tauri::State<AppState>,
) -> Result<Vec<database::SavedCommand>, crate::error::AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::get_saved_commands(&conn)?)
}

#[tauri::command]
pub fn update_saved_command(
    state: tauri::State<AppState>,
    request: UpdateSavedCommandRequest,
) -> Result<database::SavedCommand, crate::error::AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::update_saved_command(&conn, request)?)
}

#[tauri::command]
pub fn delete_saved_command(
    state: tauri::State<AppState>,
    id: String,
) -> Result<(), crate::error::AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::delete_saved_command(&conn, &id)?)
}
