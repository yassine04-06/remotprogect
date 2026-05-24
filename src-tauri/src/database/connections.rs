use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;
use chrono::Utc;
use super::models::{ServerConnection, CreateConnectionRequest, UpdateConnectionRequest};

// ── Lightweight summary for sidebar rendering ─────────────
// 30-15: avoids pulling large blobs (ssh_tunnels JSON, encrypted fields) for the
// sidebar which only needs enough data to render the tree and open tabs.

/// Subset of ServerConnection fields used to render the connection sidebar.
/// Omits encrypted credentials, RDP config, and the ssh_tunnels JSON blob.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ConnectionSummary {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    #[ts(type = "'SSH' | 'RDP' | 'VNC' | 'SFTP' | 'FTP' | 'PROXMOX' | 'DOCKER'")]
    pub protocol: String,
    pub group_id: Option<String>,
    pub credential_profile_id: Option<String>,
    pub override_credentials: bool,
    pub is_favorite: bool,
    pub last_connected_at: Option<i64>,
    pub tags: Option<String>,
}

pub fn get_connections_summary(conn: &Connection) -> Result<Vec<ConnectionSummary>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, host, port, protocol, group_id, credential_profile_id, \
             override_credentials, is_favorite, last_connected_at, tags \
             FROM connections ORDER BY name",
        )
        .map_err(|e| format!("Failed to prepare summary query: {}", e))?;

    let results = stmt
        .query_map([], |row| {
            Ok(ConnectionSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                protocol: row.get(4)?,
                group_id: row.get(5)?,
                credential_profile_id: row.get(6)?,
                override_credentials: row.get::<_, i32>(7)? != 0,
                is_favorite: row.get::<_, i32>(8)? != 0,
                last_connected_at: row.get(9)?,
                tags: row.get(10)?,
            })
        })
        .map_err(|e| format!("Failed to query connections summary: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect connections summary: {}", e))?;

    Ok(results)
}

// ── Connection CRUD ──────────────────────────────────────

pub fn create_connection(
    conn: &Connection,
    req: CreateConnectionRequest,
) -> Result<ServerConnection, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let res = ServerConnection {
        id: id.clone(),
        name: req.name.clone(),
        host: req.host.clone(),
        port: req.port,
        protocol: req.protocol.clone(),
        username: req.username.clone(),
        password_encrypted: req.password_encrypted.clone(),
        private_key_encrypted: req.private_key_encrypted.clone(),
        group_id: req.group_id.clone(),
        use_private_key: req.use_private_key,
        rdp_width: req.rdp_width.unwrap_or(1920),
        rdp_height: req.rdp_height.unwrap_or(1080),
        rdp_fullscreen: req.rdp_fullscreen.unwrap_or(false),
        domain: req.domain.clone().unwrap_or_default(),
        rdp_color_depth: req.rdp_color_depth.unwrap_or(24),
        rdp_redirect_audio: req.rdp_redirect_audio.unwrap_or(false),
        rdp_redirect_printers: req.rdp_redirect_printers.unwrap_or(false),
        rdp_redirect_drives: req.rdp_redirect_drives.unwrap_or(false),
        ssh_tunnels: req.ssh_tunnels.clone(),
        credential_profile_id: req.credential_profile_id.clone(),
        override_credentials: req.override_credentials.unwrap_or(true),
        jump_host_id: req.jump_host_id.clone(),
        use_ssh_agent: req.use_ssh_agent.unwrap_or(false),
        ssh_key_id: req.ssh_key_id.clone(),
        tags: req.tags.clone(),
        last_connected_at: None,
        is_favorite: false,
        notes: req.notes.clone(),
        use_ftps: req.use_ftps.unwrap_or(false),
        rdp_nla: req.rdp_nla.unwrap_or(false),
        docker_transport: req.docker_transport.clone().unwrap_or_else(|| "tcp".to_string()),
        docker_socket_path: req.docker_socket_path.clone(),
        docker_tls_ca_path: req.docker_tls_ca_path.clone(),
        docker_tls_cert_path: req.docker_tls_cert_path.clone(),
        docker_tls_key_path: req.docker_tls_key_path.clone(),
        proxmox_api_token_id: req.proxmox_api_token_id.clone(),
        proxmox_api_token_secret_encrypted: req.proxmox_api_token_secret_encrypted.clone(),
        created_at: now.clone(),
        updated_at: now,
    };

    conn.execute(
        "INSERT INTO connections (id, name, host, port, protocol, username,
         password_encrypted, private_key_encrypted, group_id, use_private_key,
         rdp_width, rdp_height, rdp_fullscreen, domain, rdp_color_depth,
         rdp_redirect_audio, rdp_redirect_printers, rdp_redirect_drives,
         ssh_tunnels, credential_profile_id, override_credentials, jump_host_id,
         use_ssh_agent, ssh_key_id, tags, notes,
         use_ftps, rdp_nla, docker_transport, docker_socket_path,
         docker_tls_ca_path, docker_tls_cert_path, docker_tls_key_path,
         proxmox_api_token_id, proxmox_api_token_secret_encrypted,
         created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35,?36,?37)",
        params![
            res.id, res.name, res.host, res.port, res.protocol, res.username,
            res.password_encrypted, res.private_key_encrypted, res.group_id,
            res.use_private_key as i32, res.rdp_width, res.rdp_height,
            res.rdp_fullscreen as i32, res.domain, res.rdp_color_depth,
            res.rdp_redirect_audio as i32, res.rdp_redirect_printers as i32,
            res.rdp_redirect_drives as i32,
            serde_json::to_string(&res.ssh_tunnels).unwrap_or_else(|_| "[]".to_string()),
            res.credential_profile_id, res.override_credentials as i32,
            res.jump_host_id,
            res.use_ssh_agent as i32, res.ssh_key_id, res.tags, res.notes,
            res.use_ftps as i32, res.rdp_nla as i32, res.docker_transport,
            res.docker_socket_path,
            res.docker_tls_ca_path, res.docker_tls_cert_path, res.docker_tls_key_path,
            res.proxmox_api_token_id, res.proxmox_api_token_secret_encrypted,
            res.created_at, res.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to create connection: {}", e))?;

    Ok(res)
}

