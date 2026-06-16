use crate::error::AppError;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::Mutex as TokioMutex;
use ts_rs::TS;

// ── Types ─────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone, TS)]
pub struct DockerContainer {
    #[serde(rename = "Id")]
    pub id: String,
    #[serde(default)]
    #[serde(rename = "Names")]
    pub names: Vec<String>,
    #[serde(rename = "Image")]
    pub image: String,
    #[serde(rename = "State")]
    pub state: String,
    #[serde(rename = "Status")]
    pub status: String,
}

#[derive(Clone, Serialize)]
pub struct DockerExecDataEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
pub struct DockerExecStatusEvent {
    pub session_id: String,
    pub status: String,
    pub message: String,
}

pub struct DockerExecSession {
    pub exec_id: String,
    // Boxed AsyncWrite so the session can wrap either a raw TCP half (plaintext
    // transport on 2375) or a TLS-encrypted half (mutual-TLS transport on 2376).
    pub writer: Arc<TokioMutex<Option<Box<dyn AsyncWrite + Unpin + Send>>>>,
}

// ── HTTP client ───────────────────────────────────────────

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

fn http_client() -> &'static Client {
    HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| Client::new())
    })
}

// ── H-3: mutual-TLS transport (Docker daemon port 2376) ──────────────────────
//
// Reads CA + client cert + client key PEM files from disk and builds the
// objects needed to talk to a TLS-protected Docker daemon. The CA is added as
// a root trust anchor (so the daemon's cert is verified by the supplied CA);
// the client identity is presented for mutual auth. Hostname verification is
// relaxed because Docker daemon certs usually carry CN = the daemon hostname,
// not the IP/host the user types — the chain-against-supplied-CA is the
// security guarantee.

#[allow(clippy::type_complexity)]
fn read_docker_tls_files(
    ca_path: Option<&str>,
    cert_path: Option<&str>,
    key_path: Option<&str>,
) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), AppError> {
    let ca = ca_path.ok_or_else(|| {
        AppError::Validation("Docker HTTPS transport requires a CA certificate path".to_string())
    })?;
    let cert = cert_path.ok_or_else(|| {
        AppError::Validation(
            "Docker HTTPS transport requires a client certificate path".to_string(),
        )
    })?;
    let key = key_path.ok_or_else(|| {
        AppError::Validation("Docker HTTPS transport requires a client key path".to_string())
    })?;
    let ca_pem = std::fs::read(ca)
        .map_err(|e| AppError::Validation(format!("Cannot read Docker CA at {}: {}", ca, e)))?;
    let cert_pem = std::fs::read(cert).map_err(|e| {
        AppError::Validation(format!("Cannot read Docker client cert at {}: {}", cert, e))
    })?;
    let key_pem = std::fs::read(key).map_err(|e| {
        AppError::Validation(format!("Cannot read Docker client key at {}: {}", key, e))
    })?;
    Ok((ca_pem, cert_pem, key_pem))
}

fn build_docker_https_client(
    ca_path: Option<&str>,
    cert_path: Option<&str>,
    key_path: Option<&str>,
) -> Result<Client, AppError> {
    let (ca_pem, cert_pem, key_pem) = read_docker_tls_files(ca_path, cert_path, key_path)?;

    let ca = reqwest::Certificate::from_pem(&ca_pem)
        .map_err(|e| AppError::Validation(format!("Invalid Docker CA certificate: {}", e)))?;

    // reqwest with the native-tls backend builds the client identity from
    // (PEM-encoded cert chain, PEM-encoded PKCS#8 key).
    let identity = reqwest::Identity::from_pkcs8_pem(&cert_pem, &key_pem)
        .map_err(|e| AppError::Validation(format!("Invalid Docker client identity: {}", e)))?;

    Client::builder()
        .add_root_certificate(ca)
        .identity(identity)
        .danger_accept_invalid_hostnames(true)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build Docker TLS client: {}", e)))
}

