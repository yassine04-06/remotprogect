use crate::database::{self, ConnectionSummary, CreateConnectionRequest, UpdateConnectionRequest};
use crate::state::AppState;
use crate::{encrypt_connection_create_fields, encrypt_connection_update_fields};

/// HIGH-A5: check the per-command governor bucket.
/// Returns `Err(RateLimit)` when the caller has exceeded 100 req/s for this
/// command name.  The check is non-blocking (jitter-free direct check).
macro_rules! rate_check {
    ($state:expr, $cmd:literal) => {
        $state.command_limiter.check_key(&$cmd).map_err(|_| {
            crate::error::AppError::RateLimit(
                concat!("Too many requests for '", $cmd, "' — slow down").to_string(),
            )
        })?
    };
}

#[tauri::command]
pub fn create_connection(
    state: tauri::State<AppState>,
    mut request: CreateConnectionRequest,
) -> Result<database::ServerConnection, crate::error::AppError> {
    encrypt_connection_create_fields(&state, &mut request)?;
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    let result = database::create_connection(&conn, request)?;
    let _ = database::audit_log_insert(
        &conn,
        "create",
        "connection",
        &result.id,
        &result.name,
        "success",
        "",
    );
    Ok(result)
}

#[tauri::command]
pub fn update_connection(
    state: tauri::State<AppState>,
    mut request: UpdateConnectionRequest,
) -> Result<database::ServerConnection, crate::error::AppError> {
    encrypt_connection_update_fields(&state, &mut request)?;
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::update_connection(&conn, request)?)
}

#[tauri::command]
pub fn delete_connection(
    state: tauri::State<AppState>,
    id: String,
) -> Result<(), crate::error::AppError> {
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    let _ = database::audit_log_insert(&conn, "delete", "connection", &id, &id, "success", "");
    Ok(database::delete_connection(&conn, &id)?)
}

#[tauri::command]
pub fn get_connections(
    state: tauri::State<AppState>,
) -> Result<Vec<database::ServerConnection>, crate::error::AppError> {
    // HIGH-A5: a frontend effect with wrong deps can hammer this command
    // thousands of times per second and saturate the DB pool.
    rate_check!(state, "get_connections");
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::get_connections(&conn)?)
}

#[tauri::command]
pub fn get_connections_summary(
    state: tauri::State<AppState>,
) -> Result<Vec<ConnectionSummary>, crate::error::AppError> {
    rate_check!(state, "get_connections_summary");
    let conn = state
        .db
        .get()
        .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;
    Ok(database::get_connections_summary(&conn)?)
}

#[tauri::command]
pub async fn check_for_update(
    app: tauri::AppHandle,
) -> Result<serde_json::Value, crate::error::AppError> {
    use tauri_plugin_updater::UpdaterExt;
    match app.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => Ok(serde_json::json!({
                "available": true,
                "version": update.version,
                "notes": update.body,
                "date": update.date.map(|d| d.to_string()),
            })),
            Ok(None) => Ok(serde_json::json!({ "available": false })),
            Err(e) => Err(crate::error::AppError::Network(format!(
                "Update check failed: {}",
                e
            ))),
        },
        Err(e) => Err(crate::error::AppError::Internal(format!(
            "Updater not configured: {}",
            e
        ))),
    }
}

/// Download and install the pending update, then restart the app.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), crate::error::AppError> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater()
        .map_err(|e| crate::error::AppError::Internal(format!("Updater not configured: {}", e)))?;
    let update = updater
        .check()
        .await
        .map_err(|e| crate::error::AppError::Network(format!("Update check failed: {}", e)))?
        .ok_or_else(|| crate::error::AppError::Internal("No update available".to_string()))?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| crate::error::AppError::Network(format!("Install failed: {}", e)))?;

    app.restart();
}
