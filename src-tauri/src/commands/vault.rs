use crate::state::AppState;
use crate::error::AppError;
use crate::{lock_err, current_unix_secs, touch_activity};
use crate::encryption;
use crate::database;
use serde::{Deserialize, Serialize};

// ── M-5: escalating, persistent unlock lockout ────────────────────────────
//
// Five consecutive wrong passwords lock the vault for an *increasing* duration:
//   30 s → 1 m → 2 m → 5 m → 10 m → 30 m → 1 h cap.
// The consecutive-lockout count is persisted to `lockout_state.json` so an
// attacker cannot bypass the backoff by restarting the app. Successful unlock
// resets both the failure counter and the lockout counter to 0.

#[derive(Serialize, Deserialize, Default)]
struct LockoutState {
    consecutive_lockouts: u32,
}

pub(crate) fn lockout_path(data_dir: &str) -> std::path::PathBuf {
    std::path::Path::new(data_dir).join("lockout_state.json")
}

pub(crate) fn load_lockout_count(data_dir: &str) -> u32 {
    std::fs::read_to_string(lockout_path(data_dir))
        .ok()
        .and_then(|s| serde_json::from_str::<LockoutState>(&s).ok())
        .map(|s| s.consecutive_lockouts)
        .unwrap_or(0)
}

fn save_lockout_count(data_dir: &str, count: u32) {
    let path = lockout_path(data_dir);
    let state = LockoutState { consecutive_lockouts: count };
    if let Ok(json) = serde_json::to_string(&state) {
        if let Err(e) = std::fs::write(&path, json) {
            tracing::warn!("Failed to persist lockout state to {:?}: {}", path, e);
            return;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }
}

fn lockout_duration_secs(consecutive_lockouts: u32) -> u64 {
    match consecutive_lockouts {
        0 | 1 => 30,    // first lockout
        2     => 60,    // 1 m
        3     => 120,   // 2 m
        4     => 300,   // 5 m
        5     => 600,   // 10 m
        6     => 1800,  // 30 m
        _     => 3600,  // 1 h cap
    }
}

/// HIGH-A7: Write `value` to `config_path` atomically via a temp-file + rename.
///
/// On POSIX, `rename(2)` is atomic within the same filesystem.
/// On Windows, `std::fs::rename` uses `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`,
/// which is also atomic for local NTFS volumes.
///
/// If the process crashes AFTER `write(&tmp)` but BEFORE `rename`, the next
/// startup finds the `.tmp` file, ignores it, and falls back to the previous
/// intact `config.json`.  No half-written state is ever exposed.
fn write_config_atomic(config_path: &str, value: &serde_json::Value) -> Result<(), AppError> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|e| AppError::Internal(format!("JSON serialization: {}", e)))?;
    let tmp_path = format!("{}.tmp", config_path);
    std::fs::write(&tmp_path, &json)
        .map_err(|e| AppError::Internal(format!("Failed to write temp config {}: {}", tmp_path, e)))?;
    std::fs::rename(&tmp_path, config_path)
        .map_err(|e| AppError::Internal(format!("Failed to atomically replace config.json: {}", e)))?;
    Ok(())
}

/// M-4: restrict permissions on config.json to owner-only after every write.
/// On Unix → mode 0600. On Windows the parent directory (%LOCALAPPDATA%) is
/// already user-private by default ACL, so no extra hardening is applied here.
fn restrict_config_perms(path: &str) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)) {
            tracing::warn!("Failed to chmod 0600 on {}: {}", path, e);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path; // suppress unused-var on Windows
    }
}

// MED-A7: `first_run` was previously bundled into VaultStatus, which is
// callable pre-auth — leaking whether the vault has ever been set up to any
// process that can invoke Tauri commands.  Splitting it into a dedicated
// `is_first_run` command keeps the concerns separate and makes the info-leak
// surface explicit and auditable.  Both endpoints are still pre-auth by
// necessity (the UI must decide which screen to show before login), but the
// intent of each call is now unambiguous.

#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
pub struct VaultStatus {
    pub unlocked: bool,
}

#[tauri::command]
pub fn is_vault_unlocked(state: tauri::State<AppState>) -> VaultStatus {
    let key_guard = state.encryption_key.read().unwrap_or_else(|e| e.into_inner());
    VaultStatus {
        unlocked: key_guard.is_some(),
    }
}

