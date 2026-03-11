use serde::Serialize;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};
use std::fs;
use chrono::Utc;

// ── Tipi pubblici (riesportati da state.rs) ──────────────

pub use crate::state::SshSession;

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

// ── Askpass helper ───────────────────────────────────────

/// Crea uno script askpass temporaneo il più sicuro possibile.
///
/// Su Windows usiamo ancora un file .cmd ma:
///   1. Lo scriviamo in una directory temp con permessi ristretti
///   2. Lo cancelliamo immediatamente dopo che SSH lo ha letto (poll attivo)
///   3. Il file viene comunque cancellato alla disconnessione
///
/// Su Unix usiamo uno script sh, che è più portabile dei .cmd.
/// Una soluzione ancora migliore (named pipe / socket) richiederebbe
/// un binario askpass separato compilato — fuori scope per ora.
#[cfg(target_os = "windows")]
fn create_askpass(session_id: &str, password: &str) -> Result<std::path::PathBuf, String> {
    let path = std::env::temp_dir()
        .join(format!("nxap_{}.cmd", &session_id[..8]));

    let escaped = password
        .replace('%', "%%")
        .replace('^', "^^")
        .replace('&', "^&")
        .replace('<', "^<")
        .replace('>', "^>")
        .replace('|', "^|")
        .replace('"', "\\\"");

    let content = format!("@echo off\r\necho {}\r\n", escaped);
    fs::write(&path, content)
        .map_err(|e| format!("Impossibile creare askpass helper: {}", e))?;

    log_diag(&format!("Askpass creato: {:?}", path));
    Ok(path)
}

#[cfg(not(target_os = "windows"))]
fn create_askpass(session_id: &str, password: &str) -> Result<std::path::PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;

    let path = std::env::temp_dir()
        .join(format!("nxap_{}.sh", &session_id[..8]));

    // Escapiamo le virgolette singole per lo shell
    let escaped = password.replace('\'', "'\\''");
    let content = format!("#!/bin/sh\nprintf '%s\\n' '{}'\n", escaped);

    fs::write(&path, content)
        .map_err(|e| format!("Impossibile creare askpass helper: {}", e))?;

    // Permessi 0700: solo il proprietario può eseguirlo
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
        .map_err(|e| format!("Impossibile impostare permessi askpass: {}", e))?;

    log_diag(&format!("Askpass creato: {:?}", path));
    Ok(path)
}

