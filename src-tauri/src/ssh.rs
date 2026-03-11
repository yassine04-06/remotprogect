use serde::Serialize;
use std::io::{Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};
use std::fs;
use chrono::Utc;

// ── Session handle ───────────────────────────────────────

pub struct SshSession {
    pub child: Arc<Mutex<Option<Child>>>,
    pub stdin_tx: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    pub askpass_path: Option<std::path::PathBuf>,
}

// ── Status events ────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct SshStatusEvent {
    pub session_id: String,
    pub status: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
pub struct SshDataEvent {
    pub session_id: String,
    pub data: String,
}

// ── Diagnostics ──────────────────────────────────────────

fn log_diag(msg: &str) {
    let mut log_path = std::env::temp_dir();
    log_path.push("nexus_ssh_debug.log");
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(file, "[{}] {}", Utc::now(), msg);
    }
}

// ── Connect ──────────────────────────────────────────────

pub fn ssh_connect(
    app: &AppHandle,
    session_id: &str,
    host: &str,
    port: i32,
    username: &str,
    password: Option<&str>,
    private_key_path: Option<&str>,
    ssh_tunnels: Option<Vec<crate::database::SshTunnel>>,
) -> Result<SshSession, String> {
    log_diag(&format!("=== NEW SESSION: {}@{}:{} ===", username, host, port));

    let _ = app.emit(
        &format!("ssh:status:{}", session_id),
        SshStatusEvent {
            session_id: session_id.to_string(),
            status: "connecting".to_string(),
            message: format!("Connecting to {}:{}...", host, port),
        },
    );

    // ── Locate SSH binary ────────────────────────────────
    let mut ssh_bin = "ssh".to_string();
    #[cfg(target_os = "windows")]
    {
        let sys_path = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
        if std::path::Path::new(sys_path).exists() {
            ssh_bin = sys_path.to_string();
        }
    }

    // ── Create SSH_ASKPASS helper if password is provided ─
    //    This is the CORRECT way to inject passwords on Windows.
    //    Windows OpenSSH uses Console API, not stdin, to read passwords.
    //    SSH_ASKPASS makes SSH call our helper program instead.
    let mut askpass_file: Option<std::path::PathBuf> = None;

    if let Some(pass) = password {
        if !pass.is_empty() {
            let askpass_path = std::env::temp_dir().join(format!("nexus_askpass_{}.cmd", session_id.replace('-', "")));
            
            // Write a .cmd script that simply echoes the password.
            // We escape special batch characters to be safe.
            let escaped_pass = pass
                .replace('%', "%%")
                .replace('^', "^^")
                .replace('&', "^&")
                .replace('<', "^<")
                .replace('>', "^>")
                .replace('|', "^|");
            
            let script_content = format!("@echo off\r\necho {}\r\n", escaped_pass);
            
            fs::write(&askpass_path, &script_content)
                .map_err(|e| format!("Failed to create askpass helper: {}", e))?;
            
            log_diag(&format!("Created askpass at: {:?} (pass_len={})", askpass_path, pass.len()));
            askpass_file = Some(askpass_path);
        }
    }

    // ── Build SSH command ────────────────────────────────
    let mut cmd = Command::new(&ssh_bin);

    cmd.arg("-v")
        .arg("-o").arg("StrictHostKeyChecking=no")
        .arg("-o").arg("UserKnownHostsFile=NUL")
        .arg("-o").arg("PasswordAuthentication=yes")
        .arg("-o").arg("PubkeyAuthentication=yes")
        .arg("-o").arg("KbdInteractiveAuthentication=yes")
        .arg("-o").arg("ConnectTimeout=10")
        .arg("-p").arg(port.to_string());

    if let Some(tunnels) = ssh_tunnels {
        for t in tunnels {
            match t.r#type.as_str() {
                "Local" => {
                    let d_host = t.destination_host.as_deref().unwrap_or("localhost");
                    let d_port = t.destination_port.unwrap_or(80);
                    cmd.arg("-L").arg(format!("{}:{}:{}", t.local_port, d_host, d_port));
                }
                "Remote" => {
                    let d_host = t.destination_host.as_deref().unwrap_or("localhost");
                    let d_port = t.destination_port.unwrap_or(80);
                    cmd.arg("-R").arg(format!("{}:{}:{}", t.local_port, d_host, d_port));
                }
                "Dynamic" => {
                    cmd.arg("-D").arg(t.local_port.to_string());
                }
                _ => {}
            }
        }
    }

    cmd.arg("-tt")
        .arg(format!("{}@{}", username, host));

    if let Some(key) = private_key_path {
        if !key.is_empty() {
            cmd.arg("-i").arg(key);
        }
    }

    // ── Set SSH_ASKPASS environment ──────────────────────
    if let Some(ref askpass_path) = askpass_file {
        cmd.env("SSH_ASKPASS", askpass_path.to_string_lossy().to_string());
        cmd.env("SSH_ASKPASS_REQUIRE", "force");
        cmd.env("DISPLAY", "localhost:0");
        log_diag("SSH_ASKPASS configured: force mode enabled");
    }

    log_diag(&format!("Launching: {:?}", cmd));

    // ── Spawn ───────────────────────────────────────────
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            let err = format!("Failed to spawn SSH: {}", e);
            log_diag(&err);
            // Clean up askpass file on error
            if let Some(ref p) = askpass_file { let _ = fs::remove_file(p); }
            err
        })?;

    let stdin = child.stdin.take().ok_or("No stdin")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take().ok_or("No stderr")?;

    let stdin_tx: Arc<Mutex<Option<Box<dyn Write + Send>>>> =
        Arc::new(Mutex::new(Some(Box::new(stdin) as Box<dyn Write + Send>)));
    let child_arc = Arc::new(Mutex::new(Some(child)));

    let app_handle = app.clone();
    let sid = session_id.to_string();
    let child_arc_io = child_arc.clone();

    // ── Schedule askpass cleanup ─────────────────────────
    if let Some(ref askpass_path) = askpass_file {
        let cleanup_path = askpass_path.clone();
        thread::spawn(move || {
            // Wait long enough for SSH to have read it, then delete
            thread::sleep(std::time::Duration::from_secs(15));
            if cleanup_path.exists() {
                let _ = fs::remove_file(&cleanup_path);
                log_diag(&format!("Cleaned up askpass: {:?}", cleanup_path));
            }
        });
    }

    // ── Spawn output readers ────────────────────────────
    let streams: Vec<(Box<dyn Read + Send>, &str)> = vec![
        (Box::new(stdout), "OUT"),
        (Box::new(stderr), "ERR"),
    ];

    for (mut reader, label) in streams {
        let sid_clone = sid.clone();
        let app_clone = app_handle.clone();
        let child_arc_clone = child_arc_io.clone();

        thread::spawn(move || {
            let mut buffer = [0; 4096];

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        let raw = String::from_utf8_lossy(&buffer[..n]).to_string();
                        log_diag(&format!("{}: {}", label, raw.trim()));

                        // Process line by line for filtering
                        let lines: Vec<&str> = raw.split('\n').collect();
                        let num_lines = lines.len();

                        for (i, line) in lines.iter().enumerate() {
                            let ll = line.to_lowercase();

                            // Filter debug noise
                            let is_noise = ll.contains("debug1:")
                                || ll.contains("debug2:")
                                || ll.contains("debug3:")
                                || ll.contains("openbsd_set_nodelay")
                                || (ll.contains("identity file") && ll.contains("type -1"));

                            if !is_noise {
                                let mut pkt = line.to_string();
                                if i < num_lines - 1 {
                                    pkt.push('\n');
                                }
                                if !pkt.is_empty() {
                                    let _ = app_clone.emit(
                                        &format!("ssh:data:{}", sid_clone),
                                        SshDataEvent {
                                            session_id: sid_clone.clone(),
                                            data: pkt,
                                        },
                                    );
                                }
                            }

                            // Detect successful login
                            if ll.contains("entering interactive session")
                                || ll.contains("authenticated to")
                            {
                                log_diag(">>> LOGIN SUCCESS <<<");
                                let _ = app_clone.emit(
                                    &format!("ssh:status:{}", sid_clone),
                                    SshStatusEvent {
                                        session_id: sid_clone.clone(),
                                        status: "connected".to_string(),
                                        message: "Connected".to_string(),
                                    },
                                );
                            }

                            // Detect auth failure
                            if ll.contains("permission denied") {
                                log_diag(">>> AUTH FAILURE <<<");
                            }
                        }
                    }
                    Err(e) => {
                        log_diag(&format!("{} read error: {}", label, e));
                        break;
                    }
                }
            }

            // On stdout EOF → session is over
            if label == "OUT" {
                log_diag(&format!("Session {} EOF", sid_clone));
                let _ = app_clone.emit(
                    &format!("ssh:status:{}", sid_clone),
                    SshStatusEvent {
                        session_id: sid_clone.clone(),
                        status: "disconnected".into(),
                        message: "Disconnected".into(),
                    },
                );
                if let Ok(mut g) = child_arc_clone.lock() {
                    if let Some(ref mut c) = *g {
                        let _ = c.wait();
                    }
                    *g = None;
                }
            }
        });
    }

    Ok(SshSession {
        child: child_arc,
        stdin_tx,
        askpass_path: askpass_file,
    })
}

// ── Send keyboard input to remote ────────────────────────

pub fn ssh_send_input(session: &SshSession, data: &str) -> Result<(), String> {
    let mut guard = session.stdin_tx.lock().map_err(|_| "Lock error")?;
    if let Some(ref mut stdin) = *guard {
        stdin.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Session closed".into())
    }
}

// ── Disconnect ───────────────────────────────────────────

pub fn ssh_disconnect(session: &SshSession) -> Result<(), String> {
    // Clean up askpass file
    if let Some(ref path) = session.askpass_path {
        let _ = fs::remove_file(path);
    }
    if let Ok(mut guard) = session.child.lock() {
        if let Some(ref mut child) = *guard {
            let _ = child.kill();
        }
        *guard = None;
    }
    Ok(())
}
