use aes_gcm::{
    aead::{Aead, KeyInit, OsRng, Payload},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Argon2, Params as Argon2Params};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;
use zeroize::Zeroize;

/// Legacy PBKDF2 default kept for reading old vaults from config.json.
/// New vaults always use Argon2id.
pub const DEFAULT_KDF_ITERATIONS: u32 = 600_000;

/// Argon2id defaults — OWASP "High Security" interactive tier (2024):
/// 64 MiB memory, 3 iterations, 4 parallelism → ~300 ms on typical hardware.
pub const DEFAULT_ARGON2_M_COST: u32 = 65_536; // KiB
pub const DEFAULT_ARGON2_T_COST: u32 = 3;
pub const DEFAULT_ARGON2_P_COST: u32 = 4;

const SALT_LEN: usize = 32;
const NONCE_LEN: usize = 12;
pub(crate) const KEY_LEN: usize = 32;

// ── KDF abstraction ───────────────────────────────────────────────────────────

/// Describes which KDF and parameters were used to derive the vault master key.
/// Stored in config.json; PBKDF2 vaults are silently migrated to Argon2id on
/// the first successful unlock.
#[derive(Clone, Debug)]
pub enum KdfParams {
    Pbkdf2 { iterations: u32 },
    Argon2id { m_cost: u32, t_cost: u32, p_cost: u32 },
}

impl KdfParams {
    pub fn default_argon2id() -> Self {
        KdfParams::Argon2id {
            m_cost: DEFAULT_ARGON2_M_COST,
            t_cost: DEFAULT_ARGON2_T_COST,
            p_cost: DEFAULT_ARGON2_P_COST,
        }
    }

    /// True when the vault needs a silent KDF upgrade to Argon2id.
    pub fn needs_migration(&self) -> bool {
        matches!(self, KdfParams::Pbkdf2 { .. })
    }

    /// Serializes into the `kdf` block written to config.json.
    pub fn to_config_json(&self) -> serde_json::Value {
        match self {
            KdfParams::Pbkdf2 { iterations } => serde_json::json!({
                "algorithm": "pbkdf2-hmac-sha256",
                "iterations": iterations,
            }),
            KdfParams::Argon2id { m_cost, t_cost, p_cost } => serde_json::json!({
                "algorithm": "argon2id",
                "m_cost": m_cost,
                "t_cost": t_cost,
                "p_cost": p_cost,
            }),
        }
    }

    /// Parses the `kdf` JSON object from config.json.
    /// `salt_present` drives the legacy PBKDF2 iteration fallback:
    ///   true  → old vault without explicit kdf section → assume 100 000
    ///   false → fresh vault being set up for the first time
    pub fn from_config(kdf: &serde_json::Value, salt_present: bool) -> Self {
        match kdf["algorithm"].as_str() {
            Some("argon2id") => KdfParams::Argon2id {
                m_cost: kdf["m_cost"].as_u64().unwrap_or(DEFAULT_ARGON2_M_COST as u64) as u32,
                t_cost: kdf["t_cost"].as_u64().unwrap_or(DEFAULT_ARGON2_T_COST as u64) as u32,
                p_cost: kdf["p_cost"].as_u64().unwrap_or(DEFAULT_ARGON2_P_COST as u64) as u32,
            },
            _ => KdfParams::Pbkdf2 {
                iterations: kdf["iterations"]
                    .as_u64()
                    .map(|n| n as u32)
                    .unwrap_or_else(|| {
                        if salt_present { 100_000 } else { DEFAULT_KDF_ITERATIONS }
                    }),
            },
        }
    }
}

/// Derives a 256-bit key using the algorithm specified by `params`.
pub fn derive_key_params(
    password: &str,
    salt: &[u8],
    params: &KdfParams,
) -> Result<[u8; KEY_LEN], String> {
    match params {
        KdfParams::Pbkdf2 { iterations } => {
            let mut key = [0u8; KEY_LEN];
            pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, *iterations, &mut key);
            Ok(key)
        }
        KdfParams::Argon2id { m_cost, t_cost, p_cost } => {
            let p = Argon2Params::new(*m_cost, *t_cost, *p_cost, Some(KEY_LEN))
                .map_err(|e| format!("Argon2id params error: {e}"))?;
            let argon2 = Argon2::new(
                argon2::Algorithm::Argon2id,
                argon2::Version::V0x13,
                p,
            );
            let mut key = [0u8; KEY_LEN];
            argon2
                .hash_password_into(password.as_bytes(), salt, &mut key)
                .map_err(|e| format!("Argon2id KDF failed: {e}"))?;
            Ok(key)
        }
    }
}

/// Domain-separating AAD bound to every v2 ciphertext.
/// Prevents cross-application ciphertext reuse: a ciphertext stolen from this
/// app's SQLite DB cannot be decrypted by a different app that happens to use
/// the same AES-GCM key, because the AAD tag check will fail.
const V2_AAD: &[u8] = b"nexus-remote-manager:vault:v2";
const V2_PREFIX: &str = "v2:";

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

    let plaintext = String::from_utf8(std::mem::take(&mut plaintext_bytes))
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

    let plaintext = String::from_utf8(std::mem::take(&mut plaintext_bytes))
        .map_err(|e| format!("UTF-8 decode failed: {}", e))?;
    plaintext_bytes.zeroize();
    Ok(plaintext)
}

// ── Vault token helpers ───────────────────────────────────────────────────────

/// Generates a verification token by encrypting 32 cryptographically random bytes.
/// The AES-256-GCM authentication tag is the oracle — no fixed plaintext is stored.
/// Legacy vaults that used "NEXUS_VAULT_VERIFIED" are migrated transparently on unlock.
pub fn create_verification_token(key: &[u8; KEY_LEN]) -> Result<String, String> {
    let mut random_secret = [0u8; 32];
    OsRng.fill_bytes(&mut random_secret);
    encrypt_v2(&BASE64.encode(random_secret), key)
}

/// Verifies a master password by attempting AES-256-GCM decryption of the token.
/// The GCM authentication tag is the oracle (2^-128 false-positive probability).
/// Works for both random-secret tokens and legacy "NEXUS_VAULT_VERIFIED" tokens.
pub fn verify_master_password(token: &str, key: &[u8; KEY_LEN]) -> bool {
    decrypt_auto(token, key).is_ok()
}

/// Returns true if this token still contains the legacy fixed plaintext.
/// Used by unlock_vault to detect and silently rotate stale tokens.
pub fn is_legacy_verification_token(token: &str, key: &[u8; KEY_LEN]) -> bool {
    decrypt_auto(token, key)
        .map(|pt| pt == "NEXUS_VAULT_VERIFIED")
        .unwrap_or(false)
}