fn build_docker_tls_connector(
    ca_path: Option<&str>,
    cert_path: Option<&str>,
    key_path: Option<&str>,
) -> Result<tokio_native_tls::TlsConnector, AppError> {
    let (ca_pem, cert_pem, key_pem) = read_docker_tls_files(ca_path, cert_path, key_path)?;

    let ca = native_tls::Certificate::from_pem(&ca_pem)
        .map_err(|e| AppError::Validation(format!("Invalid Docker CA certificate: {}", e)))?;
    let identity = native_tls::Identity::from_pkcs8(&cert_pem, &key_pem)
        .map_err(|e| AppError::Validation(format!("Invalid Docker client identity: {}", e)))?;
    let connector = native_tls::TlsConnector::builder()
        .add_root_certificate(ca)
        .identity(identity)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| AppError::Internal(format!("Failed to build Docker TLS connector: {}", e)))?;
    Ok(tokio_native_tls::TlsConnector::from(connector))
}

/// Build the HTTP client to use for a Docker request. Returns the global
/// plaintext client for "tcp" and a freshly-built TLS-pinned client for "https".
/// `Client` clones cheaply (Arc inside).
fn docker_http_client(
    transport: &str,
    ca_path: Option<&str>,
    cert_path: Option<&str>,
    key_path: Option<&str>,
) -> Result<Client, AppError> {
    if transport == "https" {
        build_docker_https_client(ca_path, cert_path, key_path)
    } else {
        Ok(http_client().clone())
    }
}

fn docker_url_for(transport: &str, host: &str, port: u16, path: &str) -> String {
    let scheme = if transport == "https" {
        "https"
    } else {
        "http"
    };
    format!("{}://{}:{}{}", scheme, host, port, path)
}

// 90-13: Unix socket HTTP helper (Linux/macOS only)
#[cfg(unix)]
async fn docker_unix_request(
    socket_path: &str,
    method: &str,
    api_path: &str,
    body: Option<&str>,
) -> Result<(u16, Vec<u8>), AppError> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixStream;

    let mut stream = UnixStream::connect(socket_path).await.map_err(|e| {
        AppError::Network(format!(
            "Docker socket connect failed ({}): {}",
            socket_path, e
        ))
    })?;

    let body_str = body.unwrap_or("");
    let request = format!(
        "{} {} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        method, api_path, body_str.len(), body_str
    );

    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|e| AppError::Network(format!("Socket write error: {}", e)))?;
    stream.flush().await.ok();

    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .await
        .map_err(|e| AppError::Network(format!("Socket read error: {}", e)))?;

    // Find header/body boundary
    let split = response
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|p| p + 4)
        .unwrap_or(response.len());
    let header = String::from_utf8_lossy(&response[..split]).to_string();
    let status = header
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(0);

    // Unchunk if Transfer-Encoding: chunked
    let body_bytes = if header
        .to_ascii_lowercase()
        .contains("transfer-encoding: chunked")
    {
        unchunk_bytes(&response[split..])
    } else {
        response[split..].to_vec()
    };

    Ok((status, body_bytes))
}

#[cfg(unix)]
fn unchunk_bytes(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::new();
    let mut pos = 0;
    while pos < data.len() {
        // Find end of chunk size line
        let Some(lf) = data[pos..].iter().position(|&b| b == b'\n') else {
            break;
        };
        let size_line = String::from_utf8_lossy(&data[pos..pos + lf])
            .trim()
            .trim_end_matches('\r')
            .to_string();
        let chunk_size =
            usize::from_str_radix(size_line.split(';').next().unwrap_or("0"), 16).unwrap_or(0);
        pos += lf + 1;
        if chunk_size == 0 {
            break;
        }
        if pos + chunk_size > data.len() {
            result.extend_from_slice(&data[pos..]);
            break;
        }
        result.extend_from_slice(&data[pos..pos + chunk_size]);
        pos += chunk_size + 2; // skip trailing \r\n
    }
    result
}

