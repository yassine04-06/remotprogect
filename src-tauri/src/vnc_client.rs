// 90-11: Native VNC client — RFB 3.8 protocol
//
// Implements enough of the RFB spec to display a remote framebuffer:
//   - Version negotiation (3.8)
//   - Security: None (type 1) and VNC Authentication (type 2, DES)
//   - Pixel format: 32bpp RGBA (red-shift=0, green-shift=8, blue-shift=16)
//   - Encodings: Raw (#0) + CopyRect (#1 — L-4 partial: server-side blit hint)
//   - Streams per-rectangle RGBA patches as Tauri events → canvas rendering
//
// DES key quirk: VNC reverses the bit order of each byte in the password.
//
// L-4 roadmap — Tight (#7) and ZRLE (#16) compression are NOT implemented.
// On LAN with modern bandwidth Raw + CopyRect is acceptable; on slower links
// they would reduce traffic ~5-10×. Implementation notes for whoever picks
// this up:
//   • Both need a streaming zlib decoder — `flate2 = "1"` with the rust_backend
//     feature is the standard choice and already cross-compiles cleanly to
//     every target this app supports.
//   • Each encoding owns its own zlib stream that persists across rectangles —
//     state must live in `run_vnc_session` and outlive a single match arm.
//   • ZRLE divides the rect into 64×64 tiles, each preceded by a sub-encoding
//     byte (Raw, packed palette, plain RLE, palette RLE) and a CPIXEL (3-byte
//     compressed pixel) stream.
//   • Tight has 4 modes (basic, fill, jpeg, gradient) decided by a compression
//     control byte; basic itself has 4 sub-modes (raw, palette, gradient,
//     gradient+palette). The JPEG sub-rect needs a JPEG decoder
//     (`image = "0.24"` with the `jpeg` feature, or `zune-jpeg`).
//   • Both encodings MUST be regression-tested against several servers
//     (tigervnc, RealVNC, gnome-remote-desktop, x11vnc) — small spec details
//     differ between implementations.

use base64::Engine as _;
use serde::Serialize;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::Emitter;

// HIGH-A8: maximum bytes we are willing to allocate for a single framebuffer
// or rectangle. 64 MiB covers a 4096×4096 screen at 32 bpp with room to spare.
// A server declaring more than this is either broken or malicious.
const MAX_FB_BYTES: usize = 64 * 1024 * 1024;

// ── Events emitted to the frontend ───────────────────────

#[derive(Clone, Serialize)]
pub struct VncInitEvent {
    pub session_id: String,
    pub width: u16,
    pub height: u16,
    pub name: String,
}

#[derive(Clone, Serialize)]
pub struct VncRectEvent {
    pub session_id: String,
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    /// Base64-encoded RGBA bytes (4 bytes per pixel)
    pub data: String,
}

/// L-4 partial: CopyRect (RFB encoding #1). The server tells us "the rectangle
/// at (x, y, width, height) is identical to the rectangle currently at
/// (src_x, src_y)" — typically used for window drags and scrolling. The
/// frontend's canvas already holds those pixels, so it can blit them with
/// `ctx.drawImage(canvas, src_x, src_y, w, h, x, y, w, h)` instead of the
/// server having to re-transmit pixel data.
#[derive(Clone, Serialize)]
pub struct VncCopyRectEvent {
    pub session_id: String,
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    pub src_x: u16,
    pub src_y: u16,
}

#[derive(Clone, Serialize)]
pub struct VncStatusEvent {
    pub session_id: String,
    pub message: String,
}

// ── DES authentication (VNC password) ────────────────────

fn reverse_bits(b: u8) -> u8 {
    b.reverse_bits()
}

/// Public alias for integration tests.
pub fn vnc_des_encrypt_pub(password: &str, challenge: &[u8; 16]) -> [u8; 16] {
    vnc_des_encrypt(password, challenge)
}

