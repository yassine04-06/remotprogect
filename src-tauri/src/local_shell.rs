use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

// ── Session ──────────────────────────────────────────────

pub use crate::state::LocalShellSession;

#[derive(Clone, Serialize)]
pub struct ShellDataEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
pub struct ShellStatusEvent {
    pub session_id: String,
    pub status: String,
    pub message: String,
}

// ── Shell detection ──────────────────────────────────────

/// Returns the shell binary and its initial arguments for the current OS.
///
/// Priority:
///   - Windows  → PowerShell 7 (pwsh.exe) if installed, otherwise Windows PowerShell
///   - macOS    → shell from $SHELL, fallback to /bin/zsh then /bin/bash
///   - Linux    → shell from $SHELL, fallback to /bin/bash then /bin/sh
fn detect_shell() -> (String, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        // Prefer PowerShell 7 (cross-platform) if installed
        let pwsh_paths = [
            "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
            "C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe",
        ];
        for path in &pwsh_paths {
            if std::path::Path::new(path).exists() {
                return (path.to_string(), vec!["-NoLogo".to_string()]);
            }
        }
        // Fallback to Windows PowerShell 5.x
        ("powershell.exe".to_string(), vec!["-NoLogo".to_string()])
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Read the preferred shell from the environment ($SHELL)
        let env_shell = std::env::var("SHELL").unwrap_or_default();

        let candidates: &[&str] = if cfg!(target_os = "macos") {
            &[
                env_shell.as_str(),
                "/bin/zsh", // default su macOS 10.15+
                "/bin/bash",
                "/bin/sh",
            ]
        } else {
            // Linux and other Unix systems
            &[env_shell.as_str(), "/bin/bash", "/usr/bin/bash", "/bin/sh"]
        };

        for candidate in candidates {
            if candidate.is_empty() {
                continue;
            }
            if std::path::Path::new(candidate).exists() {
                return (candidate.to_string(), vec!["-l".to_string()]);
            }
        }

        // Absolute last resort fallback
        ("/bin/sh".to_string(), vec![])
    }
}

// ── Spawn ────────────────────────────────────────────────

pub fn spawn_local_shell(app: &AppHandle, session_id: &str) -> Result<LocalShellSession, String> {
    let (shell_bin, shell_args) = detect_shell();
    tracing::info!(
        "Local shell spawning: shell={} session={}",
        shell_bin,
        session_id
    );

    let _ = app.emit(
        &format!("shell:status:{}", session_id),
        ShellStatusEvent {
            session_id: session_id.to_string(),
            status: "connected".to_string(),
            message: format!("Shell started: {}", shell_bin),
        },
    );

    // Create the pseudo-terminal
    let pty_system = native_pty_system();
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Build the shell command
    let mut cmd = CommandBuilder::new(&shell_bin);
    for arg in &shell_args {
        cmd.arg(arg);
    }

    // Set TERM so colors and escape sequences work correctly
    cmd.env("TERM", "xterm-256color");

    // Spawn the child process inside the PTY
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell '{}': {}", shell_bin, e))?;

    // Reader from the master side (shell output)
    let mut reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    // Writer (input to the shell)
    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let writer_arc: Arc<Mutex<Option<Box<dyn Write + Send>>>> = Arc::new(Mutex::new(Some(writer)));
    let master_arc: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>> =
        Arc::new(Mutex::new(Some(pty_pair.master)));
    let child_arc: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send>>>> =
        Arc::new(Mutex::new(Some(child)));

    let app_clone = app.clone();
    let sid = session_id.to_string();
    let child_arc_reader = child_arc.clone();

    // Reader thread — forwards shell output to the frontend
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app_clone.emit(
                        &format!("shell:data:{}", sid),
                        ShellDataEvent {
                            session_id: sid.clone(),
                            data,
                        },
                    );
                }
                Err(e) => {
                    tracing::debug!("Shell read error session={}: {}", sid, e);
                    break;
                }
            }
        }

        // Shell uscita
        tracing::info!("Local shell exited: session={}", sid);
        let _ = app_clone.emit(
            &format!("shell:status:{}", sid),
            ShellStatusEvent {
                session_id: sid.clone(),
                status: "disconnected".into(),
                message: "Shell terminated".into(),
            },
        );
        if let Ok(mut g) = child_arc_reader.lock() {
            *g = None;
        }
    });

    Ok(LocalShellSession {
        master: master_arc,
        writer: writer_arc,
        child: child_arc,
    })
}

// ── Send Input ───────────────────────────────────────────

pub fn shell_send_input(session: &LocalShellSession, data: &str) -> Result<(), String> {
    let mut guard = session.writer.lock().map_err(|_| "Lock error")?;
    if let Some(ref mut writer) = *guard {
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Shell closed".into())
    }
}

// ── Resize ───────────────────────────────────────────────

pub fn shell_resize(session: &LocalShellSession, rows: u16, cols: u16) -> Result<(), String> {
    let guard = session.master.lock().map_err(|_| "Lock error")?;
    if let Some(ref master) = *guard {
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Disconnect ───────────────────────────────────────────

pub fn shell_disconnect(session: &LocalShellSession) -> Result<(), String> {
    if let Ok(mut g) = session.writer.lock() {
        *g = None;
    }
    if let Ok(mut g) = session.child.lock() {
        if let Some(ref mut child) = *g {
            let _ = child.kill();
        }
        *g = None;
    }
    if let Ok(mut g) = session.master.lock() {
        *g = None;
    }
    Ok(())
}
