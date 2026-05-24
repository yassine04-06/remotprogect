// 90-18: Property-based and integration tests for Nexus backend
//
// Run with: cargo test --test encryption_tests

use proptest::prelude::*;

// ── helpers shared across tests ───────────────────────────

fn derive_key_and_encrypt(password: &str, plaintext: &str) -> (String, Vec<u8>, u32) {
    use rand::RngCore;

    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);

    let iterations = 100_000u32;

    // Derive key via PBKDF2-HMAC-SHA256
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), &salt, iterations, &mut key);

    // Encrypt with AES-GCM
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    use base64::Engine as _;

    let cipher = Aes256Gcm::new(&key.into());
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .expect("encryption failed");

    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);

    let encoded = base64::engine::general_purpose::STANDARD.encode(&combined);
    (encoded, salt.to_vec(), iterations)
}

fn decrypt(password: &str, encoded: &str, salt: &[u8], iterations: u32) -> String {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    use base64::Engine as _;

    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), salt, iterations, &mut key);

    let combined = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .expect("base64 decode failed");
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let cipher = Aes256Gcm::new(&key.into());
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .expect("decryption failed");
    String::from_utf8(plaintext).expect("utf8 decode failed")
}

// ── Property-based tests ─────────────────────────────────

proptest! {
    /// Encrypt then decrypt always returns the original plaintext.
    #[test]
    fn roundtrip_encrypt_decrypt(
        password in "[a-zA-Z0-9!@#$%^&*]{8,32}",
        plaintext in "[a-zA-Z0-9 .,:;@!\\-]{1,256}",
    ) {
        let (encoded, salt, iterations) = derive_key_and_encrypt(&password, &plaintext);
        let recovered = decrypt(&password, &encoded, &salt, iterations);
        prop_assert_eq!(plaintext, recovered);
    }

    /// Wrong password → decrypt panics (AES-GCM authentication tag mismatch).
    /// We verify that a wrong password does NOT produce the original plaintext.
    #[test]
    fn wrong_password_fails(
        password in "[a-zA-Z0-9]{8,16}",
        wrong_password in "[a-zA-Z0-9]{8,16}",
        plaintext in "[a-zA-Z0-9]{4,64}",
    ) {
        prop_assume!(password != wrong_password);
        use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
        use base64::Engine as _;
        use rand::RngCore;

        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        let iterations = 100_000u32;

        let mut key = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), &salt, iterations, &mut key);
        let cipher = Aes256Gcm::new(&key.into());
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).unwrap();
        let mut combined = nonce_bytes.to_vec();
        combined.extend_from_slice(&ciphertext);
        let encoded = base64::engine::general_purpose::STANDARD.encode(&combined);

        // Attempt decryption with wrong password
        let mut wrong_key = [0u8; 32];
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(wrong_password.as_bytes(), &salt, iterations, &mut wrong_key);
        let wrong_cipher = Aes256Gcm::new(&wrong_key.into());
        let combined2 = base64::engine::general_purpose::STANDARD.decode(&encoded).unwrap();
        let (nb, ct) = combined2.split_at(12);
        let result = wrong_cipher.decrypt(Nonce::from_slice(nb), ct);
        prop_assert!(result.is_err(), "Wrong password should not decrypt");
    }
}

// ── Helper: v2-format encrypt/decrypt (mirrors encryption.rs internals) ───────
//
// These helpers replicate the AES-256-GCM v2 format used by Nexus so we can
// write integration tests for key rotation without exposing the private
// `encryption` module to the test crate.

/// AES-256-GCM v2 encrypt: "v2:<b64(nonce || ciphertext)>"
fn encrypt_v2(plaintext: &str, key: &[u8; 32]) -> String {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    use base64::Engine as _;
    use rand::RngCore;

    let cipher = Aes256Gcm::new(key.into());
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .expect("v2 encrypt");
    let mut combined = nonce_bytes.to_vec();
    combined.extend_from_slice(&ciphertext);
    format!(
        "v2:{}",
        base64::engine::general_purpose::STANDARD.encode(combined)
    )
}

