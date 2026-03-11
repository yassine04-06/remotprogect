use std::process::{Child, Command};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct VncAvailability {
    pub available: bool,
    pub binary_path: Option<String>,
    pub error: Option<String>,
}

#[cfg(target_os = "windows")]
pub fn check_vnc_availability() -> VncAvailability {
    // Check for common VNC viewers on Windows (TigerVNC, RealVNC, TightVNC)
    // For MVP, we look for vncviewer in PATH or common directories
    let paths_to_check = vec![
        "vncviewer.exe",
        "C:\\Program Files\\TigerVNC\\vncviewer.exe",
        "C:\\Program Files\\TightVNC\\tvnviewer.exe",
        "C:\\Program Files\\RealVNC\\VNC Viewer\\vncviewer.exe",
    ];

    for path in paths_to_check {
        if let Ok(_) = Command::new("cmd").args(&["/c", "where", path]).output() {
            return VncAvailability {
                available: true,
                binary_path: Some(path.to_string()),
                error: None,
            };
        }
        if std::path::Path::new(path).exists() {
            return VncAvailability {
                available: true,
                binary_path: Some(path.to_string()),
                error: None,
            };
        }
    }

    VncAvailability {
        available: false,
        binary_path: None,
        error: Some("No VNC client found. Please install TigerVNC, TightVNC, or RealVNC.".into()),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn check_vnc_availability() -> VncAvailability {
    if let Ok(_) = Command::new("which").arg("vncviewer").output() {
        return VncAvailability {
            available: true,
            binary_path: Some("vncviewer".into()),
            error: None,
        };
    }
    VncAvailability {
        available: false,
        binary_path: None,
        error: Some("vncviewer not found. Please install TigerVNC or your preferred VNC client.".into()),
    }
}

pub fn launch_vnc(
    binary: &str,
    host: &str,
    port: i32,
    _password: Option<&str>,
) -> Result<Child, String> {
    let addr = format!("{}:{}", host, port);
    let mut cmd = Command::new(binary);
    cmd.arg(&addr);
    cmd.spawn().map_err(|e| format!("Failed to launch VNC client: {}", e))
}

#[tauri::command]
pub async fn vnc_check_availability() -> Result<VncAvailability, String> {
    Ok(check_vnc_availability())
}

#[tauri::command]
pub async fn vnc_connect(
    session_id: String,
    host: String,
    port: i32,
    password: Option<String>,
    app_state: tauri::State<'_, crate::state::AppState>,
) -> Result<String, String> {
    let avail = check_vnc_availability();
    if !avail.available {
        return Err(avail.error.unwrap_or_else(|| "VNC not available".into()));
    }
    
    let binary = avail.binary_path.unwrap();
    let child = launch_vnc(&binary, &host, port, password.as_deref())?;
    
    // We can reuse the rdp_processes map since VNC is also an external GUI process
    app_state.rdp_processes.insert(session_id, child);
    
    Ok("VNC launched".into())
}