fn vnc_des_encrypt(password: &str, challenge: &[u8; 16]) -> [u8; 16] {
    use des::cipher::{BlockEncrypt, KeyInit};

    let mut key = [0u8; 8];
    for (i, b) in password.as_bytes().iter().take(8).enumerate() {
        key[i] = reverse_bits(*b);
    }

    let cipher = des::Des::new(&key.into());

    // L-3 SAFETY: `challenge` is `&[u8; 16]` so the two halves are always
    // exactly 8 bytes and `try_into::<[u8; 8]>()` cannot fail.
    let mut b1: [u8; 8] = challenge[..8].try_into().expect("first 8 bytes of [u8;16]");
    let mut b2: [u8; 8] = challenge[8..].try_into().expect("last 8 bytes of [u8;16]");

    cipher.encrypt_block((&mut b1).into());
    cipher.encrypt_block((&mut b2).into());

    let mut result = [0u8; 16];
    result[..8].copy_from_slice(&b1);
    result[8..].copy_from_slice(&b2);
    result
}

// ── RFB handshake helpers ─────────────────────────────────

fn read_exact(stream: &mut TcpStream, buf: &mut [u8]) -> Result<(), String> {
    stream
        .read_exact(buf)
        .map_err(|e| format!("VNC read error: {}", e))
}

fn write_all(stream: &mut TcpStream, data: &[u8]) -> Result<(), String> {
    stream
        .write_all(data)
        .map_err(|e| format!("VNC write error: {}", e))
}

fn rfb_handshake(stream: &mut TcpStream) -> Result<(), String> {
    let mut server_ver = [0u8; 12];
    read_exact(stream, &mut server_ver)?;
    // We always request 3.8
    write_all(stream, b"RFB 003.008\n")?;
    Ok(())
}

fn rfb_security(stream: &mut TcpStream, password: &str) -> Result<(), String> {
    let mut n_buf = [0u8; 1];
    read_exact(stream, &mut n_buf)?;
    let n = n_buf[0] as usize;

    if n == 0 {
        let mut len_buf = [0u8; 4];
        read_exact(stream, &mut len_buf)?;
        let len = u32::from_be_bytes(len_buf) as usize;
        let mut msg = vec![0u8; len.min(256)];
        read_exact(stream, &mut msg)?;
        return Err(format!(
            "VNC server refused connection: {}",
            String::from_utf8_lossy(&msg)
        ));
    }

    let mut types = vec![0u8; n];
    read_exact(stream, &mut types)?;

    let chosen = if password.is_empty() && types.contains(&1) {
        1u8
    } else if types.contains(&2) {
        2u8
    } else if types.contains(&1) {
        1u8
    } else {
        return Err(format!(
            "No supported security types. Server offers: {:?}",
            types
        ));
    };

    write_all(stream, &[chosen])?;

    if chosen == 2 {
        let mut challenge = [0u8; 16];
        read_exact(stream, &mut challenge)?;
        let response = vnc_des_encrypt(password, &challenge);
        write_all(stream, &response)?;
    }

    // Security result (4 bytes, 0 = OK)
    let mut result = [0u8; 4];
    read_exact(stream, &mut result)?;
    let code = u32::from_be_bytes(result);
    if code != 0 {
        let mut len_buf = [0u8; 4];
        read_exact(stream, &mut len_buf)?;
        let len = u32::from_be_bytes(len_buf) as usize;
        let mut msg = vec![0u8; len.min(256)];
        read_exact(stream, &mut msg)?;
        return Err(format!(
            "VNC authentication failed: {}",
            String::from_utf8_lossy(&msg)
        ));
    }

    Ok(())
}