/// MED-A7: intentionally pre-auth — the UI needs this to decide whether to show
/// the "Create master password" wizard or the "Unlock" screen.
#[tauri::command]
pub fn is_first_run(state: tauri::State<AppState>) -> bool {
    let token_guard = state.verification_token.read().unwrap_or_else(|e| e.into_inner());
    token_guard.is_none()
}

#[derive(Deserialize)]
pub struct SetMasterPasswordRequest {
    password: String,
}

#[tauri::command]
pub fn set_master_password(
    state: tauri::State<AppState>,
    request: SetMasterPasswordRequest,
) -> Result<(), crate::error::AppError> {
    if request.password.len() < 8 {
        return Err(crate::error::AppError::Validation(
            "Master password must be at least 8 characters".to_string(),
        ));
    }

    // ── Guard: prevent destructive re-init of an already-configured vault ──
    {
        let token_guard = state
            .verification_token
            .read()
            .map_err(|e| lock_err(e))?;
        if token_guard.is_some() {
            tracing::warn!("set_master_password rejected: vault already initialized");
            return Err(crate::error::AppError::Validation(
                "Vault is already initialized. Use change_master_password to update it.".to_string(),
            ));
        }
    }

    use secrecy::ExposeSecret;
    use zeroize::Zeroize;

    let salt = encryption::generate_salt();
    let secret_pwd = secrecy::SecretString::new(request.password);
    let mut key = encryption::derive_key(secret_pwd.expose_secret(), &salt, encryption::DEFAULT_KDF_ITERATIONS);
    let token = encryption::create_verification_token(&key)?;

    let config = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &salt),
        "verification_token": token,
        "kdf": {
            "algorithm": "pbkdf2-hmac-sha256",
            "iterations": encryption::DEFAULT_KDF_ITERATIONS,
        }
    });
    // HIGH-A7: write config atomically (temp file + rename) so a crash between
    // write and sync cannot leave a half-written config.json.
    write_config_atomic(&state.config_path, &config)?;
    restrict_config_perms(&state.config_path);

    *state.encryption_key.write().map_err(|e| lock_err(e))? = Some(key);
    *state.salt.write().map_err(|e| lock_err(e))? = Some(salt.to_vec());
    *state.verification_token.write().map_err(|e| lock_err(e))? = Some(token);
    *state.kdf_iterations.write().map_err(|e| lock_err(e))? = encryption::DEFAULT_KDF_ITERATIONS;

    tracing::info!("Master password set (first run, {} PBKDF2 iterations)", encryption::DEFAULT_KDF_ITERATIONS);
    touch_activity(&state);

    key.zeroize();

    Ok(())
}

#[derive(Deserialize)]
pub struct ChangeMasterPasswordRequest {
    old_password: String,
    new_password: String,
}

