use std::process::Command;
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct ToolResult {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
    pub code: Option<i32>,
}

#[tauri::command]
pub async fn run_external_tool(
    command: String,
    args: Vec<String>,
) -> Result<ToolResult, String> {
    let output = Command::new(&command)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute external tool '{}': {}", command, e))?;

    Ok(ToolResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        success: output.status.success(),
        code: output.status.code(),
    })
}