fn rfb_client_init(stream: &mut TcpStream) -> Result<(u16, u16, String), String> {
    write_all(stream, &[1u8])?; // shared session

    // ServerInit: 2 bytes width, 2 bytes height, 16 bytes pixel format, 4 bytes name length, name
    let mut init = [0u8; 24];
    read_exact(stream, &mut init)?;

    let width = u16::from_be_bytes([init[0], init[1]]);
    let height = u16::from_be_bytes([init[2], init[3]]);

    // HIGH-A8: A malicious server could declare an absurdly large framebuffer
    // (e.g. 65535×65535 = ~16 GB) to cause an OOM kill.  Cap at 64 MiB of raw
    // RGBA data (~4096×4096 at 32 bpp) before proceeding.
    let fb_bytes = (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(4);
    if fb_bytes > MAX_FB_BYTES {
        return Err(format!(
            "VNC server declared a framebuffer of {}×{} ({} bytes) which exceeds \
             the 64 MiB safety limit — refusing connection.",
            width, height, fb_bytes
        ));
    }

    let name_len = u32::from_be_bytes([init[20], init[21], init[22], init[23]]) as usize;
    let mut name_bytes = vec![0u8; name_len.min(256)];
    read_exact(stream, &mut name_bytes)?;
    // Skip any extra name bytes beyond 256
    if name_len > 256 {
        let mut extra = vec![0u8; name_len - 256];
        read_exact(stream, &mut extra)?;
    }

    let name = String::from_utf8_lossy(&name_bytes).to_string();
    Ok((width, height, name))
}

fn rfb_set_pixel_format(stream: &mut TcpStream) -> Result<(), String> {
    // Request: 32bpp, depth 24, little-endian, true colour
    // red-shift=0, green-shift=8, blue-shift=16 → bytes come out as [R, G, B, X]
    #[rustfmt::skip]
    let msg: [u8; 20] = [
        0, 0, 0, 0,   // message type 0 + 3 padding bytes
        32,           // bits per pixel
        24,           // depth
        0,            // big-endian flag (0 = little-endian)
        1,            // true-colour flag
        0, 255,       // red-max (BE u16)
        0, 255,       // green-max
        0, 255,       // blue-max
        0,            // red-shift
        8,            // green-shift
        16,           // blue-shift
        0, 0, 0,      // padding
    ];
    write_all(stream, &msg)
}

fn rfb_set_encodings(stream: &mut TcpStream) -> Result<(), String> {
    // L-4 partial: advertise CopyRect (1) in addition to Raw (0). Servers will
    // pick CopyRect for redrawn regions that simply moved (window drags,
    // scrolling), avoiding re-transmission of pixel data. ZRLE / Tight are
    // intentionally NOT advertised here — they require a zlib decoder and
    // careful handling of CPIXEL / palette / subrect formats that should be
    // validated against multiple servers (tigervnc, RealVNC, gnome-remote-
    // desktop) before shipping. See module-level docs for the roadmap.
    #[rustfmt::skip]
    let msg: [u8; 12] = [
        2,            // message type (SetEncodings)
        0,            // padding
        0, 2,         // number of encodings (BE u16)
        0, 0, 0, 1,   // CopyRect (BE i32 = 1) — listed first = higher preference
        0, 0, 0, 0,   // Raw (BE i32 = 0) — always supported, mandatory baseline
    ];
    write_all(stream, &msg)
}

fn rfb_request_update(
    stream: &mut TcpStream,
    incremental: bool,
    w: u16,
    h: u16,
) -> Result<(), String> {
    let mut msg = [0u8; 10];
    msg[0] = 3; // FramebufferUpdateRequest
    msg[1] = if incremental { 1 } else { 0 };
    // x=0, y=0
    msg[4..6].copy_from_slice(&w.to_be_bytes()); // width
    msg[6..8].copy_from_slice(&h.to_be_bytes()); // height
    write_all(stream, &msg)
}

// ── Main streaming loop ───────────────────────────────────

fn run_vnc_session(
    app: &tauri::AppHandle,
    session_id: &str,
    host: &str,
    port: i32,
    password: &str,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let addr = format!("{}:{}", host, port);
    let mut stream =
        TcpStream::connect(&addr).map_err(|e| format!("VNC TCP connect failed: {}", e))?;
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(30)))
        .ok();

    rfb_handshake(&mut stream)?;
    rfb_security(&mut stream, password)?;
    let (width, height, name) = rfb_client_init(&mut stream)?;

    let _ = app.emit(
        "vnc:init",
        VncInitEvent {
            session_id: session_id.to_string(),
            width,
            height,
            name: name.clone(),
        },
    );

    rfb_set_pixel_format(&mut stream)?;
    rfb_set_encodings(&mut stream)?;
    rfb_request_update(&mut stream, false, width, height)?;

    let bytes_per_pixel: usize = 4;

    loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }

        let mut msg_type = [0u8; 1];
        match stream.read_exact(&mut msg_type) {
            Ok(()) => {}
            Err(e)
                if e.kind() == std::io::ErrorKind::TimedOut
                    || e.kind() == std::io::ErrorKind::WouldBlock =>
            {
                // Timeout — request a refresh and try again
                rfb_request_update(&mut stream, true, width, height)?;
                continue;
            }
            Err(e) => return Err(format!("VNC stream error: {}", e)),
        }

        match msg_type[0] {
            0 => {
                // FramebufferUpdate
                let mut hdr = [0u8; 3];
                read_exact(&mut stream, &mut hdr)?;
                let n_rects = u16::from_be_bytes([hdr[1], hdr[2]]) as usize;

                for _ in 0..n_rects {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }

                    let mut rect_hdr = [0u8; 12];
                    read_exact(&mut stream, &mut rect_hdr)?;

                    let x = u16::from_be_bytes([rect_hdr[0], rect_hdr[1]]);
                    let y = u16::from_be_bytes([rect_hdr[2], rect_hdr[3]]);
                    let w = u16::from_be_bytes([rect_hdr[4], rect_hdr[5]]);
                    let h = u16::from_be_bytes([rect_hdr[6], rect_hdr[7]]);
                    let encoding =
                        i32::from_be_bytes([rect_hdr[8], rect_hdr[9], rect_hdr[10], rect_hdr[11]]);

                    if w == 0 || h == 0 {
                        continue;
                    }

                    match encoding {
                        0 => {
                            // Raw encoding: w * h * bytes_per_pixel bytes
                            // HIGH-A8: guard per-rectangle allocation too — a
                            // server can send a single rect that covers the entire
                            // screen, so the initial framebuffer check is not
                            // sufficient on its own.
                            let n_bytes = (w as usize)
                                .saturating_mul(h as usize)
                                .saturating_mul(bytes_per_pixel);
                            if n_bytes > MAX_FB_BYTES {
                                return Err(format!(
                                    "VNC rect {}×{} ({} bytes) exceeds 64 MiB safety limit",
                                    w, h, n_bytes
                                ));
                            }
                            let mut pixel_data = vec![0u8; n_bytes];
                            read_exact(&mut stream, &mut pixel_data)?;

                            // Convert [R, G, B, X] → [R, G, B, A=255] for canvas ImageData
                            for chunk in pixel_data.chunks_mut(4) {
                                chunk[3] = 255;
                            }

                            let b64 = base64::engine::general_purpose::STANDARD.encode(&pixel_data);
                            let _ = app.emit(
                                "vnc:rect",
                                VncRectEvent {
                                    session_id: session_id.to_string(),
                                    x,
                                    y,
                                    width: w,
                                    height: h,
                                    data: b64,
                                },
                            );
                        }
                        1 => {
                            // L-4 partial: CopyRect — body is 4 bytes (src_x, src_y).
                            // Tell the frontend to blit (src_x, src_y, w, h) → (x, y).
                            let mut buf = [0u8; 4];
                            read_exact(&mut stream, &mut buf)?;
                            let src_x = u16::from_be_bytes([buf[0], buf[1]]);
                            let src_y = u16::from_be_bytes([buf[2], buf[3]]);
                            let _ = app.emit(
                                "vnc:copyrect",
                                VncCopyRectEvent {
                                    session_id: session_id.to_string(),
                                    x,
                                    y,
                                    width: w,
                                    height: h,
                                    src_x,
                                    src_y,
                                },
                            );
                        }
                        _ => {
                            // Any encoding not advertised in SetEncodings shouldn't
                            // appear here. If a non-compliant server sends one we
                            // have no way to know its body size, so fail closed.
                            return Err(format!(
                                "VNC server sent unsupported encoding: {}",
                                encoding
                            ));
                        }
                    }
                }

                // Request the next incremental update
                rfb_request_update(&mut stream, true, width, height)?;
            }
            2 => {
                // Bell — ignore
            }
            3 => {
                // ServerCutText
                let mut hdr = [0u8; 7];
                read_exact(&mut stream, &mut hdr)?;
                let len = u32::from_be_bytes([hdr[3], hdr[4], hdr[5], hdr[6]]) as usize;
                let mut text = vec![0u8; len.min(65536)];
                read_exact(&mut stream, &mut text)?;
            }
            t => {
                return Err(format!("VNC: unexpected server message type {}", t));
            }
        }
    }

    Ok(())
}

