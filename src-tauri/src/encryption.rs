use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;
use zeroize::Zeroize;

const PBKDF2_ITERATIONS: u32 = 100_000;
const SALT_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

/// Derives a 256-bit encryption key from a master password and salt using PBKDF2-HMAC-SHA256.
pub fn derive_key(master_password: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(master_password.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

/// Generates a cryptographically random salt.
pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Encrypts plaintext using AES-256-GCM.
/// Returns base64-encoded string: nonce (12 bytes) || ciphertext.
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

/// Decrypts a base64-encoded ciphertext (nonce || ciphertext) using AES-256-GCM.
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

    // Zeroize the plaintext bytes from memory
    plaintext_bytes.zeroize();

    Ok(plaintext)
}

/// Generates a verification token encrypted with the given key.
/// Used to check if the master password is correct on subsequent unlocks.
pub fn create_verification_token(key: &[u8; KEY_LEN]) -> Result<String, String> {
    encrypt("NEXUS_VAULT_VERIFIED", key)
}

/// Verifies a master password by trying to decrypt the verification token.
pub fn verify_master_password(token: &str, key: &[u8; KEY_LEN]) -> bool {
    match decrypt(token, key) {
        Ok(plaintext) => plaintext == "NEXUS_VAULT_VERIFIED",
        Err(_) => false,
    }
}
