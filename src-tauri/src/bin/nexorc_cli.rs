//! nexorc — NexoRC CLI companion
//!
//! Reads the same encrypted vault as the desktop app.
//!
//! Usage:
//!   nexorc list                     list saved connections
//!   nexorc connect <name>           open interactive SSH session (via system ssh)
//!   nexorc exec <name> -- <cmd>     run SSH command, print output, exit with its code

use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use remote_manager_lib::{database, encryption};
use russh::{client, ChannelMsg};
use russh_keys::key::KeyPair;
use std::{
    error::Error,
    path::{Path, PathBuf},
    sync::Arc,
};
use zeroize::Zeroize;

type BoxErr = Box<dyn Error>;

// ── Data directory (same location as the desktop app) ────────────────────────

fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nexorc")
}

// ── Vault unlock ──────────────────────────────────────────────────────────────

fn unlock(dir: &Path) -> Result<[u8; 32], BoxErr> {
    let raw = std::fs::read_to_string(dir.join("config.json")).map_err(|_| {
        "vault not initialised — open NexoRC desktop app first to set up your vault"
    })?;

    let v: serde_json::Value = serde_json::from_str(&raw)?;

    let salt = v["salt"]
        .as_str()
        .and_then(|s| BASE64.decode(s).ok())
        .ok_or("config.json: missing or invalid salt")?;

    let token = v["verification_token"]
        .as_str()
        .ok_or("config.json: missing verification_token")?;

    let kdf = encryption::KdfParams::from_config(&v["kdf"], true);

    let password = rpassword::prompt_password("NexoRC master password: ")
        .map_err(|e| format!("password prompt failed: {e}"))?;

    let key = encryption::derive_key_params(&password, &salt, &kdf)
        .map_err(|e| format!("key derivation failed: {e}"))?;

    if !encryption::verify_master_password(token, &key) {
        return Err("wrong master password".into());
    }

    Ok(key)
}

// ── DB pool ───────────────────────────────────────────────────────────────────

fn open_db(dir: &Path) -> Result<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>, BoxErr> {
    let path = dir.join("connections.db");
    database::initialize_database(path.to_str().ok_or("non-UTF-8 db path")?)
}

// ── list ──────────────────────────────────────────────────────────────────────

fn cmd_list(dir: &Path) -> Result<(), BoxErr> {
    let mut key = unlock(dir)?;
    let pool = open_db(dir)?;
    let db = pool.get()?;
    let conns = database::get_connections(&db).map_err(|e| -> BoxErr { e.into() })?;
    key.zeroize();

    println!(
        "{:<36} {:<28} {:<8} {:<24} {:<6}",
        "ID", "Name", "Proto", "Host", "Port"
    );
    println!("{}", "─".repeat(106));
    for c in &conns {
        println!(
            "{:<36} {:<28} {:<8} {:<24} {:<6}",
            c.id,
            c.name.chars().take(28).collect::<String>(),
            c.protocol,
            c.host.chars().take(24).collect::<String>(),
            c.port,
        );
    }
    println!("\n{} connection(s)", conns.len());
    Ok(())
}

// ── connect ───────────────────────────────────────────────────────────────────
// Delegates to system `ssh` so the user gets a full interactive PTY with
// readline, tab-completion, and all standard terminal features.

