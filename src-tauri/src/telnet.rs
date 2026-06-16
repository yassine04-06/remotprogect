// Minimal Telnet client (RFC 854). Telnet is plaintext TCP with in-band option
// negotiation via IAC (byte 255) sequences. We refuse all options (server-side
// echo / line mode stays as the server defaults), strip IAC bytes from the data
// stream, and forward the rest to the frontend terminal verbatim.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

#[derive(Clone, Serialize)]
pub struct TelnetDataEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
pub struct TelnetStatusEvent {
    pub session_id: String,
    pub status: String,
    pub message: String,
}

// Telnet control bytes
const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;

/// Opens a Telnet connection and streams output to `telnet:data:{id}` events.
#[tauri::command]
pub async fn telnet_connect(
    app: AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    host: String,
    port: u16,
) -> Result<(), String> {
    let stream = TcpStream::connect((host.as_str(), port))
        .await
        .map_err(|e| format!("Telnet connect failed: {}", e))?;
    let (mut read_half, mut write_half) = stream.into_split();

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    state.telnet_sessions.insert(session_id.clone(), tx);

    let _ = app.emit(
        &format!("telnet:status:{}", session_id),
        TelnetStatusEvent {
            session_id: session_id.clone(),
            status: "connected".into(),
            message: format!("Connected to {}:{}", host, port),
        },
    );

    // Writer task: input from frontend → socket.
    let sid_w = session_id.clone();
    tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if write_half.write_all(&bytes).await.is_err() {
                break;
            }
            let _ = write_half.flush().await;
        }
        tracing::debug!("Telnet writer ended: {}", sid_w);
    });

    // Reader task: socket → strip IAC → frontend. Negotiation replies go back
    // through a dedicated channel to the writer would deadlock, so we answer
    // inline on a short-lived clone of the socket via a second connection isn't
    // possible — instead we batch negotiation answers and send them through the
    // same input channel (the writer task owns the write half).
    let app_r = app.clone();
    let sid_r = session_id.clone();
    let neg_tx = state
        .telnet_sessions
        .get(&session_id)
        .map(|s| s.clone())
        .ok_or("telnet session vanished")?;
    tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        // Carry holds bytes of an IAC sequence that was split across reads, so
        // it can be completed when the next chunk arrives (no stream corruption).
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match read_half.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let mut chunk = std::mem::take(&mut carry);
                    chunk.extend_from_slice(&buf[..n]);
                    let (clean, replies, leftover) = process_iac(&chunk);
                    carry = leftover;
                    if !replies.is_empty() {
                        let _ = neg_tx.send(replies);
                    }
                    if !clean.is_empty() {
                        let _ = app_r.emit(
                            &format!("telnet:data:{}", sid_r),
                            TelnetDataEvent {
                                session_id: sid_r.clone(),
                                data: String::from_utf8_lossy(&clean).to_string(),
                            },
                        );
                    }
                }
                Err(_) => break,
            }
        }
        let _ = app_r.emit(
            &format!("telnet:disconnected:{}", sid_r),
            TelnetStatusEvent {
                session_id: sid_r.clone(),
                status: "disconnected".into(),
                message: "Connection closed".into(),
            },
        );
    });

    Ok(())
}

/// Strips IAC negotiation from `input`, returning
/// (clean_data, negotiation_reply, leftover). `leftover` is any trailing,
/// incomplete IAC sequence that must be prepended to the next read.
/// We answer DO→WONT and WILL→DONT to politely decline every option.
fn process_iac(input: &[u8]) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    let mut clean = Vec::with_capacity(input.len());
    let mut reply = Vec::new();
    let mut i = 0;
    while i < input.len() {
        if input[i] != IAC {
            clean.push(input[i]);
            i += 1;
            continue;
        }
        // IAC with no following byte yet → carry it over.
        if i + 1 >= input.len() {
            return (clean, reply, input[i..].to_vec());
        }
        match input[i + 1] {
            // Escaped 0xFF in data
            IAC => {
                clean.push(IAC);
                i += 2;
            }
            DO | DONT | WILL | WONT => {
                // 3-byte command: need the option byte too.
                if i + 2 >= input.len() {
                    return (clean, reply, input[i..].to_vec());
                }
                let answer = if matches!(input[i + 1], DO | DONT) {
                    WONT
                } else {
                    DONT
                };
                reply.extend_from_slice(&[IAC, answer, input[i + 2]]);
                i += 3;
            }
            // Sub-negotiation: skip until IAC SE; carry over if unterminated.
            SB => {
                let mut j = i + 2;
                while j + 1 < input.len() && !(input[j] == IAC && input[j + 1] == SE) {
                    j += 1;
                }
                if j + 1 >= input.len() {
                    return (clean, reply, input[i..].to_vec());
                }
                i = j + 2;
            }
            _ => {
                i += 2;
            }
        }
    }
    (clean, reply, Vec::new())
}

/// Sends user input to the Telnet session.
#[tauri::command]
pub async fn telnet_send(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let tx = state
        .telnet_sessions
        .get(&session_id)
        .ok_or("No active Telnet session")?;
    tx.send(data.into_bytes())
        .map_err(|_| "Telnet session closed".to_string())
}

/// Closes a Telnet session.
#[tauri::command]
pub async fn telnet_disconnect(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
) -> Result<(), String> {
    state.telnet_sessions.remove(&session_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_plain_data() {
        let (clean, reply, leftover) = process_iac(b"hello");
        assert_eq!(clean, b"hello");
        assert!(reply.is_empty());
        assert!(leftover.is_empty());
    }

    #[test]
    fn answers_do_with_wont() {
        // IAC DO ECHO(1)
        let (clean, reply, leftover) = process_iac(&[IAC, DO, 1, b'h', b'i']);
        assert_eq!(clean, b"hi");
        assert_eq!(reply, vec![IAC, WONT, 1]);
        assert!(leftover.is_empty());
    }

    #[test]
    fn unescapes_double_iac() {
        let (clean, _, _) = process_iac(&[b'a', IAC, IAC, b'b']);
        assert_eq!(clean, vec![b'a', 0xFF, b'b']);
    }

    #[test]
    fn carries_split_command() {
        // IAC at the very end → must be carried, not dropped.
        let (clean, reply, leftover) = process_iac(&[b'x', IAC, DO]);
        assert_eq!(clean, b"x");
        assert!(reply.is_empty());
        assert_eq!(leftover, vec![IAC, DO]);
        // Completing it on the next chunk yields the reply.
        let mut next = leftover;
        next.push(3); // option SGA
        let (_, reply2, lo2) = process_iac(&next);
        assert_eq!(reply2, vec![IAC, WONT, 3]);
        assert!(lo2.is_empty());
    }
}
