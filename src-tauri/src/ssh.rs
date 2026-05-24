//! HIGH-A1: native Rust SSH via `russh` — no system `ssh.exe` dependency.
//!
//! Replaces the previous `portable-pty` + OpenSSH subprocess approach:
//!   • deterministic connection state (no locale-dependent string matching)
//!   • no dependency on a system `ssh` binary
//!   • private-key passphrase support via `russh-keys`
//!   • unified TOFU for both direct and jump-host targets
//!   • local port forwarding via direct-tcpip channels
//!
//! Remote / dynamic tunnel types are logged as unsupported and skipped (TODO).

use crate::error::AppError;
use async_trait::async_trait;
use russh::{client, ChannelMsg};
use russh_keys::key::KeyPair;
use russh_keys::PublicKeyBase64; // brings public_key_base64() into scope
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use ts_rs::TS;

pub use crate::state::SshSession;

// ── Public event types ────────────────────────────────────────────────────────

#[derive(Clone, Serialize, TS)]
pub struct SshStatusEvent {
    pub session_id: String,
    pub status: String,
    pub message: String,
}

#[derive(Clone, Serialize, TS)]
pub struct SshDataEvent {
    pub session_id: String,
    pub data: String,
}

// ── Command channel ───────────────────────────────────────────────────────────

pub enum SshCmd {
    Input(Vec<u8>),
    Resize { rows: u16, cols: u16 },
    Disconnect,
}

// ── TOFU handler ──────────────────────────────────────────────────────────────

// Clone is required so that client::Handle<NexusSshHandler> derives Clone
// (Handle's derive(Clone) bound requires H: Clone when the derive macro
//  includes the phantom field — NexusSshHandler fields are all Clone).
#[derive(Clone)]
struct NexusSshHandler {
    data_dir: String,
    host: String,
    port: i32,
}

#[async_trait]
impl client::Handler for NexusSshHandler {
    type Error = AppError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        use base64::Engine;
        let key_type = server_public_key.name();
        let key_b64 = server_public_key.public_key_base64();
        let raw_key = base64::engine::general_purpose::STANDARD
            .decode(&key_b64)
            .map_err(|e| AppError::Internal(format!("Host key base64 decode: {}", e)))?;

