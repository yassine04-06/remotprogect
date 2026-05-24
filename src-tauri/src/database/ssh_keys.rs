use rusqlite::{params, Connection};
use uuid::Uuid;
use super::models::{SshKey, CreateSshKeyRequest};

// ── SSH Key Vault (90-1) ──────────────────────────────────

pub fn ssh_key_list(conn: &Connection) -> Result<Vec<SshKey>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, key_type, public_key, private_key_encrypted, fingerprint, comment, created_at \
             FROM ssh_keys ORDER BY name",
        )
        .map_err(|e| format!("SSH key list prepare: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SshKey {
                id: row.get(0)?,
                name: row.get(1)?,
                key_type: row.get(2)?,
                public_key: row.get(3)?,
                private_key_encrypted: row.get(4)?,
                fingerprint: row.get(5)?,
                comment: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("SSH key list query: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("SSH key list collect: {}", e))?;

    Ok(rows)
}

pub fn ssh_key_get(conn: &Connection, id: &str) -> Result<SshKey, String> {
    conn.query_row(
        "SELECT id, name, key_type, public_key, private_key_encrypted, fingerprint, comment, created_at \
         FROM ssh_keys WHERE id = ?1",
        params![id],
        |row| {
            Ok(SshKey {
                id: row.get(0)?,
                name: row.get(1)?,
                key_type: row.get(2)?,
                public_key: row.get(3)?,
                private_key_encrypted: row.get(4)?,
                fingerprint: row.get(5)?,
                comment: row.get(6)?,
                created_at: row.get(7)?,
            })
        },
    )
    .map_err(|e| format!("SSH key get: {}", e))
}

pub fn ssh_key_create(conn: &Connection, req: CreateSshKeyRequest) -> Result<SshKey, String> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();

    conn.execute(
        "INSERT INTO ssh_keys (id, name, key_type, public_key, private_key_encrypted, fingerprint, comment, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, req.name, req.key_type, req.public_key, req.private_key_encrypted, req.fingerprint, req.comment, now],
    )
    .map_err(|e| format!("SSH key create: {}", e))?;

    Ok(SshKey {
        id,
        name: req.name,
        key_type: req.key_type,
        public_key: req.public_key,
        private_key_encrypted: req.private_key_encrypted,
        fingerprint: req.fingerprint,
        comment: req.comment,
        created_at: now,
    })
}

pub fn ssh_key_delete(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM ssh_keys WHERE id = ?1", params![id])
        .map_err(|e| format!("SSH key delete: {}", e))?;
    Ok(())
}
