use crate::database;
use crate::encryption;
use crate::error::AppError;
use crate::locked_key::MlockedKey;
use crate::state::AppState;
use crate::{current_unix_secs, lock_err, touch_activity};
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
    let state = LockoutState {
        consecutive_lockouts: count,
    };
    if let Ok(json) = serde_json::to_string(&state) {
        if let Err(e) = std::fs::write(&path, json) {
            tracing::warn!("Failed to persist lockout state to {:?}: {}", path, e);
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
        0 | 1 => 30, // first lockout
        2 => 60,     // 1 m
        3 => 120,    // 2 m
        4 => 300,    // 5 m
        5 => 600,    // 10 m
        6 => 1800,   // 30 m
        _ => 3600,   // 1 h cap
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
    std::fs::write(&tmp_path, &json).map_err(|e| {
        AppError::Internal(format!("Failed to write temp config {}: {}", tmp_path, e))
    })?;
    std::fs::rename(&tmp_path, config_path).map_err(|e| {
        AppError::Internal(format!("Failed to atomically replace config.json: {}", e))
    })?;
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
    let key_guard = state
        .encryption_key
        .read()
        .unwrap_or_else(|e| e.into_inner());
    VaultStatus {
        unlocked: key_guard.is_some(),
    }
}

/// MED-A7: intentionally pre-auth — the UI needs this to decide whether to show
/// the "Create master password" wizard or the "Unlock" screen.
#[tauri::command]
pub fn is_first_run(state: tauri::State<AppState>) -> bool {
    let token_guard = state
        .verification_token
        .read()
        .unwrap_or_else(|e| e.into_inner());
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
        let token_guard = state.verification_token.read().map_err(lock_err)?;
        if token_guard.is_some() {
            tracing::warn!("set_master_password rejected: vault already initialized");
            return Err(crate::error::AppError::Validation(
                "Vault is already initialized. Use change_master_password to update it."
                    .to_string(),
            ));
        }
    }

    use secrecy::ExposeSecret;
    use zeroize::Zeroize;

    let salt = encryption::generate_salt();
    let kdf = encryption::KdfParams::default_argon2id();
    let secret_pwd = secrecy::SecretString::new(request.password);
    let mut key = encryption::derive_key_params(secret_pwd.expose_secret(), &salt, &kdf)
        .map_err(crate::error::AppError::Internal)?;
    let token = encryption::create_verification_token(&key)?;

    let config = serde_json::json!({
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, salt),
        "verification_token": token,
        "kdf": kdf.to_config_json(),
    });
    // HIGH-A7: write config atomically (temp file + rename) so a crash between
    // write and sync cannot leave a half-written config.json.
    write_config_atomic(&state.config_path, &config)?;
    restrict_config_perms(&state.config_path);

    *state.encryption_key.write().map_err(lock_err)? = Some(MlockedKey::new(key));
    *state.salt.write().map_err(lock_err)? = Some(salt.to_vec());
    *state.verification_token.write().map_err(lock_err)? = Some(token);
    *state.kdf_params.write().map_err(lock_err)? = kdf;

    tracing::info!(
        "Master password set (Argon2id m={} t={} p={})",
        encryption::DEFAULT_ARGON2_M_COST,
        encryption::DEFAULT_ARGON2_T_COST,
        encryption::DEFAULT_ARGON2_P_COST,
    );
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
    let _rekey_guard = state.rekey_lock.lock().map_err(lock_err)?;

    use secrecy::ExposeSecret;
    use zeroize::Zeroize;

    let secret_old = secrecy::SecretString::new(request.old_password);
    let secret_new = secrecy::SecretString::new(request.new_password);

    let salt = {
        let salt_guard = state.salt.read().map_err(lock_err)?;
        salt_guard.as_ref().ok_or("Vault not configured")?.clone()
    };
    let token = {
        let token_guard = state.verification_token.read().map_err(lock_err)?;
        token_guard.as_ref().ok_or("Vault not initialized")?.clone()
    };
    let old_kdf = state.kdf_params.read().map_err(lock_err)?.clone();

    let mut old_key =
        encryption::derive_key_params(secret_old.expose_secret(), &salt, &old_kdf)
            .map_err(crate::error::AppError::Internal)?;
    if !encryption::verify_master_password(&token, &old_key) {
        old_key.zeroize();
        tracing::warn!("change_master_password rejected: old password incorrect");
        return Err(crate::error::AppError::AuthFailed(
            "La master password corrente non è corretta".to_string(),
        ));
    }

    let new_salt = encryption::generate_salt();
    let new_kdf = encryption::KdfParams::default_argon2id();
    let mut new_key =
        encryption::derive_key_params(secret_new.expose_secret(), &new_salt, &new_kdf)
            .map_err(|e| { old_key.zeroize(); crate::error::AppError::Internal(e) })?;
    let new_token = encryption::create_verification_token(&new_key)?;

    {
        let db = state
            .db
            .get()
            .map_err(|e| crate::error::AppError::Internal(format!("DB pool: {}", e)))?;

        db.execute_batch("BEGIN IMMEDIATE").map_err(|e| {
            crate::error::AppError::Internal(format!("Failed to begin re-key transaction: {}", e))
        })?;

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
                db.execute_batch("COMMIT").map_err(|e| {
                    crate::error::AppError::Internal(format!("Failed to commit re-key: {}", e))
                })?;
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
        "salt": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, new_salt),
        "verification_token": new_token,
        "kdf": new_kdf.to_config_json(),
    });
    // HIGH-A7: atomic config write — crash between DB COMMIT and config.json
    // update would leave the DB encrypted with new_key but the file pointing
    // at old_salt (=> permanent data loss on restart).  Writing to .tmp then
    // renaming is crash-safe: either the old or the new file is intact.
    write_config_atomic(&state.config_path, &config).map_err(|e| {
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

    *state.encryption_key.write().map_err(lock_err)? = Some(MlockedKey::new(new_key));
    *state.salt.write().map_err(lock_err)? = Some(new_salt.to_vec());
    *state.verification_token.write().map_err(lock_err)? = Some(new_token);
    *state.kdf_params.write().map_err(lock_err)? = new_kdf;

    tracing::info!(
        "Master password changed (re-keyed to Argon2id m={} t={} p={})",
        encryption::DEFAULT_ARGON2_M_COST,
        encryption::DEFAULT_ARGON2_T_COST,
        encryption::DEFAULT_ARGON2_P_COST,
    );
    touch_activity(&state);

    old_key.zeroize();
    new_key.zeroize();

    Ok(())
}

/// Silently re-keys a PBKDF2 vault to Argon2id in-place.
///
/// Called once after the first successful unlock of a legacy vault while
/// `unlock_mutex` is held.  Acquires `rekey_lock` internally to serialize
/// with any concurrent `change_master_password` call.
///
/// Returns `true` if the migration committed; on any failure it logs the
/// error and returns `false` — the caller stores the original PBKDF2 key so
/// the vault is still usable.
fn migrate_kdf_to_argon2id(
    state: &tauri::State<AppState>,
    old_key: &[u8; 32],
    password: &str,
) -> bool {
    use zeroize::Zeroize;

    let _rekey_guard = match state.rekey_lock.lock() {
        Ok(g) => g,
        Err(_) => {
            tracing::warn!("KDF migration: rekey_lock poisoned, skipping");
            return false;
        }
    };

    // Re-check under lock — a concurrent change_master_password may have
    // already migrated while we were waiting.
    {
        let params = match state.kdf_params.read() {
            Ok(g) => g.clone(),
            Err(_) => return false,
        };
        if !params.needs_migration() {
            return false;
        }
    }

    let new_salt = encryption::generate_salt();
    let new_kdf = encryption::KdfParams::default_argon2id();
    let mut new_key = match encryption::derive_key_params(password, &new_salt, &new_kdf) {
        Ok(k) => k,
        Err(e) => {
            tracing::warn!("KDF migration: Argon2id derivation failed: {e}");
            return false;
        }
    };
    let new_token = match encryption::create_verification_token(&new_key) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("KDF migration: token creation failed: {e}");
            new_key.zeroize();
            return false;
        }
    };

    let db = match state.db.get() {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("KDF migration: DB pool error: {e}");
            new_key.zeroize();
            return false;
        }
    };

    if let Err(e) = db.execute_batch("BEGIN IMMEDIATE") {
        tracing::warn!("KDF migration: BEGIN IMMEDIATE failed: {e}");
        new_key.zeroize();
        return false;
    }

    let result: Result<(), String> = (|| {
        let connections = database::get_connections(&db).map_err(|e| e.to_string())?;
        for c in &connections {
            let new_pwd = c.password_encrypted.as_ref()
                .and_then(|ct| encryption::decrypt_auto(ct, old_key).ok())
                .and_then(|pt| encryption::encrypt_v2(&pt, &new_key).ok());
            let new_key_blob = c.private_key_encrypted.as_ref()
                .and_then(|ct| encryption::decrypt_auto(ct, old_key).ok())
                .and_then(|pt| encryption::encrypt_v2(&pt, &new_key).ok());
            if new_pwd.is_some() || new_key_blob.is_some() {
                db.execute(
                    "UPDATE connections SET password_encrypted=?1, private_key_encrypted=?2 WHERE id=?3",
                    rusqlite::params![new_pwd, new_key_blob, c.id],
                ).map_err(|e| e.to_string())?;
            }
        }

        let profiles = database::get_credential_profiles(&db).map_err(|e| e.to_string())?;
        for p in &profiles {
            let new_pwd = p.password_encrypted.as_ref()
                .and_then(|ct| encryption::decrypt_auto(ct, old_key).ok())
                .and_then(|pt| encryption::encrypt_v2(&pt, &new_key).ok());
            let new_key_blob = p.private_key_encrypted.as_ref()
                .and_then(|ct| encryption::decrypt_auto(ct, old_key).ok())
                .and_then(|pt| encryption::encrypt_v2(&pt, &new_key).ok());
            if new_pwd.is_some() || new_key_blob.is_some() {
                db.execute(
                    "UPDATE credential_profiles SET password_encrypted=?1, private_key_encrypted=?2 WHERE id=?3",
                    rusqlite::params![new_pwd, new_key_blob, p.id],
                ).map_err(|e| e.to_string())?;
            }
        }

        let ssh_keys = database::ssh_key_list(&db).map_err(|e| e.to_string())?;
        for k in &ssh_keys {
            let new_priv = encryption::decrypt_auto(&k.private_key_encrypted, old_key)
                .ok()
                .and_then(|pt| encryption::encrypt_v2(&pt, &new_key).ok());
            if let Some(ref enc) = new_priv {
                db.execute(
                    "UPDATE ssh_keys SET private_key_encrypted=?1 WHERE id=?2",
                    rusqlite::params![enc, k.id],
                ).map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    })();

    if let Err(e) = result {
        tracing::warn!("KDF migration: re-encryption failed ({e}), rolling back");
        let _ = db.execute_batch("ROLLBACK");
        new_key.zeroize();
        return false;
    }
    if let Err(e) = db.execute_batch("COMMIT") {
        tracing::warn!("KDF migration: COMMIT failed: {e}");
        let _ = db.execute_batch("ROLLBACK");
        new_key.zeroize();
        return false;
    }

    // Write new config — must succeed; if it fails the DB is already committed
    // under new_key, which would leave the vault inconsistent.
    let config_str = std::fs::read_to_string(&state.config_path).unwrap_or_default();
    let mut config: serde_json::Value =
        serde_json::from_str(&config_str).unwrap_or_else(|_| serde_json::json!({}));
    config["salt"] = serde_json::json!(
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, new_salt)
    );
    config["verification_token"] = serde_json::json!(&new_token);
    config["kdf"] = new_kdf.to_config_json();

    if let Err(e) = write_config_atomic(&state.config_path, &config) {
        tracing::error!(
            "KDF migration: DB committed under Argon2id key but config.json write \
             failed: {e}. The vault is now INCONSISTENT — manual recovery needed."
        );
        new_key.zeroize();
        return false;
    }
    restrict_config_perms(&state.config_path);

    // Commit AppState atomically enough for a single-threaded desktop app.
    if let Ok(mut g) = state.encryption_key.write() { *g = Some(MlockedKey::new(new_key)); }
    if let Ok(mut g) = state.salt.write() { *g = Some(new_salt.to_vec()); }
    if let Ok(mut g) = state.verification_token.write() { *g = Some(new_token); }
    if let Ok(mut g) = state.kdf_params.write() { *g = new_kdf; }

    tracing::info!(
        "KDF migrated PBKDF2 → Argon2id (m={} KiB, t={}, p={}) on unlock",
        encryption::DEFAULT_ARGON2_M_COST,
        encryption::DEFAULT_ARGON2_T_COST,
        encryption::DEFAULT_ARGON2_P_COST,
    );
    // new_key was moved into MlockedKey::new above — Drop handles zeroize.
    true
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
    // Holding the mutex through KDF (~200-600 ms) is acceptable on a single-user
    // desktop application — concurrent unlock calls are essentially impossible
    // in normal usage.
    let _unlock_guard = state.unlock_mutex.lock().map_err(lock_err)?;

    let now = current_unix_secs();
    let lockout_until = state.unlock_lockout_until.load(Ordering::Relaxed);
    if now < lockout_until {
        return Err(crate::error::AppError::AuthFailed(format!(
            "Too many failed attempts. Try again in {} seconds.",
            lockout_until - now
        )));
    }

    let salt = {
        let salt_guard = state.salt.read().map_err(lock_err)?;
        salt_guard
            .as_ref()
            .ok_or("Vault not configured — set a master password first")?
            .clone()
    };

    let kdf = state.kdf_params.read().map_err(lock_err)?.clone();
    let secret_pwd = secrecy::SecretString::new(request.password);
    let mut key = encryption::derive_key_params(secret_pwd.expose_secret(), &salt, &kdf)
        .map_err(|e| crate::error::AppError::Internal(format!("KDF failed: {e}")))?;

    let token = {
        let token_guard = state.verification_token.read().map_err(lock_err)?;
        token_guard
            .as_ref()
            .ok_or("Verification token missing")?
            .clone()
    };

    if !encryption::verify_master_password(&token, &key) {
        key.zeroize();
        let fails = state.unlock_fail_count.fetch_add(1, Ordering::Relaxed) + 1;
        if fails >= 5 {
            // M-5: escalating, persistent lockout
            let new_lockout_count = state.unlock_lockout_count.fetch_add(1, Ordering::Relaxed) + 1;
            let delay = lockout_duration_secs(new_lockout_count);
            state
                .unlock_lockout_until
                .store(current_unix_secs() + delay, Ordering::Relaxed);
            state.unlock_fail_count.store(0, Ordering::Relaxed);
            save_lockout_count(&state.data_dir, new_lockout_count);
            tracing::warn!(
                "unlock_vault: 5 consecutive failures (lockout #{}) — locking out for {}s",
                new_lockout_count,
                delay
            );
            return Err(crate::error::AppError::AuthFailed(format!(
                "Too many failed attempts. Vault locked for {} seconds (lockout #{}).",
                delay, new_lockout_count
            )));
        }
        tracing::warn!("unlock_vault: wrong password (attempt {})", fails);
        return Err(crate::error::AppError::AuthFailed(
            "Wrong master password".to_string(),
        ));
    }

    // M-5: successful unlock → clear both counters and persist the reset
    state.unlock_fail_count.store(0, Ordering::Relaxed);
    if state.unlock_lockout_count.swap(0, Ordering::Relaxed) > 0 {
        save_lockout_count(&state.data_dir, 0);
    }
    state.unlock_lockout_until.store(0, Ordering::Relaxed);
    touch_activity(&state);

    // v1→v2 ciphertext migration — silently re-encrypt legacy no-AAD blobs.
    // Runs at most once: a `ciphertext_v2_migrated` flag in config.json is set
    // after a successful pass so subsequent unlocks skip the full-table scan.
    // Non-fatal: decrypt_auto still handles v1 if migration fails (e.g. DB busy).
    let cfg_str = std::fs::read_to_string(&state.config_path).unwrap_or_default();
    let mut cfg: serde_json::Value = serde_json::from_str(&cfg_str).unwrap_or_default();
    let already_migrated = cfg.get("ciphertext_v2_migrated").and_then(|v| v.as_bool()).unwrap_or(false);
    if !already_migrated {
        if let Ok(db) = state.db.get() {
            match database::migrate_legacy_ciphertexts_to_v2(&db, &key) {
                Ok(n) => {
                    if n > 0 {
                        tracing::info!("vault: migrated {} v1 ciphertext(s) to v2", n);
                    }
                    // Mark done so we never rescan all tables on future unlocks.
                    cfg["ciphertext_v2_migrated"] = serde_json::json!(true);
                    if let Err(e) = write_config_atomic(&state.config_path, &cfg) {
                        tracing::warn!("vault: could not persist migration flag: {}", e);
                    }
                }
                Err(e) => tracing::warn!("vault: v1→v2 migration failed (non-fatal): {}", e),
            }
        }
    }

    // KDF migration (PBKDF2 → Argon2id) takes precedence over the legacy-token
    // rotation below, because migration creates a fresh random-secret token anyway.
    let migrated = if kdf.needs_migration() {
        // Lock ordering: unlock_mutex (held) → rekey_lock (acquired here).
        // change_master_password only acquires rekey_lock, never unlock_mutex,
        // so there is no deadlock risk.
        migrate_kdf_to_argon2id(&state, &key, secret_pwd.expose_secret())
    } else {
        // Rotate legacy fixed-plaintext token if still present on an already-Argon2id vault.
        let is_legacy = encryption::is_legacy_verification_token(&token, &key);
        if is_legacy {
            if let Ok(new_token) = encryption::create_verification_token(&key) {
                let config_str = std::fs::read_to_string(&state.config_path).unwrap_or_default();
                let mut config: serde_json::Value =
                    serde_json::from_str(&config_str).unwrap_or_else(|_| serde_json::json!({}));
                config["verification_token"] = serde_json::json!(&new_token);
                if write_config_atomic(&state.config_path, &config).is_ok() {
                    restrict_config_perms(&state.config_path);
                    if let Ok(mut tg) = state.verification_token.write() {
                        *tg = Some(new_token);
                    }
                    tracing::info!("vault: legacy fixed-plaintext token rotated to random secret");
                }
            }
        }
        false
    };

    // If migration succeeded it already stored the new Argon2id key in AppState.
    // Otherwise store the PBKDF2 key so the vault is usable even without migration.
    if !migrated {
        // key is moved into MlockedKey — Drop handles zeroize on vault lock.
        *state.encryption_key.write().map_err(lock_err)? = Some(MlockedKey::new(key));
    } else {
        key.zeroize();
    }
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
        let mut key_guard = state
            .encryption_key
            .write()
            .unwrap_or_else(|e| e.into_inner());
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
            let _ =
                database::audit_log_insert(&db, "lock", "vault", "vault", "vault", "success", "");
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
    let mut config: serde_json::Value =
        serde_json::from_str(&config_str).unwrap_or_else(|_| serde_json::json!({}));
    config["allow_multiple_instances"] = serde_json::json!(allow);
    write_config_atomic(&state.config_path, &config)?;
    tracing::info!(
        "allow_multiple_instances set to {} (takes effect on next launch)",
        allow
    );
    Ok(())
}

#[tauri::command]
pub fn set_auto_lock_timeout(
    state: tauri::State<AppState>,
    secs: u64,
) -> Result<(), crate::error::AppError> {
    *state.auto_lock_secs.write().map_err(lock_err)? = secs;

    // MED-A1: persist the setting so it survives a restart.
    // We merge it into the existing config.json (keeping salt, token, kdf intact).
    let config_str = std::fs::read_to_string(&state.config_path).unwrap_or_default();
    let mut config: serde_json::Value =
        serde_json::from_str(&config_str).unwrap_or_else(|_| serde_json::json!({}));
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