pub fn update_connection(conn: &Connection, req: UpdateConnectionRequest) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let tunnels_json = req.ssh_tunnels.map(|t| serde_json::to_string(&t).unwrap_or_default());

    conn.execute(
        "UPDATE connections SET name=?1, host=?2, port=?3, protocol=?4, username=?5,
         password_encrypted=?6, private_key_encrypted=?7, group_id=?8, use_private_key=?9,
         rdp_width=?10, rdp_height=?11, rdp_fullscreen=?12, domain=?13, rdp_color_depth=?14,
         rdp_redirect_audio=?15, rdp_redirect_printers=?16, rdp_redirect_drives=?17,
         ssh_tunnels=?18, credential_profile_id=?19, override_credentials=?20,
         jump_host_id=?21, use_ssh_agent=?22, ssh_key_id=?23, tags=?24, notes=?25,
         use_ftps=?26, rdp_nla=?27, docker_transport=?28, docker_socket_path=?29,
         docker_tls_ca_path=?30, docker_tls_cert_path=?31, docker_tls_key_path=?32,
         proxmox_api_token_id=?33, proxmox_api_token_secret_encrypted=?34,
         updated_at=?35 WHERE id=?36",
        params![
            req.name, req.host, req.port, req.protocol, req.username,
            req.password_encrypted, req.private_key_encrypted, req.group_id,
            req.use_private_key as i32,
            req.rdp_width.unwrap_or(1920), req.rdp_height.unwrap_or(1080),
            req.rdp_fullscreen.unwrap_or(false) as i32,
            req.domain.unwrap_or_default(), req.rdp_color_depth.unwrap_or(24),
            req.rdp_redirect_audio.unwrap_or(false) as i32,
            req.rdp_redirect_printers.unwrap_or(false) as i32,
            req.rdp_redirect_drives.unwrap_or(false) as i32,
            tunnels_json, req.credential_profile_id,
            req.override_credentials.unwrap_or(true) as i32,
            req.jump_host_id,
            req.use_ssh_agent.unwrap_or(false) as i32, req.ssh_key_id,
            req.tags, req.notes,
            req.use_ftps.unwrap_or(false) as i32,
            req.rdp_nla.unwrap_or(false) as i32,
            req.docker_transport.unwrap_or_else(|| "tcp".to_string()),
            req.docker_socket_path,
            req.docker_tls_ca_path, req.docker_tls_cert_path, req.docker_tls_key_path,
            req.proxmox_api_token_id, req.proxmox_api_token_secret_encrypted,
            now, req.id,
        ],
    )
    .map_err(|e| format!("Failed to update connection: {}", e))?;

    Ok(())
}