#[tauri::command]
pub fn change_master_password(
    state: tauri::State<AppState>,
    request: ChangeMasterPasswordRequest,
) -> Result<(), crate::error::AppError> {
    if request.new_password.len() < 8 {
        return Err(crate::error::AppError::Validation(
            "New master password must be at least 8 characters".to_string(),
        ));
    }

    // HIGH-A7: serialize concurrent re-key operations.
    // Without this lock, two concurrent calls could both read the old key,
    // both start re-encrypting, and the second COMMIT would double-encrypt
    // the already-new-key ciphertext — producing permanently unreadable blobs.
    // The lock is held for the entire duration: DB re-encrypt + config.json
    // write + RAM key swap.
    let _rekey_guard = state.rekey_lock.lock().map_err(|e| lock_err(e))?;

    use secrecy::ExposeSecret;
    use zeroize::Zeroize;

    let secret_old = secrecy::SecretString::new(request.old_password);
    let secret_new = secrecy::SecretString::new(request.new_password);

    let salt = {
        let salt_guard = state.salt.read().map_err(|e| lock_err(e))?;
        salt_guard
            .as_ref()
            .ok_or("Vault not configured")?
            .clone()
    };
    let token = {
        let token_guard = state
            .verification_token
            .read()
            .map_err(|e| lock_err(e))?;
        token_guard
            .as_ref()
            .ok_or("Vault not initialized")?
            .clone()
    };
    let old_iters = *state.kdf_iterations.read().map_err(|e| lock_err(e))?;

    let mut old_key = encryption::derive_key(secret_old.expose_secret(), &salt, old_iters);
    if !encryption::verify_master_password(&token, &old_key) {
        old_key.zeroize();
        tracing::warn!("change_master_password rejected: old password incorrect");
        return Err(crate::error::AppError::AuthFailed(
            "La master password corrente non è corretta".to_string(),
        ));
    }

    let new_salt = encryption::generate_salt();
    let mut new_key = encryption::derive_key(secret_new.expose_secret(), &new_salt, encryption::DEFAULT_KDF_ITERATIONS);
    let new_token = encryption::create_verification_token(&new_key)?;

    {
        let db = state.db.get().map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;

        db.execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| crate::error::AppError::Internal(format!("Failed to begin re-key transaction: {}", e)))?;

        let re_key_result: Result<(), crate::error::AppError> = (|| {
            let connections = database::get_connections(&db)?;
            for c in &connections {
                let new_pwd = c
                    .password_encrypted
                    .as_ref()
                    .and_then(|ct| encryption::decrypt_auto(ct, &old_key).ok())
                    .and_then(|pt| encryption::encrypt_v2(&pt, &new_key).ok());
                let new_key_blob = c
                    .private_key_encrypted
                    .as_ref()
                    .and_then(|ct| encryption::decrypt_auto(ct, &old_key).ok())
                    .and_then(|pt| encryption::encrypt_v2(&pt, &new_key).ok());
                if new_pwd.is_some() || new_key_blob.is_some() {
                    db.execute(
                        "UPDATE connections SET password_encrypted = ?1, private_key_encrypted = ?2 WHERE id = ?3",
                        rusqlite::params![new_pwd, new_key_blob, c.id],
                    )
                    .map_err(|e| format!("Failed to re-encrypt connection {}: {}", c.id, e))?;
                }
            }

            let profiles = database::get_credential_profiles(&db)?;
            for p in &profiles {
                let new_pwd = p
                    .password_encrypted
                    .as_ref()
                    .and_then(|ct| encryption::decrypt_auto(ct, &old_key).ok())
                    .and_then(|pt| encryption::encrypt_v2(&pt, &new_key).ok());
                let new_key_blob = p
                    .private_key_encrypted
                    .as_ref()
                    .and_then(|ct| encryption::decrypt_auto(ct, &old_key).ok())
                    .and_then(|pt| encryption::encrypt_v2(&pt, &new_key).ok());
                if new_pwd.is_some() || new_key_blob.is_some() {
                    db.execute(
                        "UPDATE credential_profiles SET password_encrypted = ?1, private_key_encrypted = ?2 WHERE id = ?3",
                        rusqlite::params![new_pwd, new_key_blob, p.id],
                    )
                    .map_err(|e| format!("Failed to re-encrypt credential profile {}: {}", p.id, e))?;
                }
            }

            let ssh_keys = database::ssh_key_list(&db)?;
            for k in &ssh_keys {
                let new_priv = encryption::decrypt_auto(&k.private_key_encrypted, &old_key)
                    .ok()
                    .and_then(|pt| encryption::encrypt_v2(&pt, &new_key).ok());
                if let Some(ref enc) = new_priv {
                    db.execute(
                        "UPDATE ssh_keys SET private_key_encrypted = ?1 WHERE id = ?2",
                        rusqlite::params![enc, k.id],
                    )
                    .map_err(|e| format!("Failed to re-encrypt ssh_key {}: {}", k.id, e))?;
                }
            }

            Ok(())
        })();

        match re_key_result {
            Ok(()) => {
                db.execute_batch("COMMIT")
                    .map_err(|e| crate::error::AppError::Internal(format!("Failed to commit re-key: {}", e)))?;
            }
            Err(e) => {
                let _ = db.execute_batch("ROLLBACK");
                old_key.zeroize();
                new_key.zeroize();
                return Err(e);
            }
        }
    }

    let config = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &new_salt),
        "verification_token": new_token,
        "kdf": {
            "algorithm": "pbkdf2-hmac-sha256",
            "iterations": encryption::DEFAULT_KDF_ITERATIONS,
        }
    });
    // HIGH-A7: atomic config write — crash between DB COMMIT and config.json
    // update would leave the DB encrypted with new_key but the file pointing
    // at old_salt (=> permanent data loss on restart).  Writing to .tmp then
    // renaming is crash-safe: either the old or the new file is intact.
    write_config_atomic(&state.config_path, &config)
        .map_err(|e| {
            // Config write failed after DB was already committed.
            // Log the critical situation; the vault is now inconsistent.
            tracing::error!(
                "CRITICAL: DB re-keyed but config.json write failed: {}. \
                 The vault may be unrecoverable without manual intervention.",
                e
            );
            e
        })?;
    restrict_config_perms(&state.config_path);

    *state.encryption_key.write().map_err(|e| lock_err(e))? = Some(new_key);
    *state.salt.write().map_err(|e| lock_err(e))? = Some(new_salt.to_vec());
    *state.verification_token.write().map_err(|e| lock_err(e))? = Some(new_token);
    *state.kdf_iterations.write().map_err(|e| lock_err(e))? = encryption::DEFAULT_KDF_ITERATIONS;

    tracing::info!("Master password changed (re-keyed to {} PBKDF2 iterations)", encryption::DEFAULT_KDF_ITERATIONS);
    touch_activity(&state);

    old_key.zeroize();
    new_key.zeroize();

    Ok(())
}

