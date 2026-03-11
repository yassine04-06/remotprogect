use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::str::FromStr;
use std::time::{Duration, Instant};
use std::sync::{Arc, Mutex};

#[derive(Debug, Serialize, Clone)]
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

fn ipv4_to_u32(ip: Ipv4Addr) -> u32 {
    u32::from(ip)
}

fn u32_to_ipv4(ip: u32) -> Ipv4Addr {
    Ipv4Addr::from(ip)
}

#[tauri::command]
pub async fn scan_network(
    start_ip: String,
    end_ip: String,
    ports: Vec<u16>,
    timeout_ms: u64,
) -> Result<Vec<NetworkScanResult>, String> {
    let start = Ipv4Addr::from_str(&start_ip).map_err(|e| format!("Invalid start IP: {}", e))?;
    let end = Ipv4Addr::from_str(&end_ip).map_err(|e| format!("Invalid end IP: {}", e))?;

    let start_int = ipv4_to_u32(start);
    let end_int = ipv4_to_u32(end);

    if start_int > end_int {
        return Err("Start IP must be less than or equal to End IP".into());
    }
    
    // Hard limit to prevent memory explosion if user types a crazy range like 0.0.0.0 to 255.255.255.255
    if end_int - start_int > 2048 {
        return Err("Max 2048 IPs allowed per scan for performance".into());
    }

    let results = Arc::new(Mutex::new(Vec::new()));
    let timeout = Duration::from_millis(timeout_ms.max(50));
    
    let mut tasks = Vec::new();

    for ip_int in start_int..=end_int {
        let ip_addr = IpAddr::V4(u32_to_ipv4(ip_int));
        let ip_str = ip_addr.to_string();
        let current_ports = ports.clone();
        
        let task = tokio::task::spawn_blocking(move || {
            let mut open = Vec::new();
            let mut closed = Vec::new();
            
            for &port in &current_ports {
                let addr = SocketAddr::new(ip_addr, port);
                if TcpStream::connect_timeout(&addr, timeout).is_ok() {
                    open.push(port);
                } else {
                    closed.push(port);
                }
            }
            
            // If at least one port is open, or if we specifically want to list every IP we scanned...
            // mRemoteNG usually only shows IPs that have at least some relevance or it tries to ping them.
            // For MVP, if there is ANY open port, we keep it. If all ports are closed, we don't return it to avoid clutter,
            // or we return it only if it responds. For simplicity, we return everything we scanned so the user sees the grid.
            
            let res = NetworkScanResult {
                ip: ip_str,
                hostname: "".to_string(), // In a real scenario we could do reverse DNS here
                ssh: open.contains(&22),
                telnet: open.contains(&23),
                http: open.contains(&80),
                https: open.contains(&443),
                rlogin: open.contains(&513),
                rdp: open.contains(&3389),
                vnc: open.contains(&5900) || open.contains(&5901),
                open_ports: open,
                closed_ports: closed,
            };
            
            res
        });
        
        tasks.push(task);
    }
    
    for task in tasks {
        if let Ok(res) = task.await {
            results.lock().unwrap().push(res);
        }
    }

    let final_results = results.lock().unwrap().clone();
    Ok(final_results)
}

#[tauri::command]
pub async fn ping_server(host: String, port: u16) -> Result<u64, String> {
    // Resolve hostname and connect using the specified port
    let addr_str = format!("{}:{}", host, port);
    
    let mut addrs = addr_str
        .to_socket_addrs()
        .map_err(|e| format!("DNS resolution failed: {}", e))?;
        
    let addr = addrs.next().ok_or("Could not resolve hostname to an IP address")?;
    
    let start = Instant::now();
    let timeout = Duration::from_millis(5000); // 5s timeout
    
    match tokio::task::spawn_blocking(move || TcpStream::connect_timeout(&addr, timeout)).await {
        Ok(Ok(_)) => {
            let duration = start.elapsed();
            Ok(duration.as_millis() as u64)
        }
        Ok(Err(e)) => Err(format!("TCP Connection timeout or refused: {}", e)),
        Err(e) => Err(format!("Thread executor failed: {}", e)),
    }
}
