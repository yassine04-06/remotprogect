use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Serialize, Deserialize, Debug, Clone)]
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

lazy_static::lazy_static! {
    static ref HTTP_CLIENT: Client = Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(10))
        .build()
        .expect("Failed to build HTTP Client");
}

#[tauri::command]
pub async fn docker_get_containers(
    host: String,
    port: u16,
) -> Result<Vec<DockerContainer>, String> {
    let url = format!("http://{}:{}/containers/json?all=1", host, port);
    
    let res = HTTP_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Failed to fetch containers. Status: {}", res.status()));
    }

    let containers: Vec<DockerContainer> = res
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(containers)
}

#[tauri::command]
pub async fn docker_container_action(
    host: String,
    port: u16,
    container_id: String,
    action: String, // "start", "stop", "restart"
) -> Result<String, String> {
    let valid_actions = ["start", "stop", "restart"];
    if !valid_actions.contains(&action.as_str()) {
        return Err(format!("Invalid action: {}", action));
    }

    let url = format!("http://{}:{}/containers/{}/{}", host, port, container_id, action);
    
    let res = HTTP_CLIENT
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Action failed. Status: {} - {}", status, err_text));
    }

    Ok("Action initiated successfully".to_string())
}
