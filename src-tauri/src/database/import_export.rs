use super::connections::get_connections;
use super::credentials::get_credential_profiles;
use super::groups::get_groups;
use super::migrations::CURRENT_SCHEMA_VERSION;
use super::models::ExportData;
use rusqlite::{params, Connection};

// ── Export / Import ──────────────────────────────────────

pub fn export_all(conn: &Connection) -> Result<ExportData, String> {
    let connections = get_connections(conn)?;
    let groups = get_groups(conn)?;
    let credential_profiles = get_credential_profiles(conn)?;
    Ok(ExportData {
        version: CURRENT_SCHEMA_VERSION,
        connections,
        groups,
        credential_profiles,
    })
}

/// Import all connections and groups inside an atomic transaction.
/// If any insert fails the database is rolled back to its original state.
pub fn import_all(conn: &Connection, data: ExportData) -> Result<(), String> {
    // Begin the transaction before touching any data
    conn.execute("BEGIN TRANSACTION", [])
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    // Closure that performs all the work — on Err we ROLLBACK below
    let result = (|| -> Result<(), String> {
        conn.execute("DELETE FROM connections", [])
            .map_err(|e| format!("Failed to clear connections: {}", e))?;
        conn.execute("DELETE FROM groups", [])
            .map_err(|e| format!("Failed to clear groups: {}", e))?;

        for group in &data.groups {
            conn.execute(
                "INSERT INTO groups (id, name, parent_id, sort_order) VALUES (?1, ?2, ?3, ?4)",
                params![group.id, group.name, group.parent_id, group.sort_order],
            )
            .map_err(|e| format!("Failed to import group '{}': {}", group.name, e))?;
        }

        for cp in &data.credential_profiles {
            conn.execute(
                "INSERT INTO credential_profiles (id, name, type, description, username, password_encrypted, private_key_encrypted, domain, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                 params![
                     cp.id, cp.name, cp.r#type, cp.description, cp.username, cp.password_encrypted,
                     cp.private_key_encrypted, cp.domain, cp.created_at, cp.updated_at
                 ]
            ).map_err(|e| format!("Failed to import credential profile '{}': {}", cp.name, e))?;
        }

        for c in &data.connections {
            conn.execute(
                "INSERT INTO connections (id, name, host, port, protocol, username,
                 password_encrypted, private_key_encrypted, group_id, use_private_key,
                 rdp_width, rdp_height, rdp_fullscreen, domain, rdp_color_depth,
                 rdp_redirect_audio, rdp_redirect_printers, rdp_redirect_drives,
                 ssh_tunnels, credential_profile_id, override_credentials, jump_host_id, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)",
                params![
                    c.id, c.name, c.host, c.port, c.protocol, c.username,
                    c.password_encrypted, c.private_key_encrypted, c.group_id,
                    c.use_private_key as i32, c.rdp_width, c.rdp_height,
                    c.rdp_fullscreen as i32, c.domain, c.rdp_color_depth,
                    c.rdp_redirect_audio as i32, c.rdp_redirect_printers as i32,
                    c.rdp_redirect_drives as i32,
                    serde_json::to_string(&c.ssh_tunnels).unwrap_or_else(|_| "[]".to_string()),
                    c.credential_profile_id, c.override_credentials as i32,
                    c.jump_host_id, c.created_at, c.updated_at,
                ],
            )
            .map_err(|e| format!("Failed to import connection '{}': {}", c.name, e))?;
        }

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", [])
                .map_err(|e| format!("Failed to commit transaction: {}", e))?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}
