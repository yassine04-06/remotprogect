use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
pub struct RdpAvailability {
    pub available: bool,
    pub binary: String,
    pub message: String,
}

/// An embedded RDP session managed by our C# helper.
pub struct EmbeddedRdpSession {
    pub child: Child,
    pub stdin: Arc<Mutex<Option<std::process::ChildStdin>>>,
    #[allow(dead_code)]
    pub form_hwnd: i64,
}

/// Check if RDP is available on this platform.
pub fn check_rdp_available() -> RdpAvailability {
    #[cfg(target_os = "windows")]
    {
        RdpAvailability {
            available: true,
            binary: "RdpEmbed".to_string(),
            message: "RDP ActiveX control available.".to_string(),
        }
    }

    #[cfg(target_os = "linux")]
    {
        if which_exists("xfreerdp3") {
            RdpAvailability { available: true, binary: "xfreerdp3".into(), message: "FreeRDP 3".into() }
        } else if which_exists("xfreerdp") {
            RdpAvailability { available: true, binary: "xfreerdp".into(), message: "FreeRDP".into() }
        } else {
            RdpAvailability { available: false, binary: String::new(), message: "FreeRDP not installed.".into() }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if which_exists("xfreerdp") {
            RdpAvailability { available: true, binary: "xfreerdp".into(), message: "FreeRDP".into() }
        } else {
            RdpAvailability { available: false, binary: String::new(), message: "FreeRDP not installed.".into() }
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

// ── C# Helper Compilation ───────────────────────────────

#[cfg(target_os = "windows")]
fn get_csc_path() -> Option<String> {
    let candidates = [
        r"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
        r"C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe",
    ];
    for c in &candidates {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    None
}

#[cfg(target_os = "windows")]
pub fn ensure_helper_compiled(data_dir: &str) -> Result<String, String> {
    let exe_path = format!(r"{}\RdpEmbed.exe", data_dir);

    if std::path::Path::new(&exe_path).exists() {
        return Ok(exe_path);
    }

    // Locate source file — bundled next to the binary or in the project
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Cannot get current exe path: {}", e))?;
    let exe_dir = current_exe.parent().ok_or("Cannot get exe directory")?;

    let possible_paths = vec![
        exe_dir.join("helpers").join("RdpEmbed.cs"),
        exe_dir.join("RdpEmbed.cs"),
        std::path::PathBuf::from(data_dir).join("RdpEmbed.cs"),
    ];

    // Dev mode: go up from target/debug/ to src-tauri/
    let dev_path = exe_dir
        .parent()  // target
        .and_then(|p| p.parent())  // src-tauri
        .map(|p| p.join("helpers").join("RdpEmbed.cs"));

    let mut source_path = None;
    for p in possible_paths.iter().chain(dev_path.iter()) {
        if p.exists() {
            source_path = Some(p.clone());
            break;
        }
    }

    let source_path = source_path.ok_or_else(|| {
        "RdpEmbed.cs source file not found. Ensure it exists in src-tauri/helpers/.".to_string()
    })?;

    let csc = get_csc_path().ok_or_else(|| {
        ".NET Framework csc.exe not found. Cannot compile RDP helper.".to_string()
    })?;

    let output = Command::new(&csc)
        .arg("/target:winexe")
        .arg("/optimize+")
        .arg(format!("/out:{}", exe_path))
        .arg("/reference:System.dll")
        .arg("/reference:System.Windows.Forms.dll")
        .arg("/reference:System.Drawing.dll")
        .arg(source_path.to_str().unwrap())
        .output()
        .map_err(|e| format!("Failed to run csc.exe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "Failed to compile RdpEmbed.cs:\nstdout: {}\nstderr: {}",
            stdout, stderr
        ));
    }

    Ok(exe_path)
}

// ── Embedded RDP Launch ─────────────────────────────────

#[cfg(target_os = "windows")]
pub fn launch_rdp_embedded(
    data_dir: &str,
    host: &str,
    port: i32,
    username: &str,
    password: &str,
    parent_hwnd: i64,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<EmbeddedRdpSession, String> {
    let exe_path = ensure_helper_compiled(data_dir)?;

    let mut child = Command::new(&exe_path)
        .arg(host)
        .arg(port.to_string())
        .arg(username)
        .arg(password)
        .arg(parent_hwnd.to_string())
        .arg(x.to_string())
        .arg(y.to_string())
        .arg(width.to_string())
        .arg(height.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch RdpEmbed.exe: {}", e))?;

    let stdin = child.stdin.take();
    let stdout = child
        .stdout
        .take()
        .ok_or("Failed to capture RdpEmbed stdout")?;

    // Read stdout lines until we receive HWND:<handle>, with a 20-second timeout.
    // This runs synchronously but on a background thread so we don't block the main thread.
    let reader = BufReader::new(stdout);
    let mut form_hwnd: i64 = 0;
    let mut got_hwnd = false;

    let deadline = Instant::now() + Duration::from_secs(20);

    for line_result in reader.lines() {
        if Instant::now() > deadline {
            let _ = child.kill();
            return Err("Timeout waiting for RdpEmbed.exe to report HWND (>20s).".to_string());
        }
        match line_result {
            Ok(l) => {
                let l = l.trim().to_string();
                if l.starts_with("HWND:") {
                    if let Ok(hwnd) = l[5..].parse::<i64>() {
                        form_hwnd = hwnd;
                        got_hwnd = true;
                        break;
                    }
                }
                // "READY" line — ignore and keep reading
                if l.starts_with("EVENT:") {
                    // If we get an event before HWND (e.g. fatal error), abort
                    let _ = child.kill();
                    return Err(format!("RdpEmbed.exe reported early event: {}", l));
                }
            }
            Err(_) => break,
        }
    }

    if !got_hwnd {
        let _ = child.kill();
        return Err("RdpEmbed.exe exited before reporting its window handle.".to_string());
    }

    Ok(EmbeddedRdpSession {
        child,
        stdin: Arc::new(Mutex::new(stdin)),
        form_hwnd,
    })
}

// ── Session Commands ────────────────────────────────────

/// Send a command string to the C# embedded helper via stdin.
pub fn send_command(session: &EmbeddedRdpSession, cmd: &str) -> Result<(), String> {
    let mut guard = session.stdin.lock().map_err(|e| format!("Lock error: {}", e))?;
    if let Some(ref mut stdin) = *guard {
        writeln!(stdin, "{}", cmd).map_err(|e| format!("Write error: {}", e))?;
        stdin.flush().map_err(|e| format!("Flush error: {}", e))?;
    }
    Ok(())
}

/// Reposition/resize the embedded RDP window using physical screen coordinates.
pub fn resize_embedded(session: &EmbeddedRdpSession, x: i32, y: i32, w: i32, h: i32) -> Result<(), String> {
    send_command(session, &format!("RESIZE:{},{},{},{}", x, y, w, h))
}

/// Hide the embedded RDP window (native ShowWindow SW_HIDE).
pub fn hide_embedded(session: &EmbeddedRdpSession) -> Result<(), String> {
    send_command(session, "HIDE")
}

/// Show the embedded RDP window (native ShowWindow SW_SHOW).
pub fn show_embedded(session: &EmbeddedRdpSession) -> Result<(), String> {
    send_command(session, "SHOW")
}

/// Send keyboard focus to the embedded RDP ActiveX control.
pub fn focus_embedded(session: &EmbeddedRdpSession) -> Result<(), String> {
    send_command(session, "FOCUS")
}

/// Close the embedded RDP session gracefully.
pub fn close_embedded(session: &EmbeddedRdpSession) {
    let _ = send_command(session, "CLOSE");
}

/// Check if the embedded session process is still alive.
pub fn is_embedded_alive(session: &mut EmbeddedRdpSession) -> bool {
    match session.child.try_wait() {
        Ok(Some(_)) => false, // process has exited
        Ok(None) => true,     // still running
        Err(_) => false,
    }
}

// ── Background event reader ─────────────────────────────
//
// After the HWND handshake, the remaining stdout of RdpEmbed.exe carries
// structured "EVENT:..." lines.  We pick them up in a background thread and
// emit Tauri events so the frontend can react without polling.
//
// Called from lib.rs after a successful launch.

/// Spawn a background thread that drains RdpEmbed stdout and emits Tauri events.
/// The thread exits automatically when the child process exits (EOF on stdout).
#[allow(dead_code)]
pub fn spawn_event_reader(
    app: tauri::AppHandle,
    session_id: String,
    stdout: std::process::ChildStdout,
) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    let l = l.trim().to_string();
                    // Forward every line as a Tauri event so the frontend can listen
                    let _ = app.emit(&format!("rdp-event-{}", session_id), l);
                }
                Err(_) => break,
            }
        }
        // Process exited — send a synthetic closed event
        let _ = app.emit(&format!("rdp-event-{}", session_id), "CLOSED");
    });
}

