use serde::Serialize;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};
use portable_pty::{CommandBuilder, PtySize, native_pty_system, MasterPty};

// ── Session ──────────────────────────────────────────────

pub struct LocalShellSession {
    pub master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    pub writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    pub child: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send>>>>,
}

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

// ── Spawn ────────────────────────────────────────────────

pub fn spawn_local_shell(
    app: &AppHandle,
    session_id: &str,
) -> Result<LocalShellSession, String> {
    let _ = app.emit(
        &format!("shell:status:{}", session_id),
        ShellStatusEvent {
            session_id: session_id.to_string(),
            status: "connected".to_string(),
            message: "Local shell started".to_string(),
        },
    );

    // Create a pseudo-terminal (ConPTY on Windows)
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
    let mut cmd = CommandBuilder::new("powershell.exe");
    cmd.arg("-NoLogo");

    // Spawn the child process inside the PTY
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Get a reader from the master side (reads what the shell outputs)
    let mut reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    // Get a writer (sends keystrokes to the shell)
    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let writer_arc: Arc<Mutex<Option<Box<dyn Write + Send>>>> =
        Arc::new(Mutex::new(Some(writer)));
    let master_arc: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>> =
        Arc::new(Mutex::new(Some(pty_pair.master)));
    let child_arc: Arc<Mutex<Option<Box<dyn portable_pty::Child + Send>>>> =
        Arc::new(Mutex::new(Some(child)));

    let app_clone = app.clone();
    let sid = session_id.to_string();
    let child_arc_reader = child_arc.clone();

    // Spawn reader thread — forwards PTY output to the frontend
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
                Err(_) => break,
            }
        }

        // Shell exited
        let _ = app_clone.emit(
            &format!("shell:status:{}", sid),
            ShellStatusEvent {
                session_id: sid.clone(),
                status: "disconnected".into(),
                message: "Shell exited".into(),
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
        writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
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
    // Drop writer to close stdin
    if let Ok(mut g) = session.writer.lock() {
        *g = None;
    }
    // Kill the child
    if let Ok(mut g) = session.child.lock() {
        if let Some(ref mut child) = *g {
            let _ = child.kill();
        }
        *g = None;
    }
    // Drop master
    if let Ok(mut g) = session.master.lock() {
        *g = None;
    }
    Ok(())
}
