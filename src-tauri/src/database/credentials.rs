use super::models::{
    CreateCredentialProfileRequest, CredentialProfile, UpdateCredentialProfileRequest,
};
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

// ── Credential Profiles CRUD ───────────────────────────────

pub fn create_credential_profile(
    conn: &Connection,
    req: CreateCredentialProfileRequest,
) -> Result<CredentialProfile, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();

    let res = CredentialProfile {
        id: id.clone(),
        name: req.name.clone(),
        r#type: req.r#type.clone(),
        description: req.description.clone(),
        username: req.username.clone(),
        password_encrypted: req.password_encrypted.clone(),
        private_key_encrypted: req.private_key_encrypted.clone(),
        domain: req.domain.clone(),
        created_at: now,
        updated_at: now,
    };

    conn.execute(
        "INSERT INTO credential_profiles (id, name, type, description, username, password_encrypted, private_key_encrypted, domain, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            res.id, res.name, res.r#type, res.description, res.username,
            res.password_encrypted, res.private_key_encrypted, res.domain,
            res.created_at, res.updated_at
        ],
    )
    .map_err(|e| format!("Failed to create credential profile: {}", e))?;

    Ok(res)
}

pub fn get_credential_profiles(conn: &Connection) -> Result<Vec<CredentialProfile>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, type, description, username, password_encrypted, private_key_encrypted, domain, created_at, updated_at FROM credential_profiles ORDER BY name")
        .map_err(|e| e.to_string())?;

    let profiles = stmt
        .query_map([], |row| {
            Ok(CredentialProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                r#type: row.get(2)?,
                description: row.get(3)?,
                username: row.get(4)?,
                password_encrypted: row.get(5)?,
                private_key_encrypted: row.get(6)?,
                domain: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(profiles)
}

pub fn update_credential_profile(
    conn: &Connection,
    req: UpdateCredentialProfileRequest,
) -> Result<(), String> {
    let now = Utc::now().timestamp();

    conn.execute(
        "UPDATE credential_profiles SET name=?1, type=?2, description=?3, username=?4, password_encrypted=?5, private_key_encrypted=?6, domain=?7, updated_at=?8 WHERE id=?9",
        params![
            req.name, req.r#type, req.description, req.username, req.password_encrypted,
            req.private_key_encrypted, req.domain, now, req.id
        ],
    )
    .map_err(|e| format!("Failed to update credential profile: {}", e))?;
    Ok(())
}

pub fn delete_credential_profile(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM credential_profiles WHERE id=?1", params![id])
        .map_err(|e| format!("Failed to delete credential profile: {}", e))?;
    Ok(())
}
