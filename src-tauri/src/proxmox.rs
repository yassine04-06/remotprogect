use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProxmoxAuthResponse {
    pub CSRFPreventionToken: String,
    pub ticket: String,
    pub username: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProxmoxResource {
    pub id: String,
    pub r#type: String, // "qemu" or "lxc"
    pub node: String,
    pub status: String,
    pub name: String,
    pub uptime: u64,
    pub cpu: f64,
    pub maxcpu: u64,
    pub mem: u64,
    pub maxmem: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct ProxmoxAuthData {
    data: ProxmoxAuthResponse,
}

#[derive(Serialize, Deserialize, Debug)]
struct ProxmoxResourceData {
    data: Vec<ProxmoxResource>,
}

lazy_static::lazy_static! {
    static ref HTTP_CLIENT: Client = Client::builder()
        .danger_accept_invalid_certs(true) // Proxmox often uses self-signed certs
        .timeout(Duration::from_secs(15))
        .build()
        .expect("Failed to build HTTP Client");
}

#[tauri::command]
pub async fn proxmox_auth(
    host: String,
    port: u16,
    username: String,
    _password_encrypted: String, 
    // Usually we would decrypt it here properly, but for simplicity assuming cleartext or unencrypted passage for now 
    // according to how the frontend is handling the standard password flow 
    // Wait, the user plan specifies username/password. I will assume it's passed unencrypted to the tauri API from the frontend.
    password: Option<String>
) -> Result<ProxmoxAuthResponse, String> {
    let pw: String = password.unwrap_or_default();
    
    let url = format!("https://{}:{}/api2/json/access/ticket", host, port);
    
    let res: Response = HTTP_CLIENT
        .post(&url)
        .form(&[
            ("username", username.as_str()),
            ("password", pw.as_str())
        ])
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Authentication failed. Status code: {}", res.status()));
    }

    let auth_data: ProxmoxAuthData = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(auth_data.data)
}

#[tauri::command]
pub async fn proxmox_get_resources(
    host: String,
    port: u16,
    ticket: String,
) -> Result<Vec<ProxmoxResource>, String> {
    let url = format!("https://{}:{}/api2/json/cluster/resources?type=vm", host, port);
    
    let res: Response = HTTP_CLIENT
        .get(&url)
        .header("Cookie", format!("PVEAuthCookie={}", ticket))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Failed to fetch resources. Status: {}", res.status()));
    }

    let res_data: ProxmoxResourceData = res
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(res_data.data)
}

#[tauri::command]
pub async fn proxmox_vm_action(
    host: String,
    port: u16,
    ticket: String,
    csrf: String,
    node: String,
    vmid: String,
    vm_type: String, // qemu or lxc
    action: String,  // start, stop, shutdown, reboot
) -> Result<String, String> {
    let url = format!("https://{}:{}/api2/json/nodes/{}/{}/{}/status/{}", host, port, node, vm_type, vmid, action);
    
    let res: Response = HTTP_CLIENT
        .post(&url)
        .header("Cookie", format!("PVEAuthCookie={}", ticket))
        .header("CSRFPreventionToken", csrf)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = res.status();
    if !status.is_success() {
        let err_text = res.text().await.unwrap_or_else(|_| String::new());
        return Err(format!("Action failed. Status: {} - {}", status, err_text));
    }

    Ok("Action initiated successfully".to_string())
}