// ── Log parsing ───────────────────────────────────────────

/// Demultiplex Docker's log stream format.
/// Each frame: 1 byte stream type + 3 zero bytes + 4 bytes BE size + N bytes data.
/// Returns None if the data doesn't look like multiplexed format.
fn parse_docker_logs(data: &[u8]) -> Option<String> {
    if data.len() < 8 {
        return None;
    }
    // Validate first frame header: stream type must be 1 (stdout) or 2 (stderr), padding must be 0
    let stream_type = data[0];
    if (stream_type != 1 && stream_type != 2) || data[1] != 0 || data[2] != 0 || data[3] != 0 {
        return None;
    }

    let mut output = String::new();
    let mut pos = 0;
    while pos + 8 <= data.len() {
        let st = data[pos];
        let length =
            u32::from_be_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]])
                as usize;
        pos += 8;
        if pos + length > data.len() {
            break;
        }
        if st == 1 || st == 2 {
            output.push_str(&String::from_utf8_lossy(&data[pos..pos + length]));
        }
        pos += length;
    }
    Some(output)
}

// ── Commands ──────────────────────────────────────────────

#[tauri::command]
pub async fn docker_get_containers(
    host: String,
    port: u16,
    transport: Option<String>,
    _socket_path: Option<String>,
    tls_ca_path: Option<String>,
    tls_cert_path: Option<String>,
    tls_key_path: Option<String>,
) -> Result<Vec<DockerContainer>, AppError> {
    let transport_str = transport.as_deref().unwrap_or("tcp");
    let use_socket = transport_str == "socket";

    #[cfg(windows)]
    if use_socket {
        return Err(AppError::Validation(
            "Unix socket transport is not supported on Windows. \
             Please use TCP transport instead."
                .to_string(),
        ));
    }

    #[cfg(unix)]
    if use_socket {
        let sock = _socket_path.as_deref().unwrap_or("/var/run/docker.sock");
        let (status, body) =
            docker_unix_request(sock, "GET", "/containers/json?all=1", None).await?;
        if status == 0 || status >= 400 {
            return Err(AppError::Network(format!(
                "Docker socket request failed ({})",
                status
            )));
        }
        return serde_json::from_slice(&body)
            .map_err(|e| AppError::Internal(format!("Parse error: {}", e)));
    }

    let client = docker_http_client(
        transport_str,
        tls_ca_path.as_deref(),
        tls_cert_path.as_deref(),
        tls_key_path.as_deref(),
    )?;
    let url = docker_url_for(transport_str, &host, port, "/containers/json?all=1");
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Request failed: {}", e)))?;
    if !res.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to fetch containers. Status: {}",
            res.status()
        )));
    }
    res.json()
        .await
        .map_err(|e| AppError::Internal(format!("Parse error: {}", e)))
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn docker_container_action(
    host: String,
    port: u16,
    container_id: String,
    action: String,
    transport: Option<String>,
    _socket_path: Option<String>,
    tls_ca_path: Option<String>,
    tls_cert_path: Option<String>,
    tls_key_path: Option<String>,
) -> Result<String, AppError> {
    let valid_actions = ["start", "stop", "restart"];
    if !valid_actions.contains(&action.as_str()) {
        return Err(AppError::Validation(format!("Invalid action: {}", action)));
    }

    let transport_str = transport.as_deref().unwrap_or("tcp");
    let use_socket = transport_str == "socket";

    #[cfg(windows)]
    if use_socket {
        return Err(AppError::Validation(
            "Unix socket transport is not supported on Windows. \
             Please use TCP transport instead."
                .to_string(),
        ));
    }

    #[cfg(unix)]
    if use_socket {
        let sock = _socket_path.as_deref().unwrap_or("/var/run/docker.sock");
        let api_path = format!("/containers/{}/{}", container_id, action);
        let (status, _) = docker_unix_request(sock, "POST", &api_path, Some("{}")).await?;
        if status >= 400 {
            return Err(AppError::Network(format!(
                "Action failed on socket ({})",
                status
            )));
        }
        return Ok("Action initiated successfully".to_string());
    }

    let client = docker_http_client(
        transport_str,
        tls_ca_path.as_deref(),
        tls_cert_path.as_deref(),
        tls_key_path.as_deref(),
    )?;
    let url = docker_url_for(
        transport_str,
        &host,
        port,
        &format!("/containers/{}/{}", container_id, action),
    );
    let res = client
        .post(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Request failed: {}", e)))?;
    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(AppError::Network(format!(
            "Action failed. Status: {} - {}",
            status, err_text
        )));
    }
    Ok("Action initiated successfully".to_string())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn docker_get_logs(
    host: String,
    port: u16,
    container_id: String,
    tail: Option<u32>,
    transport: Option<String>,
    _socket_path: Option<String>,
    tls_ca_path: Option<String>,
    tls_cert_path: Option<String>,
    tls_key_path: Option<String>,
) -> Result<String, AppError> {
    let tail_n = tail.unwrap_or(300);
    let api_path = format!(
        "/containers/{}/logs?stdout=1&stderr=1&tail={}",
        container_id, tail_n
    );
    let transport_str = transport.as_deref().unwrap_or("tcp");
    let use_socket = transport_str == "socket";

    #[cfg(windows)]
    if use_socket {
        return Err(AppError::Validation(
            "Unix socket transport is not supported on Windows. \
             Please use TCP transport instead."
                .to_string(),
        ));
    }

    #[cfg(unix)]
    if use_socket {
        let sock = _socket_path.as_deref().unwrap_or("/var/run/docker.sock");
        let (status, body) = docker_unix_request(sock, "GET", &api_path, None).await?;
        if status >= 400 {
            return Err(AppError::Network(format!(
                "Logs request failed ({})",
                status
            )));
        }
        return Ok(
            parse_docker_logs(&body).unwrap_or_else(|| String::from_utf8_lossy(&body).to_string())
        );
    }

    let client = docker_http_client(
        transport_str,
        tls_ca_path.as_deref(),
        tls_cert_path.as_deref(),
        tls_key_path.as_deref(),
    )?;
    let url = docker_url_for(transport_str, &host, port, &api_path);
    tracing::debug!(
        "Docker logs: container={} tail={} transport={}",
        container_id,
        tail_n,
        transport_str
    );
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Request failed: {}", e)))?;
    if !res.status().is_success() {
        return Err(AppError::Network(format!(
            "Failed to fetch logs. Status: {}",
            res.status()
        )));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read response: {}", e)))?;
    Ok(parse_docker_logs(&bytes).unwrap_or_else(|| String::from_utf8_lossy(&bytes).to_string()))
}

/// Create an exec instance and attach via raw TCP (Docker hijack protocol).
/// Returns the exec_id so the frontend can issue resize requests.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn docker_exec_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    host: String,
    port: u16,
    container_id: String,
    session_id: String,
    transport: Option<String>,
    tls_ca_path: Option<String>,
    tls_cert_path: Option<String>,
    tls_key_path: Option<String>,
) -> Result<String, AppError> {
    use tokio::net::TcpStream;

    let transport_str = transport.as_deref().unwrap_or("tcp").to_string();
    let use_tls = transport_str == "https";

    tracing::info!(
        "Docker exec start: container={} session={} transport={}",
        container_id,
        session_id,
        transport_str
    );

    // Step 1: Create exec instance over HTTP(S)
    let http_client_local = docker_http_client(
        &transport_str,
        tls_ca_path.as_deref(),
        tls_cert_path.as_deref(),
        tls_key_path.as_deref(),
    )?;
    let create_url = docker_url_for(
        &transport_str,
        &host,
        port,
        &format!("/containers/{}/exec", container_id),
    );
    let create_body = serde_json::json!({
        "AttachStdin": true,
        "AttachStdout": true,
        "AttachStderr": true,
        "Tty": true,
        "Cmd": [
            "/bin/sh", "-c",
            "TERM=xterm-256color; export TERM; [ -x /bin/bash ] && exec /bin/bash || exec /bin/sh"
        ]
    });

    let create_res = http_client_local
        .post(&create_url)
        .json(&create_body)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Failed to create exec instance: {}", e)))?;

    if !create_res.status().is_success() {
        let status = create_res.status();
        let body = create_res.text().await.unwrap_or_default();
        return Err(AppError::Network(format!(
            "Exec create failed ({}): {}",
            status, body
        )));
    }

    let create_data: serde_json::Value = create_res
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse exec response: {}", e)))?;

    let exec_id = create_data["Id"]
        .as_str()
        .ok_or_else(|| AppError::Internal("Missing exec Id in response".to_string()))?
        .to_string();

    // Step 2: open the underlying TCP socket and, if HTTPS, wrap it in TLS.
    // The same code path then issues the raw HTTP upgrade and splits the stream.
    let start_body = r#"{"Detach":false,"Tty":true}"#;
    let http_request = format!(
        "POST /exec/{}/start HTTP/1.1\r\n\
         Host: {}:{}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: Upgrade\r\n\
         Upgrade: tcp\r\n\
         \r\n\
         {}",
        exec_id,
        host,
        port,
        start_body.len(),
        start_body
    );

    let tcp = TcpStream::connect(format!("{}:{}", host, port))
        .await
        .map_err(|e| AppError::Network(format!("TCP connect to Docker failed: {}", e)))?;

    // Boxed halves so the rest of the function and the session map don't care
    // whether the transport is plaintext or TLS-wrapped.
    let (mut reader_boxed, mut writer_boxed): (
        Box<dyn AsyncRead + Unpin + Send>,
        Box<dyn AsyncWrite + Unpin + Send>,
    ) = if use_tls {
        let connector = build_docker_tls_connector(
            tls_ca_path.as_deref(),
            tls_cert_path.as_deref(),
            tls_key_path.as_deref(),
        )?;
        let tls = connector
            .connect(&host, tcp)
            .await
            .map_err(|e| AppError::Network(format!("Docker TLS handshake failed: {}", e)))?;
        let (r, w) = tokio::io::split(tls);
        (Box::new(r), Box::new(w))
    } else {
        let (r, w) = tcp.into_split();
        (Box::new(r), Box::new(w))
    };

    writer_boxed
        .write_all(http_request.as_bytes())
        .await
        .map_err(|e| AppError::Network(format!("Failed to send HTTP upgrade request: {}", e)))?;

    // Step 3: Read HTTP response headers until \r\n\r\n
    let mut header_buf = Vec::with_capacity(512);
    let mut byte = [0u8; 1];
    loop {
        reader_boxed
            .read_exact(&mut byte)
            .await
            .map_err(|e| AppError::Network(format!("Failed to read exec response: {}", e)))?;
        header_buf.push(byte[0]);
        if header_buf.ends_with(b"\r\n\r\n") {
            break;
        }
        if header_buf.len() > 8192 {
            return Err(AppError::Internal(
                "HTTP response header too large".to_string(),
            ));
        }
    }

    let header_str = String::from_utf8_lossy(&header_buf);
    // Docker returns "101 UPGRADED" or "200 OK" depending on version
    if !header_str.starts_with("HTTP/1.1 101") && !header_str.starts_with("HTTP/1.1 200") {
        return Err(AppError::Network(format!(
            "Unexpected Docker exec response: {}",
            header_str.lines().next().unwrap_or("")
        )));
    }

    // Step 4: hand the (already boxed) halves to the session map / reader task
    let writer_arc: Arc<TokioMutex<Option<Box<dyn AsyncWrite + Unpin + Send>>>> =
        Arc::new(TokioMutex::new(Some(writer_boxed)));
    state.docker_exec_sessions.insert(
        session_id.clone(),
        DockerExecSession {
            exec_id: exec_id.clone(),
            writer: writer_arc,
        },
    );

    let _ = app.emit(
        &format!("docker:status:{}", session_id),
        DockerExecStatusEvent {
            session_id: session_id.clone(),
            status: "connected".to_string(),
            message: "Exec session started".to_string(),
        },
    );

    // Step 5: Spawn reader task — forwards output as Tauri events
    let app_clone = app.clone();
    let sid = session_id.clone();

    tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match reader_boxed.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    // M2: feed output into the asciicast recorder if active.
                    {
                        use tauri::Manager;
                        if let Some(rec) =
                            app_clone.state::<crate::state::AppState>().recording_sessions.get(&sid)
                        {
                            if let Ok(mut g) = rec.lock() {
                                let t = g.start_time.elapsed().as_secs_f64();
                                g.events.push((t, 'o', data.clone()));
                            }
                        }
                    }
                    let _ = app_clone.emit(
                        &format!("docker:data:{}", sid),
                        DockerExecDataEvent {
                            session_id: sid.clone(),
                            data,
                        },
                    );
                }
                Err(e) => {
                    tracing::debug!("Docker exec read error session={}: {}", sid, e);
                    break;
                }
            }
        }
        tracing::info!("Docker exec ended: session={}", sid);
        let _ = app_clone.emit(
            &format!("docker:status:{}", sid),
            DockerExecStatusEvent {
                session_id: sid.clone(),
                status: "disconnected".to_string(),
                message: "Exec session ended".to_string(),
            },
        );
    });

    Ok(exec_id)
}

