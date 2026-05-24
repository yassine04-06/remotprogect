use aes_gcm::{
    aead::{Aead, KeyInit, OsRng, Payload},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;
use zeroize::Zeroize;

/// PBKDF2-HMAC-SHA256 iteration count — 600k meets NIST SP 800-132 §5.3 (2024).
/// Stored in config.json so existing vaults can unlock with their recorded count
/// while new vaults and re-keyed vaults always use the current default.
pub const DEFAULT_KDF_ITERATIONS: u32 = 600_000;

const SALT_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

/// Domain-separating AAD bound to every v2 ciphertext.
/// Prevents cross-application ciphertext reuse: a ciphertext stolen from this
/// app's SQLite DB cannot be decrypted by a different app that happens to use
/// the same AES-GCM key, because the AAD tag check will fail.
const V2_AAD: &[u8] = b"nexus-remote-manager:vault:v2";
const V2_PREFIX: &str = "v2:";

/// Derives a 256-bit encryption key from a master password and salt using
/// PBKDF2-HMAC-SHA256. `iterations` is loaded from config.json so that
/// existing vaults can still be unlocked after the default count is bumped.
pub fn derive_key(master_password: &str, salt: &[u8], iterations: u32) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(master_password.as_bytes(), salt, iterations, &mut key);
    key
}

/// Generates a cryptographically random salt.
pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

// ── v2 (AAD-authenticated) format ────────────────────────────────────────────

/// Encrypts `plaintext` with AES-256-GCM + domain-separating AAD.
/// Returns `"v2:<base64(nonce || ciphertext+tag)>"`.
/// All new vault data should use this — `decrypt_auto` handles both formats.
pub fn encrypt_v2(plaintext: &str, key: &[u8; KEY_LEN]) -> Result<String, String> {
    let cipher_key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(cipher_key);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext.as_bytes(),
                aad: V2_AAD,
            },
        )
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(format!("{}{}", V2_PREFIX, BASE64.encode(&combined)))
}

/// Decrypts both v2 (`v2:` prefix, AAD-protected) and legacy (no prefix, no AAD) ciphertexts.
/// Use this wherever vault data is read — it handles forward and backward compat transparently.
pub fn decrypt_auto(ciphertext_b64: &str, key: &[u8; KEY_LEN]) -> Result<String, String> {
    if let Some(b64) = ciphertext_b64.strip_prefix(V2_PREFIX) {
        decrypt_v2_inner(b64, key)
    } else {
        decrypt(ciphertext_b64, key)
    }
}

fn decrypt_v2_inner(b64: &str, key: &[u8; KEY_LEN]) -> Result<String, String> {
    let combined = BASE64
        .decode(b64)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    if combined.len() < NONCE_LEN + 1 {
        return Err("Ciphertext too short".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher_key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(cipher_key);

    let mut plaintext_bytes = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: V2_AAD,
            },
        )
        .map_err(|_| {
            "Decryption failed — wrong master password or tampered ciphertext".to_string()
        })?;

    let plaintext = String::from_utf8(plaintext_bytes.clone())
        .map_err(|e| format!("UTF-8 decode failed: {}", e))?;
    plaintext_bytes.zeroize();
    Ok(plaintext)
}

// ── Legacy (no AAD) format — kept for backward compat ────────────────────────

/// Encrypts plaintext using AES-256-GCM without AAD (legacy format, no prefix).
/// New code should use `encrypt_v2`; this remains for backward compatibility.
#[allow(dead_code)]
pub fn encrypt(plaintext: &str, key: &[u8; KEY_LEN]) -> Result<String, String> {
    let cipher_key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(cipher_key);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(BASE64.encode(&combined))
}

/// Decrypts a legacy (no-AAD, no-prefix) ciphertext.
pub fn decrypt(ciphertext_b64: &str, key: &[u8; KEY_LEN]) -> Result<String, String> {
    let combined = BASE64
        .decode(ciphertext_b64)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    if combined.len() < NONCE_LEN + 1 {
        return Err("Ciphertext too short".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);

    let cipher_key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(cipher_key);

    let mut plaintext_bytes = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed — wrong master password?".to_string())?;

    let plaintext = String::from_utf8(plaintext_bytes.clone())
        .map_err(|e| format!("UTF-8 decode failed: {}", e))?;
    plaintext_bytes.zeroize();
    Ok(plaintext)
}

// ── Vault token helpers ───────────────────────────────────────────────────────

/// Generates a verification token encrypted with the given key (v2 format).
pub fn create_verification_token(key: &[u8; KEY_LEN]) -> Result<String, String> {
    encrypt_v2("NEXUS_VAULT_VERIFIED", key)
}

/// Verifies a master password by decrypting the verification token.
/// Handles both v2 and legacy token formats for smooth migration.
pub fn verify_master_password(token: &str, key: &[u8; KEY_LEN]) -> bool {
    match decrypt_auto(token, key) {
        Ok(plaintext) => plaintext == "NEXUS_VAULT_VERIFIED",
        Err(_) => false,
    }
}
