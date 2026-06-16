use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::str::FromStr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;
use ts_rs::TS;

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
    let start = Ipv4Addr::from_str(&start_ip).map_err(|e| format!("Invalid start IP: {}", e))?;
    let end = Ipv4Addr::from_str(&end_ip).map_err(|e| format!("Invalid end IP: {}", e))?;

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
    state
        .network_scan_cancel
        .insert(scan_id.clone(), Arc::clone(&cancel));

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
                tracing::info!(
                    "Network scan cancelled: scan_id={} scanned={}/{}",
                    scan_id,
                    scanned,
                    total
                );
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
                app.state::<crate::state::AppState>()
                    .network_scan_cancel
                    .remove(&scan_id);
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
        app.state::<crate::state::AppState>()
            .network_scan_cancel
            .remove(&scan_id);
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

/// A single traceroute hop. `ip` is empty when the hop timed out (`* * *`).
#[derive(Serialize, Clone)]
pub struct TracerouteHop {
    pub hop: u32,
    pub ip: String,
    pub rtt_ms: Option<u32>,
}

/// Runs the OS `tracert` (Windows) / `traceroute` (Unix) and parses hops.
/// Parsing is language-independent: it extracts the leading hop number and the
/// first IPv4 address on each line via regex, so localized tool output works.
#[tauri::command]
pub async fn traceroute(host: String, max_hops: Option<u32>) -> Result<Vec<TracerouteHop>, String> {
    let max = max_hops.unwrap_or(20).clamp(1, 30);

    tokio::task::spawn_blocking(move || {
        use std::process::Command;

        let output = if cfg!(windows) {
            Command::new("tracert")
                .args(["-d", "-h", &max.to_string(), "-w", "1500", &host])
                .output()
        } else {
            Command::new("traceroute")
                .args(["-n", "-m", &max.to_string(), "-w", "2", &host])
                .output()
        }
        .map_err(|e| format!("Failed to launch traceroute: {}", e))?;

        // Windows tracert emits OEM-codepage text; lossy UTF-8 is fine since we
        // only parse ASCII digits/dots.
        let text = String::from_utf8_lossy(&output.stdout);
        let ip_re = regex::Regex::new(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b").unwrap();
        let ms_re = regex::Regex::new(r"(\d+)\s*ms").unwrap();

        let mut hops = Vec::new();
        for line in text.lines() {
            let trimmed = line.trim_start();
            // A hop line starts with the hop index.
            let hop_num = trimmed
                .split_whitespace()
                .next()
                .and_then(|t| t.parse::<u32>().ok());
            let Some(hop) = hop_num else { continue };
            if hop == 0 || hop > max {
                continue;
            }
            let ip = ip_re
                .captures(trimmed)
                .map(|c| c[1].to_string())
                .unwrap_or_default();
            let rtt_ms = ms_re
                .captures(trimmed)
                .and_then(|c| c[1].parse::<u32>().ok());
            hops.push(TracerouteHop { hop, ip, rtt_ms });
        }

        if hops.is_empty() {
            return Err(
                "traceroute produced no parsable hops (tool missing or host unreachable)".into(),
            );
        }
        Ok(hops)
    })
    .await
    .map_err(|e| format!("Thread executor failed: {}", e))?
}

/// Checks a password against the Have I Been Pwned breach corpus using the
/// k-anonymity range API: only the first 5 chars of the SHA-1 hash leave the
/// machine, never the password. Returns how many breaches contain it (0 = clean).
#[tauri::command]
pub async fn check_password_breach(password: String) -> Result<u64, String> {
    use sha1::{Digest, Sha1};

    let digest = Sha1::digest(password.as_bytes());
    let hash = format!("{:X}", digest); // uppercase hex, as HIBP expects
    let (prefix, suffix) = hash.split_at(5);

    let url = format!("https://api.pwnedpasswords.com/range/{}", prefix);
    let body = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", "NexoRC-password-check")
        .send()
        .await
        .map_err(|e| format!("HIBP request failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("HIBP read failed: {}", e))?;

    // Each line: "<SUFFIX>:<COUNT>". Match our suffix case-insensitively.
    for line in body.lines() {
        if let Some((suf, count)) = line.split_once(':') {
            if suf.eq_ignore_ascii_case(suffix) {
                return Ok(count.trim().parse::<u64>().unwrap_or(0));
            }
        }
    }
    Ok(0)
}

/// Forward DNS: resolves a hostname to all its IP addresses.
#[tauri::command]
pub async fn dns_lookup(host: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        // Port is irrelevant for resolution; ToSocketAddrs needs one.
        let ips: Vec<String> = format!("{}:0", host)
            .to_socket_addrs()
            .map_err(|e| format!("DNS resolution failed: {}", e))?
            .map(|sa| sa.ip().to_string())
            .collect::<std::collections::BTreeSet<_>>() // dedup + stable order
            .into_iter()
            .collect();
        if ips.is_empty() {
            return Err(format!("No DNS records found for '{}'", host));
        }
        Ok(ips)
    })
    .await
    .map_err(|e| format!("Thread executor failed: {}", e))?
}

/// Reverse DNS: resolves an IP address back to a hostname (PTR record).
#[tauri::command]
pub async fn reverse_dns(ip: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let addr: IpAddr = ip
            .parse()
            .map_err(|_| format!("'{}' is not a valid IP address", ip))?;
        dns_lookup::lookup_addr(&addr)
            .map_err(|e| format!("Reverse DNS failed for {}: {}", addr, e))
    })
    .await
    .map_err(|e| format!("Thread executor failed: {}", e))?
}