#[derive(Deserialize)]
pub struct UnlockVaultRequest {
    password: String,
}

#[tauri::command]
pub fn unlock_vault(
    state: tauri::State<AppState>,
    request: UnlockVaultRequest,
) -> Result<(), crate::error::AppError> {
    use secrecy::ExposeSecret;
    use std::sync::atomic::Ordering;
    use zeroize::Zeroize;

    // MED-A2: serialize the entire unlock flow.
    //
    // Without this lock, a concurrent wrong-password attempt can race with a
    // correct-password attempt.  The dangerous interleaving:
    //
    //   Thread B (wrong pw):  fetch_add(fail_count) → 5
    //                         fetch_add(lockout_count) → 1
    //                         store(lockout_until = now+30)   ← sets lockout
    //   Thread A (right pw):  store(fail_count=0)
    //                         swap(lockout_count, 0)
    //                         store(lockout_until = 0)         ← A clears lockout
    //   Thread B (continues): store(lockout_until = now+30)    ← B re-sets AFTER A cleared!
    //
    // Net result: vault IS unlocked in RAM, but the next lock+unlock (correct
    // password) is rejected until the 30 s timer expires.
    //
    // Holding the mutex through PBKDF2 (~200 ms) is acceptable on a single-user
    // desktop application — concurrent unlock calls are essentially impossible
    // in normal usage.
    let _unlock_guard = state.unlock_mutex.lock().map_err(|e| lock_err(e))?;

    let now = current_unix_secs();
    let lockout_until = state.unlock_lockout_until.load(Ordering::Relaxed);
    if now < lockout_until {
        return Err(crate::error::AppError::AuthFailed(format!(
            "Too many failed attempts. Try again in {} seconds.",
            lockout_until - now
        )));
    }

    let salt = {
        let salt_guard = state.salt.read().map_err(|e| lock_err(e))?;
        salt_guard
            .as_ref()
            .ok_or("Vault not configured — set a master password first")?
            .clone()
    };

    let iterations = *state.kdf_iterations.read().map_err(|e| lock_err(e))?;
    let secret_pwd = secrecy::SecretString::new(request.password);
    let mut key = encryption::derive_key(secret_pwd.expose_secret(), &salt, iterations);

    let token = {
        let token_guard = state.verification_token.read().map_err(|e| lock_err(e))?;
        token_guard.as_ref().ok_or("Verification token missing")?.clone()
    };

    if !encryption::verify_master_password(&token, &key) {
        key.zeroize();
        let fails = state.unlock_fail_count.fetch_add(1, Ordering::Relaxed) + 1;
        if fails >= 5 {
            // M-5: escalating, persistent lockout
            let new_lockout_count = state.unlock_lockout_count.fetch_add(1, Ordering::Relaxed) + 1;
            let delay = lockout_duration_secs(new_lockout_count);
            state.unlock_lockout_until.store(current_unix_secs() + delay, Ordering::Relaxed);
            state.unlock_fail_count.store(0, Ordering::Relaxed);
            save_lockout_count(&state.data_dir, new_lockout_count);
            tracing::warn!(
                "unlock_vault: 5 consecutive failures (lockout #{}) — locking out for {}s",
                new_lockout_count, delay
            );
            return Err(crate::error::AppError::AuthFailed(format!(
                "Too many failed attempts. Vault locked for {} seconds (lockout #{}).",
                delay, new_lockout_count
            )));
        }
        tracing::warn!("unlock_vault: wrong password (attempt {})", fails);
        return Err(crate::error::AppError::AuthFailed("Wrong master password".to_string()));
    }

    // M-5: successful unlock → clear both counters and persist the reset
    state.unlock_fail_count.store(0, Ordering::Relaxed);
    if state.unlock_lockout_count.swap(0, Ordering::Relaxed) > 0 {
        save_lockout_count(&state.data_dir, 0);
    }
    state.unlock_lockout_until.store(0, Ordering::Relaxed);
    touch_activity(&state);

    *state.encryption_key.write().map_err(|e| lock_err(e))? = Some(key);
    key.zeroize();
    {
        let db = state.db.get().map_err(|e| format!("DB pool: {}", e))?;
        let _ = database::audit_log_insert(&db, "unlock", "vault", "vault", "vault", "success", "");
    }
    Ok(())
}

