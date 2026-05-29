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

/// Move a group under a new parent (or to root when parent_id is None).
/// Guards against making a group its own ancestor (cycle).
pub fn update_group_parent(
    conn: &Connection,
    id: &str,
    parent_id: Option<&str>,
) -> Result<(), String> {
    if let Some(pid) = parent_id {
        if pid == id {
            return Err("A folder cannot be moved into itself".to_string());
        }
        // walk up from the new parent; if we reach `id`, this would create a cycle
        let mut cur = Some(pid.to_string());
        while let Some(c) = cur {
            if c == id {
                return Err("Cannot move a folder into one of its own subfolders".to_string());
            }
            cur = conn
                .query_row(
                    "SELECT parent_id FROM groups WHERE id = ?1",
                    params![c],
                    |r| r.get::<_, Option<String>>(0),
                )
                .map_err(|e| format!("Cycle check failed: {}", e))?;
        }
    }
    conn.execute(
        "UPDATE groups SET parent_id = ?1 WHERE id = ?2",
        params![parent_id, id],
    )
    .map_err(|e| format!("Failed to move group: {}", e))?;
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
