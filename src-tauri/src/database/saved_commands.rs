use super::models::{CreateSavedCommandRequest, SavedCommand, UpdateSavedCommandRequest};
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

// ── Saved Commands CRUD ────────────────────────────────────

pub fn create_saved_command(
    conn: &Connection,
    req: CreateSavedCommandRequest,
) -> Result<SavedCommand, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let res = SavedCommand {
        id: id.clone(),
        name: req.name.clone(),
        command: req.command.clone(),
        description: req.description.clone(),
        tags: req.tags.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    conn.execute(
        "INSERT INTO saved_commands (id, name, command, description, tags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            res.id,
            res.name,
            res.command,
            res.description,
            res.tags,
            res.created_at,
            res.updated_at
        ],
    )
    .map_err(|e| format!("Failed to create saved command: {}", e))?;

    Ok(res)
}

pub fn get_saved_commands(conn: &Connection) -> Result<Vec<SavedCommand>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, command, description, tags, created_at, updated_at FROM saved_commands ORDER BY name")
        .map_err(|e| e.to_string())?;

    let cmds = stmt
        .query_map([], |row| {
            Ok(SavedCommand {
                id: row.get(0)?,
                name: row.get(1)?,
                command: row.get(2)?,
                description: row.get(3)?,
                tags: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(cmds)
}

pub fn update_saved_command(
    conn: &Connection,
    req: UpdateSavedCommandRequest,
) -> Result<SavedCommand, String> {
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE saved_commands SET name=?1, command=?2, description=?3, tags=?4, updated_at=?5 WHERE id=?6",
        params![req.name, req.command, req.description, req.tags, now, req.id],
    )
    .map_err(|e| format!("Failed to update saved command: {}", e))?;

    let mut stmt = conn
        .prepare("SELECT id, name, command, description, tags, created_at, updated_at FROM saved_commands WHERE id=?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([&req.id]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(SavedCommand {
            id: row.get(0).map_err(|e| e.to_string())?,
            name: row.get(1).map_err(|e| e.to_string())?,
            command: row.get(2).map_err(|e| e.to_string())?,
            description: row.get(3).map_err(|e| e.to_string())?,
            tags: row.get(4).map_err(|e| e.to_string())?,
            created_at: row.get(5).map_err(|e| e.to_string())?,
            updated_at: row.get(6).map_err(|e| e.to_string())?,
        })
    } else {
        Err("Saved command not found after update".into())
    }
}

pub fn delete_saved_command(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM saved_commands WHERE id=?1", params![id])
        .map_err(|e| format!("Failed to delete saved command: {}", e))?;
    Ok(())
}
