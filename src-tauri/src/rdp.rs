use serde::Serialize;
use std::process::Command;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct RdpAvailability {
    pub available: bool,
    pub binary: String,
    pub message: String,
}

/// Check which RDP client is available on this platform.
pub fn check_rdp_available() -> RdpAvailability {
    #[cfg(target_os = "windows")]
    {
        // mstsc.exe is always available on Windows
        RdpAvailability {
            available: true,
            binary: "mstsc.exe".to_string(),
            message: "Windows Remote Desktop (mstsc) is available.".to_string(),
        }
    }

    #[cfg(target_os = "linux")]
    {
        if which_exists("xfreerdp3") {
            RdpAvailability {
                available: true,
                binary: "xfreerdp3".to_string(),
                message: "FreeRDP 3 is available.".to_string(),
            }
        } else if which_exists("xfreerdp") {
            RdpAvailability {
                available: true,
                binary: "xfreerdp".to_string(),
                message: "FreeRDP is available.".to_string(),
            }
        } else {
            RdpAvailability {
                available: false,
                binary: String::new(),
                message: "FreeRDP is not installed. Install it with: sudo apt install freerdp2-x11".to_string(),
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if which_exists("xfreerdp") {
            RdpAvailability {
                available: true,
                binary: "xfreerdp".to_string(),
                message: "FreeRDP is available.".to_string(),
            }
        } else {
            RdpAvailability {
                available: false,
                binary: String::new(),
                message: "FreeRDP is not installed. Install it with: brew install freerdp".to_string(),
            }
        }
    }
}

#[allow(dead_code)]
fn which_exists(cmd: &str) -> bool {
    Command::new("which")
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Launch an RDP connection.
/// Returns a session ID on success.
pub fn launch_rdp(
    host: &str,
    port: i32,
    username: &str,
    password: &str,
    width: i32,
    height: i32,
    fullscreen: bool,
    domain: &str,
    color_depth: i32,
    audio: bool,
    printers: bool,
    drives: bool,
) -> Result<(String, std::process::Child), String> {
    let session_id = Uuid::new_v4().to_string();
    let availability = check_rdp_available();

    if !availability.available {
        return Err(availability.message);
    }

    let child = launch_rdp_platform(
        &availability.binary,
        host,
        port,
        username,
        password,
        width,
        height,
        fullscreen,
        domain,
        color_depth,
        audio,
        printers,
        drives,
    )?;

    Ok((session_id, child))
}

fn launch_rdp_platform(
    _binary: &str,
    host: &str,
    port: i32,
    username: &str,
    _password: &str,
    width: i32,
    height: i32,
    fullscreen: bool,
    domain: &str,
    color_depth: i32,
    audio: bool,
    printers: bool,
    drives: bool,
) -> Result<std::process::Child, String> {
    #[cfg(target_os = "windows")]
    {
        // For Windows, use mstsc with a temporary .rdp file
        // audiomode:i:0 (redirect to client), 1 (remote), 2 (none)
        let rdp_content = format!(
            "full address:s:{}:{}\r\n\
             username:s:{}\r\n\
             domain:s:{}\r\n\
             screen mode id:i:{}\r\n\
             desktopwidth:i:{}\r\n\
             desktopheight:i:{}\r\n\
             session bpp:i:{}\r\n\
             redirectdrives:i:{}\r\n\
             redirectprinters:i:{}\r\n\
             audiomode:i:{}\r\n\
             authenticationlevel:i:2\r\n\
             prompt for credentials:i:0\r\n",
            host,
            port,
            username,
            domain,
            if fullscreen { 2 } else { 1 },
            width,
            height,
            color_depth,
            if drives { 1 } else { 0 },
            if printers { 1 } else { 0 },
            if audio { 0 } else { 2 },
        );

        let temp_dir = std::env::temp_dir();
        let rdp_file = temp_dir.join(format!("nexus_{}.rdp", uuid::Uuid::new_v4()));
        std::fs::write(&rdp_file, rdp_content)
            .map_err(|e| format!("Failed to create .rdp file: {}", e))?;

        let target = format!("{}:{}", host, port);
        if !_password.is_empty() {
            let user_pass = if domain.is_empty() {
                username.to_string()
            } else {
                format!("{}\\{}", domain, username)
            };
            
            // Inject credentials so mstsc uses them automatically
            let _ = Command::new("cmdkey")
                .arg(format!("/generic:TERMSRV/{}", target))
                .arg(format!("/user:{}", user_pass))
                .arg(format!("/pass:{}", _password))
                .output();
        }

        let child = Command::new("mstsc.exe")
            .arg(rdp_file.to_str().unwrap())
            .spawn()
            .map_err(|e| format!("Failed to launch mstsc: {}", e));

        // Clean up cmdkey credentials after a short delay (so mstsc has time to read them)
        if !_password.is_empty() {
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(10));
                let _ = Command::new("cmdkey")
                    .arg(format!("/delete:TERMSRV/{}", target))
                    .output();
            });
        }
        
        child
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new(_binary);
        cmd.arg(format!("/v:{}:{}", host, port))
            .arg(format!("/u:{}", username))
            .arg(format!("/size:{}x{}", width, height))
            .arg(format!("/bpp:{}", color_depth));

        if !domain.is_empty() {
            cmd.arg(format!("/d:{}", domain));
        }

        if audio { cmd.arg("/audio-mode:0"); } else { cmd.arg("/audio-mode:1"); }
        if drives { cmd.arg("+drive"); }
        if printers { cmd.arg("+printer"); }

        if fullscreen {
            cmd.arg("/f");
        }

        if !_password.is_empty() {
            cmd.arg(format!("/p:{}", _password));
        }

        cmd.spawn()
            .map_err(|e| format!("Failed to launch {}: {}", _binary, e))
    }
}
