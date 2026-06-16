// MED-A5: database.rs god-module (1743 lines) split into focused sub-modules.
// All public items are re-exported here so existing callers (commands/*, lib.rs,
// bin/generate_types.rs) continue to use `database::Foo` without any changes.

pub mod audit;
pub mod connections;
pub mod credentials;
pub mod groups;
pub mod import_export;
pub mod migrations;
pub mod models;
pub mod saved_commands;
pub mod ssh_keys;

// Explicit named re-exports — no glob wildcards so future name collisions are
// caught at compile time rather than silently shadowing each other.

pub use audit::{audit_log_insert, audit_log_list, audit_log_verify};

pub use connections::{
    create_connection, delete_connection, get_connection_by_id, get_connections,
    get_connections_summary, toggle_favorite, update_connection, update_connection_group,
    update_last_connected, ConnectionSummary,
};

pub use credentials::{
    create_credential_profile, delete_credential_profile, get_credential_profiles,
    update_credential_profile,
};

pub use groups::{
    create_group, delete_group, get_groups, update_group, update_group_parent,
};

pub use import_export::{export_all, import_all};

pub use migrations::{initialize_database, run_migrations_pub, CURRENT_SCHEMA_VERSION};

pub use models::{
    AuditEntry, AuditVerifyEntry, AuditVerifyResult, CreateConnectionRequest,
    CreateCredentialProfileRequest, CreateSshKeyRequest, CreateSavedCommandRequest,
    CredentialProfile, CredentialType, ExportData, Group, SavedCommand, ServerConnection,
    SshKey, SshTunnel, UpdateConnectionRequest, UpdateCredentialProfileRequest,
    UpdateSavedCommandRequest,
};

pub use saved_commands::{
    create_saved_command, delete_saved_command, get_saved_commands, update_saved_command,
};

pub use ssh_keys::{ssh_key_create, ssh_key_delete, ssh_key_get, ssh_key_list};

/// Migrates all v1 (no-AAD, no `v2:` prefix) ciphertexts to v2 in a single
/// atomic `BEGIN IMMEDIATE` transaction.  Called on successful vault unlock so
/// legacy data is silently upgraded without user intervention.
///
/// Returns the number of rows updated.  Failure is logged but non-fatal —
/// `decrypt_auto` continues to accept v1 format indefinitely.
pub fn migrate_legacy_ciphertexts_to_v2(
    conn: &rusqlite::Connection,
    key: &[u8; 32],
) -> Result<usize, String> {
    use crate::encryption;

    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("v1→v2 migration: begin failed: {}", e))?;

    let mut migrated = 0usize;

    let result: Result<usize, String> = (|| {
        // ── connections ────────────────────────────────────────────────────────
        {
            let rows: Vec<(String, Option<String>, Option<String>)> = {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, password_encrypted, private_key_encrypted FROM connections",
                    )
                    .map_err(|e| format!("prepare connections: {}", e))?;
                let x = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                    .map_err(|e| format!("query connections: {}", e))?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| format!("collect connections: {}", e))?;
                x
            };
            for (id, pwd_enc, key_enc) in rows {
                let new_pwd = pwd_enc
                    .as_deref()
                    .filter(|ct| !ct.starts_with("v2:"))
                    .and_then(|ct| encryption::decrypt_auto(ct, key).ok())
                    .and_then(|pt| encryption::encrypt_v2(&pt, key).ok());
                let new_key = key_enc
                    .as_deref()
                    .filter(|ct| !ct.starts_with("v2:"))
                    .and_then(|ct| encryption::decrypt_auto(ct, key).ok())
                    .and_then(|pt| encryption::encrypt_v2(&pt, key).ok());
                if new_pwd.is_some() || new_key.is_some() {
                    conn.execute(
                        "UPDATE connections \
                         SET password_encrypted     = COALESCE(?1, password_encrypted), \
                             private_key_encrypted  = COALESCE(?2, private_key_encrypted) \
                         WHERE id = ?3",
                        rusqlite::params![new_pwd, new_key, id],
                    )
                    .map_err(|e| format!("update connection {}: {}", id, e))?;
                    migrated += 1;
                }
            }
        }

        // ── credential_profiles ────────────────────────────────────────────────
        {
            let rows: Vec<(String, Option<String>, Option<String>)> = {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, password_encrypted, private_key_encrypted \
                         FROM credential_profiles",
                    )
                    .map_err(|e| format!("prepare credential_profiles: {}", e))?;
                let x = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                    .map_err(|e| format!("query credential_profiles: {}", e))?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| format!("collect credential_profiles: {}", e))?;
                x
            };
            for (id, pwd_enc, key_enc) in rows {
                let new_pwd = pwd_enc
                    .as_deref()
                    .filter(|ct| !ct.starts_with("v2:"))
                    .and_then(|ct| encryption::decrypt_auto(ct, key).ok())
                    .and_then(|pt| encryption::encrypt_v2(&pt, key).ok());
                let new_key = key_enc
                    .as_deref()
                    .filter(|ct| !ct.starts_with("v2:"))
                    .and_then(|ct| encryption::decrypt_auto(ct, key).ok())
                    .and_then(|pt| encryption::encrypt_v2(&pt, key).ok());
                if new_pwd.is_some() || new_key.is_some() {
                    conn.execute(
                        "UPDATE credential_profiles \
                         SET password_encrypted     = COALESCE(?1, password_encrypted), \
                             private_key_encrypted  = COALESCE(?2, private_key_encrypted) \
                         WHERE id = ?3",
                        rusqlite::params![new_pwd, new_key, id],
                    )
                    .map_err(|e| format!("update credential_profile {}: {}", id, e))?;
                    migrated += 1;
                }
            }
        }

        // ── ssh_keys ───────────────────────────────────────────────────────────
        {
            let rows: Vec<(String, String)> = {
                let mut stmt = conn
                    .prepare("SELECT id, private_key_encrypted FROM ssh_keys")
                    .map_err(|e| format!("prepare ssh_keys: {}", e))?;
                let x = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                    .map_err(|e| format!("query ssh_keys: {}", e))?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| format!("collect ssh_keys: {}", e))?;
                x
            };
            for (id, key_enc) in rows {
                if key_enc.starts_with("v2:") {
                    continue;
                }
                if let Some(new_enc) = encryption::decrypt_auto(&key_enc, key)
                    .ok()
                    .and_then(|pt| encryption::encrypt_v2(&pt, key).ok())
                {
                    conn.execute(
                        "UPDATE ssh_keys SET private_key_encrypted = ?1 WHERE id = ?2",
                        rusqlite::params![new_enc, id],
                    )
                    .map_err(|e| format!("update ssh_key {}: {}", id, e))?;
                    migrated += 1;
                }
            }
        }

        Ok(migrated)
    })();

    match result {
        Ok(n) => {
            conn.execute_batch("COMMIT")
                .map_err(|e| format!("v1→v2 migration: commit failed: {}", e))?;
            Ok(n)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}
