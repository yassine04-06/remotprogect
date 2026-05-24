use serde::Serialize;
use std::process::Command;
use ts_rs::TS;

#[derive(Debug, Serialize, Clone, TS)]
pub struct ToolResult {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
    pub code: Option<i32>,
}

/// Validate that a string is a safe network target (hostname / IPv4 / IPv6).
/// Rejects any byte that could be interpreted by a shell or by argv parsers.
/// This is defence-in-depth: we use `Command::args` (not a shell), so injection
/// is not directly possible — but stripping metacharacters defeats any future
/// regression where someone replaces args with a shell invocation.
fn is_safe_target(s: &str) -> bool {
    if s.is_empty() || s.len() > 253 {
        return false;
    }
    // Hostnames: letters, digits, dots, hyphens.
    // IPv6: letters, digits, colons, dots, %, brackets.
    // We allow the union and reject anything else.
    s.bytes().all(|b| {
        b.is_ascii_alphanumeric()
            || b == b'.'
            || b == b'-'
            || b == b':'
            || b == b'%'
            || b == b'['
            || b == b']'
    })
}

/// Run a predefined diagnostic tool against a target host.
/// SECURITY (NXS-002): replaces the previous `run_external_tool(command, args)`
/// which was an arbitrary-command-execution oracle exposed to the webview.
/// Only the tool IDs listed below are permitted; the target string is validated
/// against a strict charset to prevent any shell metacharacter from reaching
/// the spawned process.
#[tauri::command]
pub async fn run_predefined_tool(tool_id: String, target: String) -> Result<ToolResult, String> {
    if !is_safe_target(&target) {
        tracing::warn!("run_predefined_tool rejected unsafe target: {:?}", target);
        return Err("Target contains invalid characters. Use a hostname or IP only.".to_string());
    }

    // Whitelist of allowed tools. The mapping is per-OS so we use the right binary.
    #[cfg(target_os = "windows")]
    let (program, args): (&str, Vec<&str>) = match tool_id.as_str() {
        "ping" => ("ping", vec!["-n", "4", target.as_str()]),
        "traceroute" => ("tracert", vec!["-d", "-h", "30", target.as_str()]),
        "dns_lookup" => ("nslookup", vec![target.as_str()]),
        _ => {
            tracing::warn!(
                "run_predefined_tool rejected unknown tool_id: {:?}",
                tool_id
            );
            return Err(format!("Tool '{}' is not in the whitelist.", tool_id));
        }
    };

    #[cfg(not(target_os = "windows"))]
    let (program, args): (&str, Vec<&str>) = match tool_id.as_str() {
        "ping" => ("ping", vec!["-c", "4", target.as_str()]),
        "traceroute" => ("traceroute", vec!["-n", "-m", "30", target.as_str()]),
        "dns_lookup" => ("nslookup", vec![target.as_str()]),
        _ => {
            tracing::warn!(
                "run_predefined_tool rejected unknown tool_id: {:?}",
                tool_id
            );
            return Err(format!("Tool '{}' is not in the whitelist.", tool_id));
        }
    };

    tracing::info!(
        "run_predefined_tool: {} {} -> target={}",
        tool_id,
        program,
        target
    );

    let output = Command::new(program)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute '{}': {}", program, e))?;

    Ok(ToolResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        success: output.status.success(),
        code: output.status.code(),
    })
}