/// Curated OUI → vendor table for the most common networking/IT hardware.
/// Key is the first 3 bytes (6 hex uppercase). Not exhaustive — covers the
/// vendors a sysadmin actually meets, avoiding a multi-MB IEEE registry blob.
const OUI_TABLE: &[(&str, &str)] = &[
    ("000C29", "VMware"),
    ("005056", "VMware"),
    ("000569", "VMware"),
    ("001C14", "VMware"),
    ("080027", "VirtualBox"),
    ("0A0027", "VirtualBox"),
    ("00155D", "Microsoft Hyper-V"),
    ("00037F", "Atheros"),
    ("001B21", "Intel"),
    ("001E67", "Intel"),
    ("3CFDFE", "Intel"),
    ("A0369F", "Intel"),
    ("001CC0", "Intel"),
    ("00A0C9", "Intel"),
    ("000D3A", "Microsoft"),
    ("0017FA", "Microsoft"),
    ("7C1E52", "Microsoft"),
    ("F01FAF", "Dell"),
    ("00188B", "Dell"),
    ("B8CA3A", "Dell"),
    ("00219B", "Dell"),
    ("001AA0", "Dell"),
    ("D067E5", "Dell"),
    ("001B78", "HP"),
    ("3C4A92", "HP"),
    ("9457A5", "HP"),
    ("00215A", "HP"),
    ("002264", "HP"),
    ("ECB1D7", "HP"),
    ("000142", "Cisco"),
    ("00000C", "Cisco"),
    ("001A2F", "Cisco"),
    ("0025B4", "Cisco"),
    ("F4CFE2", "Cisco"),
    ("00DEFB", "Cisco"),
    ("001D7E", "Cisco-Linksys"),
    ("002129", "Cisco-Linksys"),
    ("B827EB", "Raspberry Pi"),
    ("DCA632", "Raspberry Pi"),
    ("E45F01", "Raspberry Pi"),
    ("28CDC1", "Raspberry Pi"),
    ("001124", "Apple"),
    ("3C0754", "Apple"),
    ("A45E60", "Apple"),
    ("F0DBF8", "Apple"),
    ("ACBC32", "Apple"),
    ("DC2B2A", "Apple"),
    ("000FB5", "Netgear"),
    ("001E2A", "Netgear"),
    ("A040A0", "Netgear"),
    ("00146C", "Netgear"),
    ("00226B", "Netgear"),
    ("0018E7", "TP-Link"),
    ("50C7BF", "TP-Link"),
    ("D8150D", "TP-Link"),
    ("00904C", "Epson"),
    ("001B38", "Epson"),
    ("FCFBFB", "Ubiquiti"),
    ("0418D6", "Ubiquiti"),
    ("788A20", "Ubiquiti"),
    ("245A4C", "Ubiquiti"),
    ("E063DA", "Ubiquiti"),
    ("0050BA", "D-Link"),
    ("00179A", "D-Link"),
    ("1CBDB9", "D-Link"),
    ("002710", "Synology"),
    ("0011D8", "Asus"),
    ("1C872C", "Asus"),
    ("2C56DC", "Asus"),
    ("AC220B", "Asus"),
    ("525400", "QEMU/KVM"),
    ("FA163E", "OpenStack KVM"),
    ("00163E", "Xen"),
    ("001967", "Lenovo"),
    ("8CDCD4", "Lenovo"),
    ("48BA4E", "Lenovo"),
    ("00219E", "Sony"),
    ("000AE6", "Elitegroup"),
];

/// Looks up the hardware vendor for a MAC address from the embedded OUI table.
#[tauri::command]
pub async fn mac_vendor_lookup(mac: String) -> Result<String, String> {
    let bytes = parse_mac(&mac)?;
    let oui = format!("{:02X}{:02X}{:02X}", bytes[0], bytes[1], bytes[2]);
    OUI_TABLE
        .iter()
        .find(|(prefix, _)| *prefix == oui)
        .map(|(_, vendor)| vendor.to_string())
        .ok_or_else(|| format!("Unknown vendor (OUI {})", oui))
}

/// Parses a MAC address in `AA:BB:CC:DD:EE:FF`, `AA-BB-...` or `aabbcc...` form.
fn parse_mac(mac: &str) -> Result<[u8; 6], String> {
    let hex: String = mac.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 12 {
        return Err(format!("Invalid MAC '{}': expected 12 hex digits", mac));
    }
    let mut out = [0u8; 6];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
            .map_err(|e| format!("Invalid MAC byte: {}", e))?;
    }
    Ok(out)
}

/// Sends a Wake-on-LAN magic packet (6×0xFF + MAC×16) to the broadcast address.
/// `broadcast` defaults to 255.255.255.255; port defaults to 9.
#[tauri::command]
pub async fn wake_on_lan(
    mac: String,
    broadcast: Option<String>,
    port: Option<u16>,
) -> Result<(), String> {
    use std::net::UdpSocket;

    let mac_bytes = parse_mac(&mac)?;
    let mut packet = [0u8; 102];
    packet[..6].fill(0xFF);
    for i in 0..16 {
        packet[6 + i * 6..6 + i * 6 + 6].copy_from_slice(&mac_bytes);
    }

    let bcast = broadcast.unwrap_or_else(|| "255.255.255.255".to_string());
    let port = port.unwrap_or(9);
    let target = format!("{}:{}", bcast, port);

    tokio::task::spawn_blocking(move || {
        let sock = UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("bind failed: {}", e))?;
        sock.set_broadcast(true)
            .map_err(|e| format!("set_broadcast failed: {}", e))?;
        // Send 3× for reliability over lossy/UDP networks.
        for _ in 0..3 {
            sock.send_to(&packet, &target)
                .map_err(|e| format!("send failed: {}", e))?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Thread executor failed: {}", e))?
}
