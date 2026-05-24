use crate::known_hosts;
use crate::state::AppState;
use serde::Serialize;

#[derive(Serialize)]
pub struct ProbedKey {
    pub key_type: String,
    pub raw_key_b64: String,
    pub verify: known_hosts::VerifyResult,
}

#[tauri::command]
pub fn ssh_probe_host_key(
    state: tauri::State<AppState>,
    host: String,
    port: i32,
) -> Result<ProbedKey, crate::error::AppError> {
    let probed = known_hosts::probe_host_key(&host, port)?;

    let verify = known_hosts::verify(
        &state.data_dir,
        &host,
        port,
        &probed.key_type,
        &probed.raw_key,
    );
    let raw_key_b64 =
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &probed.raw_key);
    Ok(ProbedKey {
        key_type: probed.key_type,
        raw_key_b64,
        verify,
    })
}

#[tauri::command]
pub fn ssh_trust_host_key(
    state: tauri::State<AppState>,
    host: String,
    port: i32,
    key_type: String,
    raw_key_b64: String,
) -> Result<(), crate::error::AppError> {
    let raw_key = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &raw_key_b64)
        .map_err(|e| format!("Invalid raw_key_b64: {}", e))?;
    known_hosts::trust(&state.data_dir, &host, port, &key_type, &raw_key)?;
    Ok(())
}

#[tauri::command]
pub fn ssh_forget_host_key(
    state: tauri::State<AppState>,
    host: String,
    port: i32,
) -> Result<(), crate::error::AppError> {
    known_hosts::forget(&state.data_dir, &host, port)?;
    Ok(())
}