fn cmd_connect(dir: &Path, name: &str) -> Result<(), BoxErr> {
    let mut key = unlock(dir)?;
    let pool = open_db(dir)?;
    let db = pool.get()?;
    let conns = database::get_connections(&db).map_err(|e| -> BoxErr { e.into() })?;

    let conn = conns
        .iter()
        .find(|c| c.name.to_lowercase().contains(&name.to_lowercase()))
        .ok_or_else(|| format!("no connection matching '{name}'"))?;

    if conn.protocol != "SSH" {
        key.zeroize();
        return Err(format!(
            "'connect' supports SSH only (this connection is {})",
            conn.protocol
        )
        .into());
    }

    let mut cmd = std::process::Command::new("ssh");
    cmd.arg("-p")
        .arg(conn.port.to_string())
        .arg("-o")
        .arg("StrictHostKeyChecking=accept-new");

    // Keep auth material (temp key file / askpass helper) alive until ssh exits.
    let mut _guards: Vec<tempfile::NamedTempFile> = Vec::new();

    if conn.use_private_key {
        // Key auth: write PEM to a temp file (0600), point ssh at it with -i.
        let enc = conn
            .private_key_encrypted
            .as_deref()
            .ok_or("connection uses key auth but has no stored private key")?;
        let pem = encryption::decrypt_auto(enc, &key).map_err(|e| format!("key decrypt: {e}"))?;
        let tmp = tempfile::NamedTempFile::new()?;
        std::fs::write(tmp.path(), pem.as_bytes())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(tmp.path(), std::fs::Permissions::from_mode(0o600))?;
        }
        cmd.arg("-i").arg(tmp.path());
        _guards.push(tmp);
    } else if let Some(enc) = conn.password_encrypted.as_deref() {
        // Password auth: NEVER print the password (would persist in terminal
        // scrollback / logs). On Unix, hand it to ssh via SSH_ASKPASS so it is
        // injected directly. On Windows, copy it to the clipboard via `clip`.
        let pw = encryption::decrypt_auto(enc, &key).map_err(|e| format!("pw decrypt: {e}"))?;
        if let Some(askpass) = configure_password_auth(&mut cmd, &pw)? {
            _guards.push(askpass);
        }
    }

    key.zeroize();

    cmd.arg(format!("{}@{}", conn.username, conn.host));
    eprintln!(
        "[nexorc] Connecting: {} ({}@{}:{})",
        conn.name, conn.username, conn.host, conn.port
    );

    let status = cmd
        .status()
        .map_err(|e| format!("failed to launch ssh: {e}"))?;

    // _guards dropped here → temp files deleted
    std::process::exit(status.code().unwrap_or(1));
}

/// Wires up password auth WITHOUT echoing the password to the terminal.
///
/// - **Unix:** writes a single-use SSH_ASKPASS helper script (0700) that prints
///   the password, and forces ssh to use it (`SSH_ASKPASS_REQUIRE=force`,
///   OpenSSH ≥ 8.4). Returns the temp file so the caller keeps it alive.
/// - **Windows:** copies the password to the clipboard via `clip` (over stdin,
///   so it never appears in process arguments) and instructs the user to paste.
#[cfg(unix)]
fn configure_password_auth(
    cmd: &mut std::process::Command,
    pw: &str,
) -> Result<Option<tempfile::NamedTempFile>, BoxErr> {
    use std::os::unix::fs::PermissionsExt;
    // Escape single quotes for safe embedding in a single-quoted shell string.
    let escaped = pw.replace('\'', "'\\''");
    let script = format!("#!/bin/sh\nprintf '%s\\n' '{escaped}'\n");
    let tmp = tempfile::NamedTempFile::new()?;
    std::fs::write(tmp.path(), script.as_bytes())?;
    std::fs::set_permissions(tmp.path(), std::fs::Permissions::from_mode(0o700))?;
    cmd.env("SSH_ASKPASS", tmp.path());
    cmd.env("SSH_ASKPASS_REQUIRE", "force");
    // OpenSSH < 8.4 also requires DISPLAY to be set to use SSH_ASKPASS.
    if std::env::var_os("DISPLAY").is_none() {
        cmd.env("DISPLAY", ":0");
    }
    Ok(Some(tmp))
}

#[cfg(windows)]
fn configure_password_auth(
    _cmd: &mut std::process::Command,
    pw: &str,
) -> Result<Option<tempfile::NamedTempFile>, BoxErr> {
    use std::io::Write;
    use std::process::Stdio;
    // Pipe the password into `clip` via stdin so it never appears in argv.
    let mut child = std::process::Command::new("clip")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to launch clip: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(pw.as_bytes())?;
    }
    child.wait()?;
    eprintln!("[nexorc] SSH password copied to clipboard — paste it (right-click / Ctrl+V) when ssh prompts.");
    Ok(None)
}

// ── exec ──────────────────────────────────────────────────────────────────────
// Uses russh directly (no system ssh) so stdout/stderr are captured cleanly.

#[derive(Clone)]
struct CliHandler;

#[async_trait]
impl client::Handler for CliHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        use russh_keys::PublicKeyBase64;
        eprintln!(
            "[nexorc] host key ({}) {}",
            server_public_key.name(),
            server_public_key.public_key_base64()
        );
        // TOFU: accept all host keys.
        // Production use should verify against the desktop app's known_hosts file.
        Ok(true)
    }
}

