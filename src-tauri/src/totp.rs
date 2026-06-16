// 2FA/TOTP storage (RFC 6238). Secrets are stored base32, encrypted at rest with
// the vault key, and the 6-digit codes are computed server-side on demand so the
// raw secret never reaches the frontend.

use hmac::{Hmac, Mac};
use serde::Serialize;
use sha1::Sha1;
use ts_rs::TS;

use crate::encryption;

type HmacSha1 = Hmac<Sha1>;

const PERIOD: u64 = 30; // seconds
const DIGITS: u32 = 6;

#[derive(Serialize, TS)]
pub struct TotpCode {
    pub id: String,
    pub label: String,
    /// Current 6-digit code (zero-padded).
    pub code: String,
    /// Seconds until the code rotates.
    pub seconds_remaining: u32,
}

/// Decodes an RFC 4648 base32 string (ignores spaces, lowercase, padding).
fn base32_decode(input: &str) -> Result<Vec<u8>, String> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let mut bits = 0u32;
    let mut nbits = 0u32;
    let mut out = Vec::new();
    for c in input.chars() {
        if c == '=' || c.is_whitespace() {
            continue;
        }
        let up = c.to_ascii_uppercase() as u8;
        let val = ALPHABET
            .iter()
            .position(|&a| a == up)
            .ok_or_else(|| format!("Invalid base32 char: {}", c))? as u32;
        bits = (bits << 5) | val;
        nbits += 5;
        if nbits >= 8 {
            nbits -= 8;
            out.push((bits >> nbits) as u8);
        }
    }
    if out.is_empty() {
        return Err("Empty TOTP secret".into());
    }
    Ok(out)
}

/// Computes the current TOTP code and the seconds remaining in the window.
fn generate(secret_b32: &str) -> Result<(String, u32), String> {
    let key = base32_decode(secret_b32)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let counter = now / PERIOD;
    let remaining = (PERIOD - (now % PERIOD)) as u32;

    let mut mac = HmacSha1::new_from_slice(&key).map_err(|e| e.to_string())?;
    mac.update(&counter.to_be_bytes());
    let hash = mac.finalize().into_bytes();

    let offset = (hash[hash.len() - 1] & 0x0f) as usize;
    let bin = ((u32::from(hash[offset]) & 0x7f) << 24)
        | (u32::from(hash[offset + 1]) << 16)
        | (u32::from(hash[offset + 2]) << 8)
        | u32::from(hash[offset + 3]);
    let code = bin % 10u32.pow(DIGITS);
    Ok((
        format!("{:0width$}", code, width = DIGITS as usize),
        remaining,
    ))
}

/// Adds a TOTP entry. `secret_b32` is validated then stored vault-encrypted.
#[tauri::command]
pub fn totp_add(
    state: tauri::State<crate::state::AppState>,
    label: String,
    secret_b32: String,
) -> Result<(), String> {
    // Validate the secret can produce a code before persisting.
    generate(&secret_b32)?;

    let key_guard = state
        .encryption_key
        .read()
        .map_err(|_| "Lock poisoned".to_string())?;
    let key = key_guard.as_ref().ok_or("Vault locked")?.expose();
    let enc = encryption::encrypt_v2(secret_b32.trim(), key)?;
    drop(key_guard);

    let conn = state.db.get().map_err(|e| format!("DB pool: {}", e))?;
    conn.execute(
        "INSERT INTO totp_secrets (id, label, secret_encrypted, created_at) VALUES (?1,?2,?3,?4)",
        rusqlite::params![
            uuid::Uuid::new_v4().to_string(),
            label,
            enc,
            chrono::Utc::now().timestamp(),
        ],
    )
    .map_err(|e| format!("insert totp: {}", e))?;
    Ok(())
}

/// Lists all TOTP entries with their current codes.
#[tauri::command]
pub fn totp_list(state: tauri::State<crate::state::AppState>) -> Result<Vec<TotpCode>, String> {
    let key_guard = state
        .encryption_key
        .read()
        .map_err(|_| "Lock poisoned".to_string())?;
    let key = key_guard
        .as_ref()
        .ok_or("Vault locked")?
        .expose()
        .to_owned();
    drop(key_guard);

    let conn = state.db.get().map_err(|e| format!("DB pool: {}", e))?;
    let rows: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, label, secret_encrypted FROM totp_secrets ORDER BY label")
            .map_err(|e| e.to_string())?;
        let x = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        x
    };

    let mut out = Vec::new();
    for (id, label, enc) in rows {
        let secret = match encryption::decrypt_auto(&enc, &key) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if let Ok((code, remaining)) = generate(&secret) {
            out.push(TotpCode {
                id,
                label,
                code,
                seconds_remaining: remaining,
            });
        }
    }
    Ok(out)
}

/// Deletes a TOTP entry.
#[tauri::command]
pub fn totp_delete(state: tauri::State<crate::state::AppState>, id: String) -> Result<(), String> {
    let conn = state.db.get().map_err(|e| format!("DB pool: {}", e))?;
    conn.execute(
        "DELETE FROM totp_secrets WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(|e| format!("delete totp: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base32_roundtrip_known_vector() {
        // "Hello!" → base32 "JBSWY3DPEHPK3PXP" (RFC 4648 example family)
        let decoded = base32_decode("JBSWY3DPEHPK3PXP").unwrap();
        assert_eq!(&decoded[..5], b"Hello");
    }

    #[test]
    fn base32_ignores_spaces_and_case() {
        let a = base32_decode("gezd gnbv gy3t qojq").unwrap();
        let b = base32_decode("GEZDGNBVGY3TQOJQ").unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn generate_produces_6_digits() {
        let (code, remaining) = generate("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").unwrap();
        assert_eq!(code.len(), 6);
        assert!(code.chars().all(|c| c.is_ascii_digit()));
        assert!((1..=30).contains(&remaining));
    }

    #[test]
    fn rejects_invalid_base32() {
        assert!(base32_decode("!!!").is_err());
        assert!(base32_decode("").is_err());
    }
}