// ── Legacy mstsc fallback ───────────────────────────────

#[allow(dead_code)]
pub fn launch_rdp_mstsc(
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
) -> Result<Child, String> {
    #[cfg(target_os = "windows")]
    {
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
             authenticationlevel:i:0\r\n\
             prompt for credentials:i:0\r\n",
            host, port, username, domain,
            if fullscreen { 2 } else { 1 },
            width, height, color_depth,
            if drives { 1 } else { 0 },
            if printers { 1 } else { 0 },
            if audio { 0 } else { 2 },
        );

        let temp_dir = std::env::temp_dir();
        let rdp_file = temp_dir.join(format!("nexus_{}.rdp", uuid::Uuid::new_v4()));
        std::fs::write(&rdp_file, rdp_content)
            .map_err(|e| format!("Failed to create .rdp file: {}", e))?;

        let target = if port == 3389 {
            host.to_string()
        } else {
            format!("{}:{}", host, port)
        };

        if !password.is_empty() {
            let user_pass = if domain.is_empty() {
                username.to_string()
            } else {
                format!("{}\\{}", domain, username)
            };
            let _ = Command::new("cmdkey")
                .arg(format!("/generic:TERMSRV/{}", target))
                .arg(format!("/user:{}", user_pass))
                .arg(format!("/pass:{}", password))
                .output();
        }

        let child = Command::new("mstsc.exe")
            .arg(rdp_file.to_str().unwrap())
            .spawn()
            .map_err(|e| format!("Failed to launch mstsc: {}", e))?;

        if !password.is_empty() {
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(10));
                let _ = Command::new("cmdkey")
                    .arg(format!("/delete:TERMSRV/{}", target))
                    .output();
            });
        }

        Ok(child)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let binary = if which_exists("xfreerdp3") { "xfreerdp3" } else { "xfreerdp" };
        let mut cmd = Command::new(binary);
        cmd.arg(format!("/v:{}:{}", host, port))
            .arg(format!("/u:{}", username))
            .arg(format!("/size:{}x{}", width, height))
            .arg(format!("/bpp:{}", color_depth));

        if !domain.is_empty() { cmd.arg(format!("/d:{}", domain)); }
        if audio { cmd.arg("/audio-mode:0"); } else { cmd.arg("/audio-mode:1"); }
        if drives { cmd.arg("+drive"); }
        if printers { cmd.arg("+printer"); }
        if fullscreen { cmd.arg("/f"); }
        if !password.is_empty() { cmd.arg(format!("/p:{}", password)); }

        cmd.spawn().map_err(|e| format!("Failed to launch {}: {}", binary, e))
    }
}