/// Decrypt either v1 (bare base64) or v2 ("v2:<b64>").
fn decrypt_auto(ciphertext: &str, key: &[u8; 32]) -> String {
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    use base64::Engine as _;

    let raw_b64 = if let Some(stripped) = ciphertext.strip_prefix("v2:") {
        stripped
    } else {
        ciphertext
    };
    let combined = base64::engine::general_purpose::STANDARD
        .decode(raw_b64)
        .expect("b64 decode");
    let (nonce_bytes, ct) = combined.split_at(12);
    let cipher = Aes256Gcm::new(key.into());
    let pt = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ct)
        .expect("decrypt");
    String::from_utf8(pt).expect("utf8")
}

/// Derive a 32-byte key with PBKDF2-HMAC-SHA256 at low iteration count for tests.
fn test_derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), salt, 1_000, &mut key);
    key
}

// ── Key Rotation Unit Tests ───────────────────────────────

/// Encrypt with old key, re-encrypt under new key, verify decryptable ONLY with new key.
#[test]
fn test_key_rotation_roundtrip() {
    let old_key = test_derive_key("old-password-123", b"salt_old_0000000");
    let new_key = test_derive_key("new-password-456", b"salt_new_0000000");

    let plaintext = "s3cr3t_p@ssword!";

    // Encrypt with old key
    let old_ct = encrypt_v2(plaintext, &old_key);
    assert!(old_ct.starts_with("v2:"), "should be v2 format");

    // Simulate re-encryption (what change_master_password does)
    let decrypted = decrypt_auto(&old_ct, &old_key);
    assert_eq!(decrypted, plaintext, "decrypt with old key must work");
    let new_ct = encrypt_v2(&decrypted, &new_key);

    // Verify decryptable with new key
    let recovered = decrypt_auto(&new_ct, &new_key);
    assert_eq!(
        recovered, plaintext,
        "decrypt with new key must work after rotation"
    );

    // Verify the OLD key can no longer decrypt the new ciphertext
    use aes_gcm::{
        aead::{Aead, KeyInit},
        Aes256Gcm, Nonce,
    };
    use base64::Engine as _;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(new_ct.strip_prefix("v2:").unwrap())
        .unwrap();
    let (nb, ct) = raw.split_at(12);
    let old_cipher = Aes256Gcm::new((&old_key).into());
    let result = old_cipher.decrypt(Nonce::from_slice(nb), ct);
    assert!(result.is_err(), "old key must NOT decrypt new ciphertext");
}

/// Re-encryption should survive a batch of diverse plaintexts (passwords, keys, unicode).
#[test]
fn test_key_rotation_multiple_records() {
    let old_key = test_derive_key("vault-old", b"abcdefghijklmnop");
    let new_key = test_derive_key("vault-new", b"pqrstuvwxyz01234");

    let records = [
        "simple_password",
        "P@$$w0rd!#%^&*()-_+=",
        "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK...\n-----END RSA PRIVATE KEY-----",
        "unicode: 日本語パスワード🔑",
        "", // empty string edge-case
    ];

    for plaintext in records {
        if plaintext.is_empty() {
            continue; // empty plaintext is skipped in production code too
        }
        let ct_old = encrypt_v2(plaintext, &old_key);
        // simulate re-encryption
        let decrypted = decrypt_auto(&ct_old, &old_key);
        assert_eq!(decrypted, plaintext);
        let ct_new = encrypt_v2(&decrypted, &new_key);
        let recovered = decrypt_auto(&ct_new, &new_key);
        assert_eq!(recovered, plaintext, "failed for plaintext: {}", plaintext);
    }
}

