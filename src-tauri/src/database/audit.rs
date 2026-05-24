use rusqlite::{params, Connection};
use uuid::Uuid;
use chrono::Utc;
use sha2::{Digest, Sha256};
use super::models::{AuditEntry, AuditVerifyEntry, AuditVerifyResult};

// ── Audit Log (90-10 / CRIT-A3) ─────────────────────────
//
// CRIT-A3: every row carries a `chain_hash` that is SHA-256(prev_hash || row_data).
// The genesis row uses the sentinel "GENESIS" as its predecessor hash.
// `audit_log_verify` walks the chain in insertion order and flags any row whose
// stored hash does not match the recomputed value — indicating tampering or
// out-of-order insertion.

/// Compute the chain hash for a single audit entry.
/// Input material: prev_hash ‖ "|" ‖ id ‖ "|" ‖ ts ‖ "|" ‖ action ‖ …
fn audit_chain_hash(
    prev_hash: &str,
    id: &str,
    ts: i64,
    action: &str,
    entity_type: &str,
    entity_id: &str,
    entity_name: &str,
    outcome: &str,
    details: &str,
) -> String {
    let mut h = Sha256::new();
    for part in &[
        prev_hash,
        "|",
        id,
        "|",
        &ts.to_string(),
        "|",
        action,
        "|",
        entity_type,
        "|",
        entity_id,
        "|",
        entity_name,
        "|",
        outcome,
        "|",
        details,
    ] {
        h.update(part.as_bytes());
    }
    format!("{:x}", h.finalize())
}

pub fn audit_log_insert(
    conn: &Connection,
    action: &str,
    entity_type: &str,
    entity_id: &str,
    entity_name: &str,
    outcome: &str,
    details: &str,
) -> Result<(), String> {
    let id = Uuid::new_v4().to_string();
    let ts = Utc::now().timestamp();

    // CRIT-A3: fetch the last chain_hash to extend the chain.
    // If the table is empty, use the genesis sentinel.
    let prev_hash: String = conn
        .query_row(
            "SELECT chain_hash FROM audit_log ORDER BY timestamp DESC, rowid DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "GENESIS".to_string());
    // Treat legacy empty-string hashes the same as GENESIS so the chain
    // restarts cleanly after the migration rather than chaining off "".
    let prev_hash = if prev_hash.is_empty() { "GENESIS".to_string() } else { prev_hash };

    let chain_hash = audit_chain_hash(&prev_hash, &id, ts, action, entity_type, entity_id, entity_name, outcome, details);

    conn.execute(
        "INSERT INTO audit_log \
         (id, timestamp, action, entity_type, entity_id, entity_name, outcome, details, chain_hash) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![id, ts, action, entity_type, entity_id, entity_name, outcome, details, chain_hash],
    )
    .map_err(|e| format!("audit_log_insert: {}", e))?;
    Ok(())
}

pub fn audit_log_list(conn: &Connection, limit: i64, offset: i64) -> Result<Vec<AuditEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, timestamp, action, entity_type, entity_id, entity_name, outcome, details, chain_hash \
             FROM audit_log ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2",
        )
        .map_err(|e| format!("audit_log_list prepare: {}", e))?;

    let rows = stmt
        .query_map(params![limit, offset], |row| {
            Ok(AuditEntry {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                action: row.get(2)?,
                entity_type: row.get(3)?,
                entity_id: row.get(4)?,
                entity_name: row.get(5)?,
                outcome: row.get(6)?,
                details: row.get(7)?,
                chain_hash: row.get(8)?,
            })
        })
        .map_err(|e| format!("audit_log_list query: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("audit_log_list collect: {}", e))?;

    Ok(rows)
}

/// CRIT-A3: verify the integrity of the entire audit log hash chain.
/// Reads all entries in chronological order (ASC) and recomputes each hash.
pub fn audit_log_verify(conn: &Connection) -> Result<AuditVerifyResult, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, timestamp, action, entity_type, entity_id, entity_name, outcome, details, chain_hash \
             FROM audit_log ORDER BY timestamp ASC, rowid ASC",
        )
        .map_err(|e| format!("audit_log_verify prepare: {}", e))?;

    let all: Vec<AuditEntry> = stmt
        .query_map([], |row| {
            Ok(AuditEntry {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                action: row.get(2)?,
                entity_type: row.get(3)?,
                entity_id: row.get(4)?,
                entity_name: row.get(5)?,
                outcome: row.get(6)?,
                details: row.get(7)?,
                chain_hash: row.get(8)?,
            })
        })
        .map_err(|e| format!("audit_log_verify query: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("audit_log_verify collect: {}", e))?;

    let mut entries = Vec::with_capacity(all.len());
    let mut prev_hash = "GENESIS".to_string();
    let mut tampered_count = 0usize;
    let mut legacy_count = 0usize;

    for entry in all {
        let is_legacy = entry.chain_hash.is_empty();
        if is_legacy {
            legacy_count += 1;
            // Legacy entry: cannot verify. Reset prev_hash so the next
            // post-v13 entry still has a valid predecessor.
            prev_hash = "GENESIS".to_string();
            entries.push(AuditVerifyEntry { entry, hash_valid: true, is_legacy: true });
            continue;
        }

        let expected = audit_chain_hash(
            &prev_hash,
            &entry.id,
            entry.timestamp,
            &entry.action,
            &entry.entity_type,
            &entry.entity_id,
            &entry.entity_name,
            &entry.outcome,
            &entry.details,
        );
        let hash_valid = entry.chain_hash == expected;
        if !hash_valid {
            tampered_count += 1;
        }
        prev_hash = entry.chain_hash.clone();
        entries.push(AuditVerifyEntry { entry, hash_valid, is_legacy: false });
    }

    let chain_intact = tampered_count == 0;
    // Return in descending order for the UI (newest first)
    entries.reverse();
    Ok(AuditVerifyResult {
        entries,
        chain_intact,
        legacy_count,
        tampered_count,
    })
}