// ── Tauri commands ────────────────────────────────────────

pub struct VncSession {
    pub cancel: Arc<AtomicBool>,
}

/// CRIT-A4: `connection_id` replaces explicit `host`, `port`, `password`.
/// Credentials are resolved server-side; plaintext passwords never cross the IPC boundary.
#[tauri::command]
pub async fn vnc_native_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    connection_id: String,
) -> Result<(), String> {
    use crate::commands::credentials::resolve_credentials_internal;

    // ── Look up connection + resolve credentials ────────────
    let conn = state.db.get().map_err(|e| format!("DB pool: {}", e))?;
    let all_conns =
        crate::database::get_connections(&conn).map_err(|e| format!("DB read: {}", e))?;
    let connection = all_conns
        .into_iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    let host = connection.host.clone();
    let port = connection.port;

    let key_guard = state
        .encryption_key
        .read()
        .map_err(|e| format!("Lock: {}", e))?;
    let master_key = key_guard.as_ref().ok_or("Vault locked")?;
    let creds = resolve_credentials_internal(&conn, master_key, &connection_id)
        .map_err(|e| format!("Resolve creds: {}", e))?;
    drop(key_guard);
    drop(conn);

    let pw = creds.password_decrypted.unwrap_or_default();

    // ── Stop any existing session with the same ID ──────────
    if let Some(existing) = state.vnc_sessions.get(&session_id) {
        existing.cancel.store(true, Ordering::Relaxed);
    }

    let cancel = Arc::new(AtomicBool::new(false));
    state.vnc_sessions.insert(
        session_id.clone(),
        VncSession {
            cancel: Arc::clone(&cancel),
        },
    );

    let app_clone = app.clone();
    let sid = session_id.clone();

    std::thread::spawn(move || {
        let result = run_vnc_session(&app_clone, &sid, &host, port, &pw, &cancel);
        if let Err(e) = result {
            let _ = app_clone.emit(
                "vnc:error",
                VncStatusEvent {
                    session_id: sid.clone(),
                    message: e,
                },
            );
        }
        let _ = app_clone.emit(
            "vnc:disconnected",
            VncStatusEvent {
                session_id: sid,
                message: "Disconnected".to_string(),
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn vnc_native_disconnect(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
) -> Result<(), String> {
    if let Some(session) = state.vnc_sessions.get(&session_id) {
        session.cancel.store(true, Ordering::Relaxed);
    }
    state.vnc_sessions.remove(&session_id);
    Ok(())
}

#[tauri::command]
pub fn vnc_native_key_event(
    _state: tauri::State<'_, crate::state::AppState>,
    _session_id: String,
    _key: u32,
    _down: bool,
) -> Result<(), String> {
    // Input events require a persistent write handle to the VNC stream.
    // For the initial implementation, keyboard/mouse input is deferred.
    // Future: store Arc<Mutex<TcpStream>> in VncSession and write KeyEvent messages.
    Ok(())
}