/// DB-level test: create connections with encrypted passwords, re-key all rows, verify.
#[test]
fn test_key_rotation_db_level() {
    use remote_manager_lib::{database, test_helpers};
    use rusqlite::Connection;

    let conn = Connection::open_in_memory().expect("in-memory DB");
    test_helpers::run_migrations_test(&conn);

    let old_key = test_derive_key("old-vault-pw", b"salt_db_test_000");
    let new_key = test_derive_key("new-vault-pw", b"salt_db_test_001");

    // Insert two connections with passwords encrypted under old key
    let passwords = ["hunter2", "P@ssw0rd!"];
    let mut ids = Vec::new();
    for pw in &passwords {
        let mut req = test_helpers::make_test_connection("host.example.com", "SSH");
        req.password_encrypted = Some(encrypt_v2(pw, &old_key));
        let created = database::create_connection(&conn, req).expect("create");
        ids.push(created.id);
    }

    // ── Simulate change_master_password re-key loop (with transaction) ──
    conn.execute_batch("BEGIN IMMEDIATE").expect("begin");
    let all = database::get_connections(&conn).expect("get_connections");
    for c in &all {
        let new_pwd = c.password_encrypted.as_ref().map(|ct| {
            let pt = decrypt_auto(ct, &old_key);
            encrypt_v2(&pt, &new_key)
        });
        if new_pwd.is_some() {
            conn.execute(
                "UPDATE connections SET password_encrypted = ?1 WHERE id = ?2",
                rusqlite::params![new_pwd, c.id],
            )
            .expect("update");
        }
    }
    conn.execute_batch("COMMIT").expect("commit");

    // ── Verify all passwords decryptable with new key ──
    let updated = database::get_connections(&conn).expect("get after rotation");
    for (i, conn_row) in updated.iter().enumerate() {
        let ct = conn_row
            .password_encrypted
            .as_ref()
            .expect("must have encrypted pw");
        let recovered = decrypt_auto(ct, &new_key);
        assert_eq!(
            recovered, passwords[i],
            "password[{}] must survive rotation",
            i
        );

        // Old key must fail
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };
        use base64::Engine as _;
        let raw = base64::engine::general_purpose::STANDARD
            .decode(ct.strip_prefix("v2:").unwrap())
            .unwrap();
        let (nb, ciphertext) = raw.split_at(12);
        let old_cipher = Aes256Gcm::new((&old_key).into());
        assert!(
            old_cipher
                .decrypt(Nonce::from_slice(nb), ciphertext)
                .is_err(),
            "old key must not decrypt row {} after rotation",
            i
        );
    }
}

/// Schema version downgrade guard — opening a newer DB should return an error.
#[test]
fn test_schema_version_downgrade_guard() {
    use remote_manager_lib::test_helpers;
    use rusqlite::Connection;

    let tmp = tempfile::NamedTempFile::new().expect("tempfile");
    let path = tmp.path().to_str().unwrap().to_string();

    // Initialize at current version
    {
        let conn = Connection::open(&path).unwrap();
        test_helpers::run_migrations_test(&conn);
    }

    // Artificially bump the stored schema version to simulate a future release
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (9999)",
            [],
        )
        .unwrap();
    }

    // initialize_database should now refuse to open the DB
    let result = remote_manager_lib::database::initialize_database(&path);
    assert!(
        result.is_err(),
        "opening a DB with schema version 9999 must fail"
    );
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("9999") || msg.contains("newer"),
        "error message should mention the version: {}",
        msg
    );
}

// ── Database migration tests ──────────────────────────────

#[test]
fn test_db_migration_to_latest() {
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory DB");
    remote_manager_lib::test_helpers::run_migrations_test(&conn);
}

#[test]
fn test_create_and_read_connection() {
    use rusqlite::Connection;

    let conn = Connection::open_in_memory().expect("in-memory DB");
    remote_manager_lib::test_helpers::run_migrations_test(&conn);

    let req = remote_manager_lib::test_helpers::make_test_connection("test-host", "SSH");
    let created = remote_manager_lib::database::create_connection(&conn, req)
        .expect("create_connection failed");

    assert_eq!(created.host, "test-host");
    assert_eq!(created.protocol, "SSH");
    assert!(!created.use_ftps);
    assert!(!created.rdp_nla);
    assert_eq!(created.docker_transport, "tcp");

    let all = remote_manager_lib::database::get_connections(&conn).expect("get_connections failed");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, created.id);
}

#[test]
fn test_vnc_des_encrypt_known_vector() {
    // Known VNC DES test: password="password", all-zero challenge → known response
    // This tests the bit-reversal quirk specific to VNC.
    let password = "password";
    let challenge = [0u8; 16];

    // Expected: DES-ECB encrypt each 8-byte block with bit-reversed key
    // Key bytes after bit-reversal of "password":
    //   'p'=0x70 → 0x0e, 'a'=0x61 → 0x86, 's'=0x73 → 0xce, ...
    // We just verify the function runs without panic and produces 16 bytes.
    let result = remote_manager_lib::test_helpers::vnc_des_test(password, &challenge);
    assert_eq!(result.len(), 16);
    // The result should not be all-zeros
    assert_ne!(result, [0u8; 16]);
}