pub fn delete_connection(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM connections WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete connection: {}", e))?;
    Ok(())
}

pub fn get_connections(conn: &Connection) -> Result<Vec<ServerConnection>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, host, port, protocol, username, password_encrypted,
             private_key_encrypted, group_id, use_private_key, rdp_width, rdp_height,
             rdp_fullscreen, domain, rdp_color_depth, rdp_redirect_audio,
             rdp_redirect_printers, rdp_redirect_drives, ssh_tunnels,
             credential_profile_id, override_credentials, jump_host_id,
             use_ssh_agent, ssh_key_id, tags, last_connected_at, is_favorite, notes,
             use_ftps, rdp_nla, docker_transport, docker_socket_path,
             docker_tls_ca_path, docker_tls_cert_path, docker_tls_key_path,
             proxmox_api_token_id, proxmox_api_token_secret_encrypted,
             created_at, updated_at
             FROM connections ORDER BY name",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let connections = stmt
        .query_map([], |row| {
            Ok(ServerConnection {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                protocol: row.get(4)?,
                username: row.get(5)?,
                password_encrypted: row.get(6)?,
                private_key_encrypted: row.get(7)?,
                group_id: row.get(8)?,
                use_private_key: row.get::<_, i32>(9)? != 0,
                rdp_width: row.get(10)?,
                rdp_height: row.get(11)?,
                rdp_fullscreen: row.get::<_, i32>(12)? != 0,
                domain: row.get(13)?,
                rdp_color_depth: row.get(14)?,
                rdp_redirect_audio: row.get::<_, i32>(15)? != 0,
                rdp_redirect_printers: row.get::<_, i32>(16)? != 0,
                rdp_redirect_drives: row.get::<_, i32>(17)? != 0,
                ssh_tunnels: row.get::<_, Option<String>>(18)?
                    .and_then(|s| serde_json::from_str(&s).ok()),
                credential_profile_id: row.get(19)?,
                override_credentials: row.get::<_, i32>(20)? != 0,
                jump_host_id: row.get(21)?,
                use_ssh_agent: row.get::<_, i32>(22)? != 0,
                ssh_key_id: row.get(23)?,
                tags: row.get(24)?,
                last_connected_at: row.get(25)?,
                is_favorite: row.get::<_, i32>(26)? != 0,
                notes: row.get(27)?,
                use_ftps: row.get::<_, i32>(28).unwrap_or(0) != 0,
                rdp_nla: row.get::<_, i32>(29).unwrap_or(0) != 0,
                docker_transport: row.get::<_, Option<String>>(30)?.unwrap_or_else(|| "tcp".to_string()),
                docker_socket_path: row.get(31)?,
                docker_tls_ca_path: row.get(32)?,
                docker_tls_cert_path: row.get(33)?,
                docker_tls_key_path: row.get(34)?,
                proxmox_api_token_id: row.get(35)?,
                proxmox_api_token_secret_encrypted: row.get(36)?,
                created_at: row.get(37)?,
                updated_at: row.get(38)?,
            })
        })
        .map_err(|e| format!("Failed to query connections: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect connections: {}", e))?;

    Ok(connections)
}