        match crate::known_hosts::verify(&self.data_dir, &self.host, self.port, key_type, &raw_key)
        {
            crate::known_hosts::VerifyResult::Trusted => Ok(true),
            crate::known_hosts::VerifyResult::Unknown { .. } => {
                crate::known_hosts::trust(
                    &self.data_dir,
                    &self.host,
                    self.port,
                    key_type,
                    &raw_key,
                )
                .map_err(AppError::Internal)?;
                tracing::info!(
                    "SSH TOFU: pinned {}:{} ({}) in known_hosts.json",
                    self.host,
                    self.port,
                    key_type
                );
                Ok(true)
            }
            crate::known_hosts::VerifyResult::Mismatch {
                fingerprint_sha256,
                stored_fingerprint_sha256,
                ..
            } => Err(AppError::Validation(format!(
                "HOST KEY MISMATCH for {}:{} — possible MITM attack.\n\
                 Pinned:    {}\n\
                 Presented: {}\n\
                 Remove the entry in Settings → Host Keys to re-trust.",
                self.host, self.port, stored_fingerprint_sha256, fingerprint_sha256
            ))),
        }
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn parse_key(pem: &str, passphrase: Option<&str>) -> Result<KeyPair, AppError> {
    russh_keys::decode_secret_key(pem, passphrase).map_err(|e| {
        let msg = e.to_string();
        let lower = msg.to_lowercase();
        // Detect encrypted key with missing / wrong passphrase so the frontend
        // can show a prompt and retry.  We only raise KeyEncrypted when no
        // passphrase was supplied (a wrong passphrase is an AuthFailed).
        if passphrase.is_none()
            && (lower.contains("passphrase")
                || lower.contains("could not read key")
                || lower.contains("encrypted")
                || lower.contains("decrypt")
                || lower.contains("aes")
                || lower.contains("bcrypt"))
        {
            AppError::KeyEncrypted("SSH private key is encrypted — passphrase required".to_string())
        } else {
            AppError::AuthFailed(format!("Private key parse: {}", msg))
        }
    })
}

async fn authenticate(
    session: &mut client::Handle<NexusSshHandler>,
    username: &str,
    key_pair: Option<KeyPair>,
    password: Option<&str>,
) -> Result<(), AppError> {
    if let Some(kp) = key_pair {
        let ok = session
            .authenticate_publickey(username, Arc::new(kp))
            .await
            .map_err(|e| AppError::AuthFailed(format!("Public-key auth: {}", e)))?;
        if ok {
            tracing::debug!("SSH: public-key auth OK ({})", username);
            return Ok(());
        }
    }
    if let Some(pw) = password.filter(|p| !p.is_empty()) {
        let ok = session
            .authenticate_password(username, pw)
            .await
            .map_err(|e| AppError::AuthFailed(format!("Password auth: {}", e)))?;
        if ok {
            tracing::debug!("SSH: password auth OK ({})", username);
            return Ok(());
        }
    }
    Err(AppError::AuthFailed(
        "SSH authentication failed — wrong password/key or no method accepted.".to_string(),
    ))
}

fn russh_config() -> Arc<client::Config> {
    Arc::new(client::Config {
        keepalive_interval: Some(std::time::Duration::from_secs(30)),
        keepalive_max: 3,
        ..<client::Config as Default>::default()
    })
}

// ── Jump-host parameters (owned, no lifetime issues across async) ─────────────

pub struct JumpHostParams {
    pub host: String,
    pub port: i32,
    pub username: String,
    pub key_pem: Option<String>,
    pub password: Option<String>,
}

// ── Main connect entry-point ──────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn ssh_connect(
    app: &AppHandle,
    session_id: &str,
    host: &str,
    port: i32,
    username: &str,
    key_pem: Option<&str>,
    password: Option<&str>,
    // Passphrase for an encrypted private key.  Pass `None` on first attempt;
    // on `AppError::KeyEncrypted` the frontend re-calls with the user's input.
    passphrase: Option<&str>,
    ssh_tunnels: Option<Vec<crate::database::SshTunnel>>,
    data_dir: &str,
    jump: Option<JumpHostParams>,
    recording: Option<Arc<Mutex<crate::state::SessionRecording>>>,
) -> Result<SshSession, AppError> {
    tracing::info!("SSH (russh): {}@{}:{}", username, host, port);

    let _ = app.emit(
        &format!("ssh:status:{}", session_id),
        SshStatusEvent {
            session_id: session_id.to_string(),
            status: "connecting".to_string(),
            message: format!("Connecting to {}:{}...", host, port),
        },
    );

    let config = russh_config();

    let key_pair: Option<KeyPair> = if let Some(pem) = key_pem.filter(|s| !s.is_empty()) {
        Some(parse_key(pem, passphrase)?)
    } else {
        None
    };

    // ── Transport: direct or through a jump host ──────────────────────────────

    let mut session: client::Handle<NexusSshHandler> = if let Some(ref jp) = jump {
        // Jump-host keys are not passphrase-protected via the prompt flow;
        // they must be stored unencrypted (or decrypted by the vault).
        let jkey_pair: Option<KeyPair> =
            if let Some(pem) = jp.key_pem.as_deref().filter(|s| !s.is_empty()) {
                Some(parse_key(pem, None)?)
            } else {
                None
            };

        let jump_handler = NexusSshHandler {
            data_dir: data_dir.to_string(),
            host: jp.host.clone(),
            port: jp.port,
        };
        let mut jump_sess = client::connect(
            config.clone(),
            (jp.host.as_str(), jp.port as u16),
            jump_handler,
        )
        .await
        .map_err(|e| AppError::Network(format!("Jump host connect: {}", e)))?;

        authenticate(
            &mut jump_sess,
            &jp.username,
            jkey_pair,
            jp.password.as_deref(),
        )
        .await
        .map_err(|e| AppError::AuthFailed(format!("Jump host auth: {}", e)))?;

        let mut jump_ch = jump_sess
            .channel_open_direct_tcpip(host, port as u32, "127.0.0.1", 0)
            .await
            .map_err(|e| AppError::Network(format!("Jump direct-tcpip: {}", e)))?;

        // Bridge: duplex pipe so the inner SSH session sees a transparent stream.
        let (inner_transport, channel_bridge) = tokio::io::duplex(65536);
        let (mut br, mut bw) = tokio::io::split(channel_bridge);
        tokio::spawn(async move {
            let mut buf = vec![0u8; 32768];
            loop {
                tokio::select! {
                    msg = jump_ch.wait() => match msg {
                        Some(ChannelMsg::Data { ref data })
                            if bw.write_all(data).await.is_err() => { break; }
                        None | Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => break,
                        _ => {}
                    },
                    n = br.read(&mut buf) => match n {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            // &[u8] implements AsyncRead + Unpin — no Bytes needed
                            if jump_ch.data(&buf[..n]).await.is_err() {
                                break;
                            }
                        }
                    },
                }
            }
        });

        let target_handler = NexusSshHandler {
            data_dir: data_dir.to_string(),
            host: host.to_string(),
            port,
        };
        client::connect_stream(config.clone(), inner_transport, target_handler)
            .await
            .map_err(|e| AppError::Network(format!("Target SSH via jump: {}", e)))?
    } else {
        let handler = NexusSshHandler {
            data_dir: data_dir.to_string(),
            host: host.to_string(),
            port,
        };
        client::connect(config.clone(), (host, port as u16), handler)
            .await
            .map_err(|e| AppError::Network(format!("SSH connect: {}", e)))?
    };

    // ── Authenticate ──────────────────────────────────────────────────────────
    authenticate(&mut session, username, key_pair, password).await?;

    // ── Wrap in Arc so tunnel tasks can share the handle ──────────────────────
    // channel_open_* methods take &self, so Arc<Handle> is sufficient — no Mutex.
    // authenticate_* methods (&mut self) have already been called above.
    let session = Arc::new(session);

    // ── Open PTY + shell channel ──────────────────────────────────────────────
    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| AppError::Network(format!("Channel open: {}", e)))?;

    channel
        .request_pty(false, "xterm-256color", 120, 30, 0, 0, &[])
        .await
        .map_err(|e| AppError::Network(format!("PTY request: {}", e)))?;

    channel
        .request_shell(true)
        .await
        .map_err(|e| AppError::Network(format!("Shell request: {}", e)))?;

    // ── Local tunnel listeners ────────────────────────────────────────────────
    for tun in ssh_tunnels.unwrap_or_default() {
        match tun.r#type.as_str() {
            "Local" => {
                let lp = tun.local_port as u16;
                let dh = tun
                    .destination_host
                    .unwrap_or_else(|| "localhost".to_string());
                let dp = tun.destination_port.unwrap_or(80) as u32;
                let handle = Arc::clone(&session); // Arc clone — cheap, no Handle clone needed
                tokio::spawn(async move {
                    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", lp)).await {
                        Ok(l) => {
                            tracing::info!("SSH tunnel: :{} → {}:{}", lp, dh, dp);
                            l
                        }
                        Err(e) => {
                            tracing::error!("SSH tunnel bind :{} failed: {}", lp, e);
                            return;
                        }
                    };
                    loop {
                        let Ok((socket, _)) = listener.accept().await else {
                            break;
                        };
                        let h = Arc::clone(&handle);
                        let dh2 = dh.clone();
                        tokio::spawn(async move {
                            let mut ch = match h
                                .channel_open_direct_tcpip(&dh2, dp, "127.0.0.1", lp as u32)
                                .await
                            {
                                Ok(c) => c,
                                Err(e) => {
                                    tracing::warn!("Tunnel ch: {}", e);
                                    return;
                                }
                            };
                            let (mut sr, mut sw) = socket.into_split();
                            let mut buf = vec![0u8; 8192];
                            loop {
                                tokio::select! {
                                    n = sr.read(&mut buf) => match n {
                                        Ok(0) | Err(_) => break,
                                        // &[u8] implements AsyncRead + Unpin
                                        Ok(n) => { if ch.data(&buf[..n]).await.is_err() { break; } }
                                    },
                                    msg = ch.wait() => match msg {
                                        Some(ChannelMsg::Data { ref data }) if sw.write_all(data).await.is_err() => { break; }
                                        None | Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => break,
                                        _ => {}
                                    },
                                }
                            }
                        });
                    }
                });
            }
            other => {
                tracing::warn!(
                    "SSH tunnel type '{}' not yet supported in russh mode — skipped.",
                    other
                );
            }
        }
    }

    // ── Background I/O task ───────────────────────────────────────────────────
    let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::unbounded_channel::<SshCmd>();
    {
        let app_clone = app.clone();
        let sid = session_id.to_string();
        let rec = recording.clone();
        tokio::spawn(async move {
            let _sess = session; // keep Arc<Handle> alive; drops when task ends
            let _ = app_clone.emit(
                &format!("ssh:status:{}", sid),
                SshStatusEvent {
                    session_id: sid.clone(),
                    status: "connected".to_string(),
                    message: "Connected".to_string(),
                },
            );
            loop {
                tokio::select! {
                    msg = channel.wait() => match msg {
                        Some(ChannelMsg::Data { ref data }) => {
                            let text = String::from_utf8_lossy(data).to_string();
                            if let Some(ref r) = rec {
                                if let Ok(mut g) = r.lock() {
                                    let t = g.start_time.elapsed().as_secs_f64();
                                    g.events.push((t, 'o', text.clone()));
                                }
                            }
                            let _ = app_clone.emit(&format!("ssh:data:{}", sid),
                                SshDataEvent { session_id: sid.clone(), data: text });
                        }
                        Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                            let text = String::from_utf8_lossy(data).to_string();
                            let _ = app_clone.emit(&format!("ssh:data:{}", sid),
                                SshDataEvent { session_id: sid.clone(), data: text });
                        }
                        None | Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                            tracing::info!("SSH disconnected: session={}", sid);
                            let _ = app_clone.emit(&format!("ssh:status:{}", sid), SshStatusEvent {
                                session_id: sid.clone(), status: "disconnected".to_string(),
                                message: "Disconnected".to_string(),
                            });
                            break;
                        }
                        _ => {}
                    },
                    cmd = cmd_rx.recv() => match cmd {
                        Some(SshCmd::Input(data)) => {
                            if let Some(ref r) = rec {
                                if let Ok(mut g) = r.lock() {
                                    let t = g.start_time.elapsed().as_secs_f64();
                                    g.events.push((t, 'i', String::from_utf8_lossy(&data).to_string()));
                                }
                            }
                            // data: Vec<u8> — pass as &[u8] (AsyncRead + Unpin)
                            if channel.data(data.as_slice()).await.is_err() { break; }
                        }
                        Some(SshCmd::Resize { rows, cols }) => {
                            if let Some(ref r) = rec {
                                if let Ok(mut g) = r.lock() {
                                    let t = g.start_time.elapsed().as_secs_f64();
                                    g.cols = cols; g.rows = rows;
                                    g.events.push((t, 'r', format!("{}x{}", cols, rows)));
                                }
                            }
                            let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await;
                        }
                        Some(SshCmd::Disconnect) | None => {
                            let _ = channel.eof().await;
                            let _ = channel.close().await;
                            let _ = app_clone.emit(&format!("ssh:status:{}", sid), SshStatusEvent {
                                session_id: sid.clone(), status: "disconnected".to_string(),
                                message: "Disconnected".to_string(),
                            });
                            break;
                        }
                    },
                }
            }
        });
    }

    Ok(SshSession { cmd_tx, recording })
}

// ── Sync helpers (Tauri command handlers are sync) ────────────────────────────

pub fn ssh_send_input(session: &SshSession, data: &str) -> Result<(), AppError> {
    session
        .cmd_tx
        .send(SshCmd::Input(data.as_bytes().to_vec()))
        .map_err(|_| AppError::Internal("SSH session no longer active".to_string()))
}

pub fn ssh_resize(session: &SshSession, rows: u16, cols: u16) -> Result<(), AppError> {
    session
        .cmd_tx
        .send(SshCmd::Resize { rows, cols })
        .map_err(|_| AppError::Internal("SSH session no longer active".to_string()))
}

pub fn ssh_disconnect(session: &SshSession) -> Result<(), AppError> {
    let _ = session.cmd_tx.send(SshCmd::Disconnect);
    Ok(())
}
