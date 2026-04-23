use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[allow(non_snake_case)]
pub struct ProxmoxAuthResponse {
    pub CSRFPreventionToken: String,
    pub ticket: String,
    pub username: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProxmoxResource {
    pub id: String,
    pub r#type: String,
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
        .danger_accept_invalid_certs(true) // Proxmox usa spesso certificati self-signed
        .timeout(Duration::from_secs(15))
        .build()
        .expect("Impossibile costruire HTTP Client");
}

#[tauri::command]
pub async fn proxmox_auth(
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
) -> Result<ProxmoxAuthResponse, String> {
    let password = password.unwrap_or_default();

    let url = format!("https://{}:{}/api2/json/access/ticket", host, port);

    let res: Response = HTTP_CLIENT
        .post(&url)
        .form(&[
            ("username", username.as_str()),
            ("password", password.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Richiesta fallita: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Autenticazione fallita. Status: {}", res.status()));
    }

    let auth_data: ProxmoxAuthData = res
        .json()
        .await
        .map_err(|e| format!("Errore parsing risposta: {}", e))?;

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
        .map_err(|e| format!("Richiesta fallita: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Impossibile ottenere risorse. Status: {}", res.status()));
    }

    let res_data: ProxmoxResourceData = res
        .json()
        .await
        .map_err(|e| format!("Errore parsing: {}", e))?;

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
    vm_type: String,
    action: String,
) -> Result<String, String> {
    // Valida l'azione per prevenire injection nell'URL
    let allowed = ["start", "stop", "shutdown", "reboot", "suspend", "resume"];
    if !allowed.contains(&action.as_str()) {
        return Err(format!("Azione non consentita: '{}'", action));
    }

    let url = format!(
        "https://{}:{}/api2/json/nodes/{}/{}/{}/status/{}",
        host, port, node, vm_type, vmid, action
    );

    let res: Response = HTTP_CLIENT
        .post(&url)
        .header("Cookie", format!("PVEAuthCookie={}", ticket))
        .header("CSRFPreventionToken", csrf)
        .send()
        .await
        .map_err(|e| format!("Richiesta fallita: {}", e))?;

    let status = res.status();
    if !status.is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Azione fallita. Status: {} — {}", status, err_text));
    }

    Ok("Azione avviata correttamente".to_string())
}

#[tauri::command]
pub fn proxmox_open_console(
    app: tauri::AppHandle,
    url: String, // e.g. https://10.0.0.1:8006/?console=kvm&...
    label: String,
    title: String,
    ticket: String,
) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder, Manager};
    
    // Split the URL to get the base domain (e.g. https://10.0.0.1:8006)
    // and the path+query (e.g. /?console=kvm&vmid=...)
    let parsed_url: reqwest::Url = url.parse().map_err(|e| format!("URL non valida: {}", e))?;
    let base_url = format!("{}://{}:{}", parsed_url.scheme(), parsed_url.host_str().unwrap(), parsed_url.port().unwrap_or(8006));
    
    // We load the base_url (which doesn't return 401, but the login page).
    // The initialization script will run on the login page, set the cookie, and then redirect to the actual console url.
    let inject_script = format!(
        r#"
        if (!window.location.search.includes('console=')) {{
            document.cookie = "PVEAuthCookie={}; path=/";
            window.location.href = "{}";
        }}
        "#,
        ticket, url
    );

    // Chiudi la finestra se esiste già
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.close();
    }

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(base_url.parse().unwrap()))
        .title(title)
        .inner_size(1024.0, 768.0)
        .center()
        .resizable(true)
        .initialization_script(&inject_script)
        .build()
        .map_err(|e| format!("Errore apertura finestra console: {}", e))?;

    Ok(())
}