/// Fetch a single connection by its UUID primary key.
/// Returns None if not found (caller decides whether to error).
pub fn get_connection_by_id(conn: &Connection, id: &str) -> Result<Option<ServerConnection>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, host, port, protocol, username, password_encrypted,
             private_key_encrypted, group_id, use_private_key, rdp_width, rdp_height,
             rdp_fullscreen, domain, rdp_color_depth, rdp_redirect_audio,
             rdp_redirect_printers, rdp_redirect_drives, ssh_tunnels,
             credential_profile_id, override_credentials, jump_host_id,
             use_ssh_agent, ssh_key_id, tags, last_connected_at, is_favorite, notes,
             use_ftps, rdp_nla, docker_transport, docker_socket_path,
             docker_tls_ca_path, docker_tls_cert_path, docker_tls_key_path,
             proxmox_api_token_id, proxmox_api_token_secret_encrypted,
             created_at, updated_at
             FROM connections WHERE id = ?1",
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let result = stmt.query_row([id], |row| {
        Ok(ServerConnection {
            id: row.get(0)?,
            name: row.get(1)?,
            host: row.get(2)?,
            port: row.get(3)?,
            protocol: row.get(4)?,
            username: row.get(5)?,
            password_encrypted: row.get(6)?,
            private_key_encrypted: row.get(7)?,
            group_id: row.get(8)?,
            use_private_key: row.get::<_, i32>(9)? != 0,
            rdp_width: row.get(10)?,
            rdp_height: row.get(11)?,
            rdp_fullscreen: row.get::<_, i32>(12)? != 0,
            domain: row.get(13)?,
            rdp_color_depth: row.get(14)?,
            rdp_redirect_audio: row.get::<_, i32>(15)? != 0,
            rdp_redirect_printers: row.get::<_, i32>(16)? != 0,
            rdp_redirect_drives: row.get::<_, i32>(17)? != 0,
            ssh_tunnels: row.get::<_, Option<String>>(18)?
                .and_then(|s| serde_json::from_str(&s).ok()),
            credential_profile_id: row.get(19)?,
            override_credentials: row.get::<_, i32>(20)? != 0,
            jump_host_id: row.get(21)?,
            use_ssh_agent: row.get::<_, i32>(22)? != 0,
            ssh_key_id: row.get(23)?,
            tags: row.get(24)?,
            last_connected_at: row.get(25)?,
            is_favorite: row.get::<_, i32>(26)? != 0,
            notes: row.get(27)?,
            use_ftps: row.get::<_, i32>(28).unwrap_or(0) != 0,
            rdp_nla: row.get::<_, i32>(29).unwrap_or(0) != 0,
            docker_transport: row.get::<_, Option<String>>(30)?.unwrap_or_else(|| "tcp".to_string()),
            docker_socket_path: row.get(31)?,
            docker_tls_ca_path: row.get(32)?,
            docker_tls_cert_path: row.get(33)?,
            docker_tls_key_path: row.get(34)?,
            proxmox_api_token_id: row.get(35)?,
            proxmox_api_token_secret_encrypted: row.get(36)?,
            created_at: row.get(37)?,
            updated_at: row.get(38)?,
        })
    });

    match result {
        Ok(c) => Ok(Some(c)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to query connection by id: {}", e)),
    }
}

// ── Connection helpers (90-7, 90-9) ──────────────────────

pub fn toggle_favorite(conn: &Connection, id: &str) -> Result<bool, String> {
    let current: i32 = conn
        .query_row("SELECT is_favorite FROM connections WHERE id=?1", params![id], |r| r.get(0))
        .map_err(|e| format!("toggle_favorite query: {}", e))?;
    let new_val = if current != 0 { 0i32 } else { 1i32 };
    conn.execute("UPDATE connections SET is_favorite=?1 WHERE id=?2", params![new_val, id])
        .map_err(|e| format!("toggle_favorite update: {}", e))?;
    Ok(new_val != 0)
}

pub fn update_last_connected(conn: &Connection, id: &str) -> Result<(), String> {
    let now = Utc::now().timestamp();
    conn.execute("UPDATE connections SET last_connected_at=?1 WHERE id=?2", params![now, id])
        .map_err(|e| format!("update_last_connected: {}", e))?;
    Ok(())
}

pub fn update_connection_group(conn: &Connection, connection_id: &str, group_id: Option<&str>) -> Result<(), String> {
    conn.execute(
        "UPDATE connections SET group_id=?1, updated_at=?2 WHERE id=?3",
        params![group_id, Utc::now().to_rfc3339(), connection_id],
    )
    .map_err(|e| format!("update_connection_group: {}", e))?;
    Ok(())
}
