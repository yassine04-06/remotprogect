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

/// FIX: la password arriva cifrata dal frontend e viene decifrata
/// qui in Rust prima di usarla, esattamente come avviene per SSH.
/// Il frontend deve passare `password_encrypted` (il valore cifrato
/// salvato nel DB) invece della password in chiaro.
#[tauri::command]
pub async fn proxmox_auth(
    state: tauri::State<'_, crate::state::AppState>,
    host: String,
    port: u16,
    username: String,
    password_encrypted: String,
) -> Result<ProxmoxAuthResponse, String> {
    // Decifra la password usando la chiave del vault
    let password = {
        let key_guard = state.encryption_key.read().map_err(|_| "Lock error")?;
        let key = key_guard.as_ref().ok_or("Vault bloccato — sblocca prima di connetterti")?;
        crate::encryption::decrypt(&password_encrypted, key)?
    };

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
