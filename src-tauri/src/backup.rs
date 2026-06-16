// Full vault backup/restore (MED-A10). Bundles the encrypted database, config,
// lockout state, pinned certs, known_hosts and recordings into a single .zip.
// The data is already encrypted at rest (AES-256-GCM), so the archive inherits
// that protection — the master password is still required to decrypt anything.

use std::io::{Read, Write};
use std::path::Path;
use tauri::Emitter;
use zip::write::SimpleFileOptions;

// Top-level files included in a backup. Logs, compiled helpers and the RDP
// helper binary are intentionally excluded (regenerable / not user data).
const BACKUP_FILES: &[&str] = &[
    "connections.db",
    "config.json",
    "known_hosts.json",
    "lockout_state.json",
    "proxmox_certs.json",
];

/// Creates a .zip backup of the vault at `target`. Returns the file count.
#[tauri::command]
pub async fn vault_backup(
    state: tauri::State<'_, crate::state::AppState>,
    target: String,
) -> Result<usize, String> {
    let data_dir = state.data_dir.clone();
    tokio::task::spawn_blocking(move || {
        let file = std::fs::File::create(&target)
            .map_err(|e| format!("Cannot create backup file: {}", e))?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut count = 0usize;

        for name in BACKUP_FILES {
            let path = Path::new(&data_dir).join(name);
            if path.exists() {
                zip.start_file(*name, opts).map_err(|e| e.to_string())?;
                let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
                zip.write_all(&bytes).map_err(|e| e.to_string())?;
                count += 1;
            }
        }

        // recordings/ — recurse one level (flat directory of .cast/.cast.enc).
        let rec_dir = Path::new(&data_dir).join("recordings");
        if rec_dir.is_dir() {
            for entry in std::fs::read_dir(&rec_dir).map_err(|e| e.to_string())?.flatten() {
                if entry.path().is_file() {
                    let fname = entry.file_name().to_string_lossy().to_string();
                    zip.start_file(format!("recordings/{}", fname), opts)
                        .map_err(|e| e.to_string())?;
                    let bytes = std::fs::read(entry.path()).map_err(|e| e.to_string())?;
                    zip.write_all(&bytes).map_err(|e| e.to_string())?;
                    count += 1;
                }
            }
        }

        zip.finish().map_err(|e| e.to_string())?;
        Ok(count)
    })
    .await
    .map_err(|e| format!("Backup task failed: {}", e))?
}

/// Name of the staging directory where a restore is unpacked before being
/// applied at the next startup (so the live DB is never overwritten in place).
const STAGING_DIR: &str = ".restore_staging";

/// Validates and unpacks a backup .zip into a staging directory. The actual
/// overwrite happens at the next startup via `apply_staged_restore`, BEFORE the
/// database is opened. Returns the number of files staged. Emits `vault:restored`.
#[tauri::command]
pub async fn vault_restore(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    source: String,
) -> Result<usize, String> {
    let data_dir = state.data_dir.clone();
    let count = tokio::task::spawn_blocking(move || {
        let staging = Path::new(&data_dir).join(STAGING_DIR);
        // Start clean so a previous aborted restore can't leak stale files.
        let _ = std::fs::remove_dir_all(&staging);
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

        let file = std::fs::File::open(&source)
            .map_err(|e| format!("Cannot open backup: {}", e))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("Invalid backup archive: {}", e))?;
        let mut count = 0usize;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().to_string();
            // Path-traversal guard: reject absolute paths and ".." segments.
            if name.contains("..") || Path::new(&name).is_absolute() {
                let _ = std::fs::remove_dir_all(&staging);
                return Err(format!("Refusing unsafe path in archive: {}", name));
            }
            let out_path = staging.join(&name);
            if name.ends_with('/') {
                std::fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
                continue;
            }
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut buf = Vec::new();
            entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            std::fs::write(&out_path, &buf).map_err(|e| e.to_string())?;
            count += 1;
        }
        if count == 0 {
            let _ = std::fs::remove_dir_all(&staging);
            return Err("Backup archive is empty".into());
        }
        Ok::<usize, String>(count)
    })
    .await
    .map_err(|e| format!("Restore task failed: {}", e))??;

    let _ = app.emit("vault:restored", count);
    Ok(count)
}

/// Applies a staged restore (if present) by moving files from the staging dir
/// into the data dir, overwriting the existing vault. Called once at startup
/// BEFORE the database is opened. The staging dir is removed when done.
pub fn apply_staged_restore(data_dir: &Path) -> Result<(), String> {
    let staging = data_dir.join(STAGING_DIR);
    if !staging.is_dir() {
        return Ok(());
    }
    tracing::warn!("Applying staged vault restore from {}", staging.display());

    // Downgrade guard: refuse to restore a database created by a NEWER schema
    // version than this build understands (its extra columns/tables would be
    // silently ignored, risking data loss on the next write). Leave the staging
    // dir in place so the user can retry with a matching/newer build.
    let staged_db = staging.join("connections.db");
    if staged_db.is_file() {
        if let Ok(conn) = rusqlite::Connection::open_with_flags(
            &staged_db,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            let ver: i32 = conn
                .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |r| r.get(0))
                .unwrap_or(0);
            if ver > crate::database::CURRENT_SCHEMA_VERSION {
                return Err(format!(
                    "Backup was created by a newer version of NexoRC (schema v{}, this build supports v{}). \
                     Update NexoRC before restoring. Staged files left untouched.",
                    ver,
                    crate::database::CURRENT_SCHEMA_VERSION
                ));
            }
        }
    }

    fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<()> {
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            let target = dst.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                std::fs::create_dir_all(&target)?;
                copy_tree(&entry.path(), &target)?;
            } else {
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::copy(entry.path(), &target)?;
            }
        }
        Ok(())
    }

    copy_tree(&staging, data_dir).map_err(|e| format!("apply restore: {}", e))?;
    std::fs::remove_dir_all(&staging).map_err(|e| format!("cleanup staging: {}", e))?;
    tracing::info!("Staged vault restore applied successfully");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_staging_is_noop() {
        let dir = tempfile::tempdir().unwrap();
        // No staging dir present → returns Ok, does nothing.
        assert!(apply_staged_restore(dir.path()).is_ok());
    }

    #[test]
    fn applies_and_clears_staging() {
        let dir = tempfile::tempdir().unwrap();
        let staging = dir.path().join(STAGING_DIR);
        std::fs::create_dir_all(staging.join("recordings")).unwrap();
        std::fs::write(staging.join("connections.db"), b"NEWDB").unwrap();
        std::fs::write(staging.join("recordings/a.cast"), b"REC").unwrap();
        // An older file that must be overwritten.
        std::fs::write(dir.path().join("connections.db"), b"OLD").unwrap();

        apply_staged_restore(dir.path()).unwrap();

        assert_eq!(std::fs::read(dir.path().join("connections.db")).unwrap(), b"NEWDB");
        assert_eq!(std::fs::read(dir.path().join("recordings/a.cast")).unwrap(), b"REC");
        assert!(!staging.exists(), "staging dir should be removed after apply");
    }
}