#[tauri::command]
pub async fn docker_exec_input(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
    data: String,
) -> Result<(), AppError> {
    // HIGH-A4: clone the Arc *before* the await so the DashMap shard lock
    // (held by the Ref returned from .get()) is released immediately.
    // Holding a DashMap Ref across an .await would lock the shard for the
    // duration of the write, blocking all concurrent inserts on that shard.
    let writer = state
        .docker_exec_sessions
        .get(&session_id)
        .ok_or_else(|| AppError::NotFound(format!("Exec session '{}' not found", session_id)))?
        .writer
        .clone(); // Arc clone — DashMap Ref is dropped here

    let mut guard = writer.lock().await;
    if let Some(ref mut w) = *guard {
        w.write_all(data.as_bytes())
            .await
            .map_err(|e| AppError::Network(format!("Write failed: {}", e)))?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn docker_exec_resize(
    host: String,
    port: u16,
    exec_id: String,
    rows: u16,
    cols: u16,
    transport: Option<String>,
    tls_ca_path: Option<String>,
    tls_cert_path: Option<String>,
    tls_key_path: Option<String>,
) -> Result<(), AppError> {
    let transport_str = transport.as_deref().unwrap_or("tcp");
    let client = docker_http_client(
        transport_str,
        tls_ca_path.as_deref(),
        tls_cert_path.as_deref(),
        tls_key_path.as_deref(),
    )?;
    let url = docker_url_for(
        transport_str,
        &host,
        port,
        &format!("/exec/{}/resize?h={}&w={}", exec_id, rows, cols),
    );
    client
        .post(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(format!("Resize request failed: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub async fn docker_exec_stop(
    state: tauri::State<'_, crate::state::AppState>,
    session_id: String,
) -> Result<(), AppError> {
    if let Some((_, session)) = state.docker_exec_sessions.remove(&session_id) {
        let mut guard = session.writer.lock().await;
        *guard = None; // Dropping the writer closes the TCP connection
    }
    tracing::info!("Docker exec stopped: session={}", session_id);
    Ok(())
}
