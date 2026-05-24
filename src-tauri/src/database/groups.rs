use super::models::Group;
use rusqlite::{params, Connection};
use uuid::Uuid;

// ── Group CRUD ───────────────────────────────────────────

pub fn create_group(
    conn: &Connection,
    name: &str,
    parent_id: Option<&str>,
) -> Result<Group, String> {
    let id = Uuid::new_v4().to_string();
    let sort_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM groups WHERE parent_id IS ?1",
            params![parent_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO groups (id, name, parent_id, sort_order) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, parent_id, sort_order],
    )
    .map_err(|e| format!("Failed to create group: {}", e))?;

    Ok(Group {
        id,
        name: name.to_string(),
        parent_id: parent_id.map(|s| s.to_string()),
        sort_order,
    })
}

pub fn update_group(conn: &Connection, id: &str, name: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE groups SET name = ?1 WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| format!("Failed to update group: {}", e))?;
    Ok(())
}

pub fn delete_group(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM groups WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete group: {}", e))?;
    Ok(())
}

pub fn get_groups(conn: &Connection) -> Result<Vec<Group>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, parent_id, sort_order FROM groups ORDER BY sort_order")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let groups = stmt
        .query_map([], |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                sort_order: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to query groups: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect groups: {}", e))?;

    Ok(groups)
}
