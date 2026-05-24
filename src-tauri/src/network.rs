use serde::Serialize;
use ts_rs::TS;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::str::FromStr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

// ── Types ─────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone, TS)]
pub struct NetworkScanResult {
    pub ip: String,
    pub hostname: String,
    pub ssh: bool,
    pub telnet: bool,
    pub http: bool,
    pub https: bool,
    pub rlogin: bool,
    pub rdp: bool,
    pub vnc: bool,
    pub open_ports: Vec<u16>,
    pub closed_ports: Vec<u16>,
}

#[derive(Clone, Serialize)]
pub struct NetworkScanProgress {
    pub scan_id: String,
    pub scanned: usize,
    pub total: usize,
    pub percent: u8,
    /// Present only when the scanned host has at least one open port.
    pub result: Option<NetworkScanResult>,
    pub done: bool,
    pub cancelled: bool,
}

// ── Helpers ───────────────────────────────────────────────

fn ipv4_to_u32(ip: Ipv4Addr) -> u32 {
    u32::from(ip)
}

fn u32_to_ipv4(ip: u32) -> Ipv4Addr {
    Ipv4Addr::from(ip)
}

fn scan_single_ip(ip_addr: IpAddr, ports: &[u16], timeout: Duration) -> NetworkScanResult {
    let ip_str = ip_addr.to_string();
    let mut open = Vec::new();
    let mut closed = Vec::new();

    for &port in ports {
        let addr = SocketAddr::new(ip_addr, port);
        if TcpStream::connect_timeout(&addr, timeout).is_ok() {
            open.push(port);
        } else {
            closed.push(port);
        }
    }

    NetworkScanResult {
        ip: ip_str,
        hostname: String::new(),
        ssh: open.contains(&22),
        telnet: open.contains(&23),
        http: open.contains(&80),
        https: open.contains(&443),
        rlogin: open.contains(&513),
        rdp: open.contains(&3389),
        vnc: open.contains(&5900) || open.contains(&5901),
        open_ports: open,
        closed_ports: closed,
    }
}

// ── Commands ──────────────────────────────────────────────

/// Start an async network scan. Returns immediately; results stream via
/// `network:progress:{scan_id}` Tauri events as each host is scanned.
///
/// Each event payload is `NetworkScanProgress`:
///   - `result`: Some(host) only when the host has ≥1 open port
///   - `done`:   true on the final event
///   - `cancelled`: true if the scan was aborted via `cancel_network_scan`
#[tauri::command]
pub async fn scan_network(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    scan_id: String,
    start_ip: String,
    end_ip: String,
    ports: Vec<u16>,
    timeout_ms: u64,
) -> Result<(), String> {
    let start = Ipv4Addr::from_str(&start_ip)
        .map_err(|e| format!("Invalid start IP: {}", e))?;
    let end = Ipv4Addr::from_str(&end_ip)
        .map_err(|e| format!("Invalid end IP: {}", e))?;

    let start_int = ipv4_to_u32(start);
    let end_int = ipv4_to_u32(end);

    if start_int > end_int {
        return Err("Start IP must be ≤ End IP".into());
    }
    if end_int - start_int > 2048 {
        return Err("Max 2048 IPs per scan".into());
    }

    let total = (end_int - start_int + 1) as usize;
    let timeout = Duration::from_millis(timeout_ms.max(50));

    // LOW-A8: Each scan gets its own cancellation flag so multiple concurrent
    // scans can be cancelled independently without a global race condition.
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    state.network_scan_cancel.insert(scan_id.clone(), Arc::clone(&cancel));

    tracing::info!(
        "Network scan started: scan_id={} range={}-{} total={}",
        scan_id,
        start_ip,
        end_ip,
        total
    );

    tokio::spawn(async move {
        // Use an mpsc channel so results stream back in completion order
        // rather than waiting for all tasks to finish.
        let (tx, mut rx) = tokio::sync::mpsc::channel::<NetworkScanResult>(64);

        // Spawn one blocking task per IP
        for ip_int in start_int..=end_int {
            let tx = tx.clone();
            let ports = ports.clone();
            tokio::task::spawn_blocking(move || {
                let ip_addr = IpAddr::V4(u32_to_ipv4(ip_int));
                let res = scan_single_ip(ip_addr, &ports, timeout);
                let _ = tx.blocking_send(res);
            });
        }
        // Drop our copy of the sender so the channel closes once all tasks finish
        drop(tx);

        // Collect results as they arrive, emitting a progress event per host
        let mut scanned = 0usize;
        while let Some(res) = rx.recv().await {
            scanned += 1;
            let percent = ((scanned as f32 / total as f32) * 100.0) as u8;
            let has_open = !res.open_ports.is_empty();

            let _ = app.emit(
                &format!("network:progress:{}", scan_id),
                NetworkScanProgress {
                    scan_id: scan_id.clone(),
                    scanned,
                    total,
                    percent,
                    result: if has_open { Some(res) } else { None },
                    done: false,
                    cancelled: false,
                },
            );

            if cancel.load(Ordering::Relaxed) {
                tracing::info!("Network scan cancelled: scan_id={} scanned={}/{}", scan_id, scanned, total);
                let _ = app.emit(
                    &format!("network:progress:{}", scan_id),
                    NetworkScanProgress {
                        scan_id: scan_id.clone(),
                        scanned,
                        total,
                        percent,
                        result: None,
                        done: true,
                        cancelled: true,
                    },
                );
                // LOW-A8: clean up this scan's cancel flag from the DashMap
                use tauri::Manager;
                app.state::<crate::state::AppState>().network_scan_cancel.remove(&scan_id);
                return;
            }
        }

        tracing::info!("Network scan complete: scan_id={} total={}", scan_id, total);
        let _ = app.emit(
            &format!("network:progress:{}", scan_id),
            NetworkScanProgress {
                scan_id: scan_id.clone(),
                scanned,
                total,
                percent: 100,
                result: None,
                done: true,
                cancelled: false,
            },
        );
        // LOW-A8: clean up this scan's cancel flag
        use tauri::Manager;
        app.state::<crate::state::AppState>().network_scan_cancel.remove(&scan_id);
    });

    Ok(())
}

/// Abort a specific network scan by scan_id. The scan task will stop after
/// processing the current in-flight IP and emit a final `cancelled=true` event.
/// LOW-A8: Takes an explicit scan_id so concurrent scans can each be
/// cancelled independently.
#[tauri::command]
pub async fn cancel_network_scan(
    state: tauri::State<'_, crate::state::AppState>,
    scan_id: String,
) -> Result<(), String> {
    if let Some(flag) = state.network_scan_cancel.get(&scan_id) {
        flag.store(true, Ordering::Relaxed);
        tracing::info!("Network scan cancellation requested: scan_id={}", scan_id);
    } else {
        tracing::warn!("cancel_network_scan: unknown scan_id={}", scan_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn ping_server(host: String, port: u16) -> Result<u64, String> {
    let addr_str = format!("{}:{}", host, port);

    let mut addrs = addr_str
        .to_socket_addrs()
        .map_err(|e| format!("DNS resolution failed: {}", e))?;

    let addr = addrs
        .next()
        .ok_or("Could not resolve hostname to an IP address")?;

    let start = Instant::now();
    let timeout = Duration::from_millis(5000);

    match tokio::task::spawn_blocking(move || TcpStream::connect_timeout(&addr, timeout)).await {
        Ok(Ok(_)) => Ok(start.elapsed().as_millis() as u64),
        Ok(Err(e)) => Err(format!("TCP connection timeout or refused: {}", e)),
        Err(e) => Err(format!("Thread executor failed: {}", e)),
    }
}
