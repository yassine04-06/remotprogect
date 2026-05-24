use crate::database;
use crate::state::AppState;

#[tauri::command]
pub fn create_group(
    state: tauri::State<AppState>,
    name: String,
    parent_id: Option<String>,
) -> Result<database::Group, crate::error::AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::create_group(&conn, &name, parent_id.as_deref())?)
}

#[tauri::command]
pub fn update_group(
    state: tauri::State<AppState>,
    id: String,
    name: String,
) -> Result<(), crate::error::AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::update_group(&conn, &id, &name)?)
}

#[tauri::command]
pub fn delete_group(
    state: tauri::State<AppState>,
    id: String,
) -> Result<(), crate::error::AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::delete_group(&conn, &id)?)
}

#[tauri::command]
pub fn get_groups(
    state: tauri::State<AppState>,
) -> Result<Vec<database::Group>, crate::error::AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::get_groups(&conn)?)
}