#[tauri::command]
pub fn lock_vault(app: tauri::AppHandle, state: tauri::State<AppState>) {
    use zeroize::Zeroize;
    {
        let mut key_guard = state.encryption_key.write().unwrap_or_else(|e| e.into_inner());
        if let Some(ref mut key) = *key_guard {
            key.zeroize();
        }
        *key_guard = None;
    }

    state.ssh_sessions.clear();
    state.shell_sessions.clear();
    state.docker_exec_sessions.clear();
    state.sftp_pool.clear(); // MED-A3: drop cached SFTP sessions on explicit lock
    for mut entry in state.rdp_processes.iter_mut() {
        let _ = entry.value_mut().kill();
    }
    state.rdp_processes.clear();
    state.rdp_sessions.clear();

    {
        if let Ok(db) = state.db.get() {
            let _ = database::audit_log_insert(&db, "lock", "vault", "vault", "vault", "success", "");
        }
    }
    let _ = tauri::Emitter::emit(&app, "vault:locked", ());
    tracing::info!("Vault locked — all sessions terminated");
}

// MED-A11: allow user to opt out of single-instance enforcement.
// The setting is persisted to config.json and takes effect on next launch.
#[tauri::command]
pub fn get_allow_multiple_instances(state: tauri::State<AppState>) -> bool {
    let config_str = std::fs::read_to_string(&state.config_path).unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&config_str)
        .ok()
        .and_then(|c| c["allow_multiple_instances"].as_bool())
        .unwrap_or(false)
}

#[tauri::command]
pub fn set_allow_multiple_instances(
    state: tauri::State<AppState>,
    allow: bool,
) -> Result<(), crate::error::AppError> {
    let config_str = std::fs::read_to_string(&state.config_path).unwrap_or_default();
    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .unwrap_or_else(|_| serde_json::json!({}));
    config["allow_multiple_instances"] = serde_json::json!(allow);
    write_config_atomic(&state.config_path, &config)?;
    tracing::info!("allow_multiple_instances set to {} (takes effect on next launch)", allow);
    Ok(())
}

#[tauri::command]
pub fn set_auto_lock_timeout(
    state: tauri::State<AppState>,
    secs: u64,
) -> Result<(), crate::error::AppError> {
    *state.auto_lock_secs.write().map_err(|e| lock_err(e))? = secs;

    // MED-A1: persist the setting so it survives a restart.
    // We merge it into the existing config.json (keeping salt, token, kdf intact).
    let config_str = std::fs::read_to_string(&state.config_path).unwrap_or_default();
    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .unwrap_or_else(|_| serde_json::json!({}));
    config["auto_lock_secs"] = serde_json::json!(secs);
    // HIGH-A7: use atomic write here too for consistency
    if write_config_atomic(&state.config_path, &config).is_ok() {
        restrict_config_perms(&state.config_path);
    }

    if secs == 0 {
        tracing::info!("Auto-lock disabled (persisted)");
    } else {
        tracing::info!("Auto-lock timeout set to {}s (persisted)", secs);
    }
    Ok(())
}