async fn cmd_exec_async(dir: &Path, name: &str, cmd_str: &str) -> Result<(), BoxErr> {
    let mut key = unlock(dir)?;
    let pool = open_db(dir)?;
    let db = pool.get()?;
    let conns = database::get_connections(&db).map_err(|e| -> BoxErr { e.into() })?;

    let conn = conns
        .iter()
        .find(|c| c.name.to_lowercase().contains(&name.to_lowercase()))
        .ok_or_else(|| format!("no connection matching '{name}'"))?;

    if conn.protocol != "SSH" {
        key.zeroize();
        return Err(format!(
            "'exec' supports SSH only (this connection is {})",
            conn.protocol
        )
        .into());
    }

    let host = conn.host.clone();
    let port = conn.port as u16;
    let username = conn.username.clone();

    let (key_pair, password): (Option<KeyPair>, Option<String>) = if conn.use_private_key {
        let enc = conn
            .private_key_encrypted
            .as_deref()
            .ok_or("no stored private key")?;
        let pem = encryption::decrypt_auto(enc, &key).map_err(|e| format!("key decrypt: {e}"))?;
        key.zeroize();
        let kp =
            russh_keys::decode_secret_key(&pem, None).map_err(|e| format!("key parse: {e}"))?;
        (Some(kp), None)
    } else {
        let pw = conn
            .password_encrypted
            .as_deref()
            .map(|enc| encryption::decrypt_auto(enc, &key))
            .transpose()
            .map_err(|e| format!("password decrypt: {e}"))?;
        key.zeroize();
        (None, pw)
    };

    let config = Arc::new(client::Config {
        keepalive_interval: Some(std::time::Duration::from_secs(30)),
        keepalive_max: 3,
        ..<client::Config as Default>::default()
    });

    let mut session = client::connect(config, (host.as_str(), port), CliHandler)
        .await
        .map_err(|e| format!("SSH connect to {host}:{port}: {e}"))?;

    let authed = if let Some(kp) = key_pair {
        session
            .authenticate_publickey(&username, Arc::new(kp))
            .await
            .map_err(|e| format!("key auth: {e}"))?
    } else if let Some(ref pw) = password {
        session
            .authenticate_password(&username, pw)
            .await
            .map_err(|e| format!("password auth: {e}"))?
    } else {
        return Err("no credentials available for this connection".into());
    };

    if !authed {
        return Err("SSH authentication rejected by server".into());
    }

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("channel open: {e}"))?;

    channel
        .exec(true, cmd_str)
        .await
        .map_err(|e| format!("exec request: {e}"))?;

    let mut exit_code: i32 = 0;

    loop {
        let Some(msg) = channel.wait().await else {
            break;
        };
        match msg {
            ChannelMsg::Data { ref data } => {
                use std::io::Write;
                std::io::stdout().write_all(data)?;
            }
            ChannelMsg::ExtendedData { ref data, .. } => {
                use std::io::Write;
                std::io::stderr().write_all(data)?;
            }
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = exit_status as i32;
            }
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }

    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "", "")
        .await;

    std::process::exit(exit_code);
}

// ── main ──────────────────────────────────────────────────────────────────────

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = data_dir();

    match args.get(1).map(|s| s.as_str()) {
        Some("list") => {
            if let Err(e) = cmd_list(&dir) {
                eprintln!("error: {e}");
                std::process::exit(1);
            }
        }
        Some("connect") => {
            let name = match args.get(2) {
                Some(n) => n.clone(),
                None => {
                    eprintln!("usage: nexorc connect <connection-name>");
                    std::process::exit(1);
                }
            };
            if let Err(e) = cmd_connect(&dir, &name) {
                eprintln!("error: {e}");
                std::process::exit(1);
            }
        }
        Some("exec") => {
            let name = match args.get(2) {
                Some(n) => n.clone(),
                None => {
                    eprintln!("usage: nexorc exec <name> -- <command>");
                    std::process::exit(1);
                }
            };
            let sep = args.iter().position(|a| a == "--");
            let cmd_str = match sep {
                Some(i) if i + 1 < args.len() => args[i + 1..].join(" "),
                _ => {
                    eprintln!("usage: nexorc exec <name> -- <command>");
                    std::process::exit(1);
                }
            };
            let rt = tokio::runtime::Runtime::new().expect("tokio runtime init failed");
            if let Err(e) = rt.block_on(cmd_exec_async(&dir, &name, &cmd_str)) {
                eprintln!("error: {e}");
                std::process::exit(1);
            }
        }
        _ => {
            eprintln!(
                "nexorc — NexoRC CLI companion\n\n\
                 Usage:\n\
                 \x20 nexorc list                   list saved connections\n\
                 \x20 nexorc connect <name>         open interactive SSH session\n\
                 \x20 nexorc exec <name> -- <cmd>   run SSH command, capture output\n\n\
                 Connections are matched by case-insensitive substring on name.\n\
                 The CLI reads the same encrypted vault as the NexoRC desktop app."
            );
            std::process::exit(1);
        }
    }
}