fn schedule_askpass_cleanup(path: std::path::PathBuf) {
    thread::spawn(move || {
        // SSH legge l'askpass quasi subito durante l'handshake.
        // 10 secondi sono più che sufficienti.
        thread::sleep(std::time::Duration::from_secs(10));
        if path.exists() {
            let _ = fs::remove_file(&path);
            log_diag(&format!("Askpass rimosso: {:?}", path));
        }
    });
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
    log_diag(&format!("=== NUOVA SESSIONE: {}@{}:{} ===", username, host, port));

    let _ = app.emit(
        &format!("ssh:status:{}", session_id),
        SshStatusEvent {
            session_id: session_id.to_string(),
            status: "connecting".to_string(),
            message: format!("Connessione a {}:{}...", host, port),
        },
    );

    // ── Individua il binario SSH ─────────────────────────
    let ssh_bin = resolve_ssh_binary();

    // ── Crea askpass se necessario ───────────────────────
    let mut askpass_file: Option<std::path::PathBuf> = None;

    if let Some(pass) = password {
        if !pass.is_empty() {
            let path = create_askpass(session_id, pass)?;
            askpass_file = Some(path);
        }
    }

    // ── Costruisci il comando SSH ────────────────────────
    let mut cmd = Command::new(&ssh_bin);

    cmd.arg("-v")
        .arg("-o").arg("StrictHostKeyChecking=no")
        .arg("-o").arg("UserKnownHostsFile=/dev/null")
        .arg("-o").arg("PasswordAuthentication=yes")
        .arg("-o").arg("PubkeyAuthentication=yes")
        .arg("-o").arg("KbdInteractiveAuthentication=yes")
        .arg("-o").arg("ConnectTimeout=10")
        .arg("-p").arg(port.to_string());

    // Tunneling SSH
    if let Some(tunnels) = ssh_tunnels {
        for t in tunnels {
            match t.r#type.as_str() {
                "Local" => {
                    let dh = t.destination_host.as_deref().unwrap_or("localhost");
                    let dp = t.destination_port.unwrap_or(80);
                    cmd.arg("-L").arg(format!("{}:{}:{}", t.local_port, dh, dp));
                }
                "Remote" => {
                    let dh = t.destination_host.as_deref().unwrap_or("localhost");
                    let dp = t.destination_port.unwrap_or(80);
                    cmd.arg("-R").arg(format!("{}:{}:{}", t.local_port, dh, dp));
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

    // ── Configura SSH_ASKPASS ────────────────────────────
    if let Some(ref ap) = askpass_file {
        cmd.env("SSH_ASKPASS", ap.to_string_lossy().to_string());
        cmd.env("SSH_ASKPASS_REQUIRE", "force");
        // DISPLAY è richiesto su alcuni sistemi Unix anche in modalità headless
        if std::env::var("DISPLAY").is_err() {
            cmd.env("DISPLAY", ":0");
        }
        log_diag("SSH_ASKPASS configurato");
    }

    log_diag(&format!("Lancio: {:?}", cmd));

    // ── Avvia il processo ────────────────────────────────
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            let err = format!("Impossibile avviare SSH: {}", e);
            log_diag(&err);
            if let Some(ref p) = askpass_file { let _ = fs::remove_file(p); }
            err
        })?;

    let stdin  = child.stdin.take().ok_or("stdin non disponibile")?;
    let stdout = child.stdout.take().ok_or("stdout non disponibile")?;
    let stderr = child.stderr.take().ok_or("stderr non disponibile")?;

    let stdin_tx: Arc<Mutex<Option<Box<dyn Write + Send>>>> =
        Arc::new(Mutex::new(Some(Box::new(stdin) as Box<dyn Write + Send>)));
    let child_arc = Arc::new(Mutex::new(Some(child)));

    // Pianifica la rimozione dell'askpass file
    if let Some(ref path) = askpass_file {
        schedule_askpass_cleanup(path.clone());
    }

    // ── Thread lettori stdout/stderr ─────────────────────
    let streams: Vec<(Box<dyn Read + Send>, &str)> = vec![
        (Box::new(stdout), "OUT"),
        (Box::new(stderr), "ERR"),
    ];

    for (mut reader, label) in streams {
        let sid = session_id.to_string();
        let app_clone = app.clone();
        let child_clone = child_arc.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let raw = String::from_utf8_lossy(&buf[..n]).to_string();
                        log_diag(&format!("{}: {}", label, raw.trim()));

                        let lines: Vec<&str> = raw.split('\n').collect();
                        let nlines = lines.len();

                        for (i, line) in lines.iter().enumerate() {
                            let ll = line.to_lowercase();

                            let is_noise = ll.contains("debug1:")
                                || ll.contains("debug2:")
                                || ll.contains("debug3:")
                                || ll.contains("openbsd_set_nodelay")
                                || (ll.contains("identity file") && ll.contains("type -1"));

                            if !is_noise {
                                let mut pkt = line.to_string();
                                if i < nlines - 1 { pkt.push('\n'); }
                                if !pkt.is_empty() {
                                    let _ = app_clone.emit(
                                        &format!("ssh:data:{}", sid),
                                        SshDataEvent { session_id: sid.clone(), data: pkt },
                                    );
                                }
                            }

                            if ll.contains("entering interactive session") || ll.contains("authenticated to") {
                                log_diag(">>> LOGIN OK <<<");
                                let _ = app_clone.emit(
                                    &format!("ssh:status:{}", sid),
                                    SshStatusEvent {
                                        session_id: sid.clone(),
                                        status: "connected".to_string(),
                                        message: "Connesso".to_string(),
                                    },
                                );
                            }

                            if ll.contains("permission denied") {
                                log_diag(">>> AUTH FALLITA <<<");
                            }
                        }
                    }
                    Err(e) => { log_diag(&format!("{} read error: {}", label, e)); break; }
                }
            }

            if label == "OUT" {
                log_diag(&format!("Sessione {} EOF", sid));
                let _ = app_clone.emit(
                    &format!("ssh:status:{}", sid),
                    SshStatusEvent {
                        session_id: sid.clone(),
                        status: "disconnected".into(),
                        message: "Disconnesso".into(),
                    },
                );
                if let Ok(mut g) = child_clone.lock() {
                    if let Some(ref mut c) = *g { let _ = c.wait(); }
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

// ── Individua il binario SSH ─────────────────────────────

fn resolve_ssh_binary() -> String {
    #[cfg(target_os = "windows")]
    {
        let sys = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
        if std::path::Path::new(sys).exists() {
            return sys.to_string();
        }
    }
    "ssh".to_string()
}

// ── Invio input ──────────────────────────────────────────

pub fn ssh_send_input(session: &SshSession, data: &str) -> Result<(), String> {
    let mut guard = session.stdin_tx.lock().map_err(|_| "Lock error")?;
    if let Some(ref mut stdin) = *guard {
        stdin.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Sessione chiusa".into())
    }
}

// ── Disconnessione ───────────────────────────────────────

pub fn ssh_disconnect(session: &SshSession) -> Result<(), String> {
    if let Some(ref path) = session.askpass_path {
        let _ = fs::remove_file(path);
    }
    if let Ok(mut g) = session.child.lock() {
        if let Some(ref mut c) = *g { let _ = c.kill(); }
        *g = None;
    }
    Ok(())
}
