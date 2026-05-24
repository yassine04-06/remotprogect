//! Trust-on-first-use (TOFU) host key management for SSH and SFTP.
//!
//! Closes NXS-001 (CRITICAL) and NXS-025 (MEDIUM): until now the codebase
//! used `StrictHostKeyChecking=no` for the OpenSSH subprocess and called
//! `Session::handshake()` without any host-key validation for libssh2 —
//! making every SSH/SFTP session trivially MITM-able.
//!
//! Storage: `<data_dir>/known_hosts.json` — a JSON map keyed by `host:port`.
//! Format mirrors OpenSSH semantics but stays JSON for easy Tauri IPC:
//!   {
//!     "example.com:22": { "key_type": "ssh-ed25519",
//!                         "fingerprint_sha256": "SHA256:abc..." ,
//!                         "added_at": 1715745600 }
//!   }
//!
//! Public API:
//!   - `verify(host, port, key)` → Trusted / Unknown(fingerprint) / Mismatch(fingerprint, stored)
//!   - `trust(host, port, key)` → persists the key as trusted
//!   - `forget(host, port)`     → removes a trusted entry

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownHostEntry {
    pub key_type: String,
    pub fingerprint_sha256: String,
    pub added_at: i64,
    /// Base64-encoded raw host public key. `Option` for backward compatibility
    /// with entries written before this field existed. Needed to regenerate a
    /// real OpenSSH `known_hosts` file for the `ssh.exe` subprocess.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_key_b64: Option<String>,
}

/// Outcome of a host-key verification.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum VerifyResult {
    /// Key matches a previously trusted entry.
    Trusted,
    /// Host has never been seen; caller should prompt the user.
    Unknown { fingerprint_sha256: String, key_type: String },
    /// Host is known but the key has changed — possible MITM. Caller must
    /// refuse to connect and surface the change to the user.
    Mismatch {
        fingerprint_sha256: String,
        key_type: String,
        stored_fingerprint_sha256: String,
        stored_key_type: String,
    },
}

fn store_path(data_dir: &str) -> PathBuf {
    PathBuf::from(data_dir).join("known_hosts.json")
}

fn load(data_dir: &str) -> HashMap<String, KnownHostEntry> {
    let p = store_path(data_dir);
    if !p.exists() {
        return HashMap::new();
    }
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(data_dir: &str, map: &HashMap<String, KnownHostEntry>) -> Result<(), String> {
    let p = store_path(data_dir);
    let json = serde_json::to_string_pretty(map)
        .map_err(|e| format!("known_hosts serialize error: {}", e))?;
    std::fs::write(&p, json).map_err(|e| format!("known_hosts write error: {}", e))?;
    Ok(())
}

fn host_key_id(host: &str, port: i32) -> String {
    format!("{}:{}", host, port)
}

/// Compute the OpenSSH-style fingerprint: `SHA256:<base64 of sha256(key)>`.
/// Matches the format printed by `ssh-keygen -lf` and shown by OpenSSH client.
pub fn fingerprint_sha256(raw_key: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(raw_key);
    let digest = h.finalize();
    // OpenSSH uses base64 with trailing '=' stripped.
    let b64 = base64::engine::general_purpose::STANDARD_NO_PAD.encode(digest);
    format!("SHA256:{}", b64)
}

/// Raw host key obtained from a libssh2 handshake.
pub struct ProbedHostKey {
    pub key_type: String,
    pub raw_key: Vec<u8>,
}

/// Perform an `ssh2` handshake against `host:port` and return the server's
/// raw host public key + key-type token. Shared by `ssh_probe_host_key`
/// (frontend command) and `ssh_connect` (server-side TOFU before spawning ssh).
pub fn probe_host_key(host: &str, port: i32) -> Result<ProbedHostKey, String> {
    use ssh2::Session;
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;

    let addr = format!("{}:{}", host, port);
    let tcp = TcpStream::connect_timeout(
        &addr
            .to_socket_addrs()
            .map_err(|e| format!("DNS error: {}", e))?
            .next()
            .ok_or("Could not resolve host")?,
        Duration::from_secs(10),
    )
    .map_err(|e| format!("TCP connect error: {}", e))?;

    let mut sess = Session::new().map_err(|e| format!("ssh2 session error: {}", e))?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH handshake error: {}", e))?;

    let (raw_key, key_type) = sess.host_key().ok_or("Server presented no host key")?;
    let key_type_str = match key_type {
        ssh2::HostKeyType::Rsa => "ssh-rsa",
        ssh2::HostKeyType::Dss => "ssh-dss",
        ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
        _ => "unknown",
    };

    Ok(ProbedHostKey {
        key_type: key_type_str.to_string(),
        raw_key: raw_key.to_vec(),
    })
}

pub fn verify(data_dir: &str, host: &str, port: i32, key_type: &str, raw_key: &[u8]) -> VerifyResult {
    let map = load(data_dir);
    let id = host_key_id(host, port);
    let fp = fingerprint_sha256(raw_key);

    match map.get(&id) {
        None => VerifyResult::Unknown {
            fingerprint_sha256: fp,
            key_type: key_type.to_string(),
        },
        Some(entry) => {
            if entry.fingerprint_sha256 == fp {
                VerifyResult::Trusted
            } else {
                VerifyResult::Mismatch {
                    fingerprint_sha256: fp,
                    key_type: key_type.to_string(),
                    stored_fingerprint_sha256: entry.fingerprint_sha256.clone(),
                    stored_key_type: entry.key_type.clone(),
                }
            }
        }
    }
}

pub fn trust(
    data_dir: &str,
    host: &str,
    port: i32,
    key_type: &str,
    raw_key: &[u8],
) -> Result<(), String> {
    let mut map = load(data_dir);
    let id = host_key_id(host, port);
    let now = chrono::Utc::now().timestamp();
    let raw_key_b64 = base64::engine::general_purpose::STANDARD.encode(raw_key);
    map.insert(
        id,
        KnownHostEntry {
            key_type: key_type.to_string(),
            fingerprint_sha256: fingerprint_sha256(raw_key),
            added_at: now,
            raw_key_b64: Some(raw_key_b64),
        },
    );
    save(data_dir, &map)?;
    tracing::info!("known_hosts: trusted {}:{} ({})", host, port, key_type);
    Ok(())
}

pub fn forget(data_dir: &str, host: &str, port: i32) -> Result<(), String> {
    let mut map = load(data_dir);
    let id = host_key_id(host, port);
    if map.remove(&id).is_some() {
        save(data_dir, &map)?;
        tracing::info!("known_hosts: forgot {}:{}", host, port);
    }
    Ok(())
}

// MED-A9: `regenerate_openssh_file` removed — it was dead code after H-4
// (known_hosts unification).  The russh-based SSH client reads TOFU state
// directly from known_hosts.json via the NexusSshHandler; it no longer
// shells out to ssh.exe and therefore never needs an openssh-format file.

// ── M-1: TOFU lifecycle unit tests ───────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn tmp_dir() -> TempDir {
        TempDir::new().expect("tempdir")
    }

    /// Synthesize a fake raw host key from a single seed byte for test isolation.
    fn fake_key(seed: u8) -> Vec<u8> {
        vec![seed; 32]
    }

    // ── trust + verify ────────────────────────────────────────────────────────

    #[test]
    fn trust_then_verify_trusted() {
        let tmp = tmp_dir();
        let dir = tmp.path().to_str().unwrap();
        let raw = fake_key(0xAB);
        trust(dir, "host.example.com", 22, "ssh-ed25519", &raw).expect("trust");
        assert!(
            matches!(verify(dir, "host.example.com", 22, "ssh-ed25519", &raw), VerifyResult::Trusted),
            "key matches stored entry → Trusted"
        );
    }

    #[test]
    fn unknown_host_returns_unknown() {
        let tmp = tmp_dir();
        let dir = tmp.path().to_str().unwrap();
        let raw = fake_key(0x01);
        let result = verify(dir, "new.example.com", 22, "ssh-ed25519", &raw);
        assert!(
            matches!(result, VerifyResult::Unknown { .. }),
            "never-seen host → Unknown"
        );
    }

    #[test]
    fn changed_key_returns_mismatch() {
        let tmp = tmp_dir();
        let dir = tmp.path().to_str().unwrap();
        let original = fake_key(0x01);
        let changed   = fake_key(0x02);
        trust(dir, "host.example.com", 22, "ssh-ed25519", &original).expect("trust");
        let result = verify(dir, "host.example.com", 22, "ssh-ed25519", &changed);
        assert!(
            matches!(result, VerifyResult::Mismatch { .. }),
            "changed key → Mismatch (potential MITM)"
        );
    }

    // ── forget ────────────────────────────────────────────────────────────────

    #[test]
    fn forget_makes_host_unknown() {
        let tmp = tmp_dir();
        let dir = tmp.path().to_str().unwrap();
        let raw = fake_key(0x03);
        trust(dir, "host.example.com", 22, "ssh-ed25519", &raw).expect("trust");
        forget(dir, "host.example.com", 22).expect("forget");
        assert!(
            matches!(verify(dir, "host.example.com", 22, "ssh-ed25519", &raw), VerifyResult::Unknown { .. }),
            "after forget the host should be unknown again"
        );
    }

    #[test]
    fn forget_nonexistent_is_noop() {
        let tmp = tmp_dir();
        let dir = tmp.path().to_str().unwrap();
        // Should not panic or error
        forget(dir, "ghost.example.com", 22).expect("forget of unknown host is a no-op");
    }

    // ── port isolation ────────────────────────────────────────────────────────

    #[test]
    fn different_ports_are_independent() {
        let tmp = tmp_dir();
        let dir = tmp.path().to_str().unwrap();
        let key_22   = fake_key(0x04);
        let key_2222 = fake_key(0x05);
        trust(dir, "host.example.com", 22,   "ssh-ed25519", &key_22).expect("trust :22");
        trust(dir, "host.example.com", 2222, "ssh-ed25519", &key_2222).expect("trust :2222");

        assert!(matches!(verify(dir, "host.example.com", 22,   "ssh-ed25519", &key_22),   VerifyResult::Trusted));
        assert!(matches!(verify(dir, "host.example.com", 2222, "ssh-ed25519", &key_2222), VerifyResult::Trusted));
        // Correct host, wrong port's key → Mismatch
        assert!(matches!(verify(dir, "host.example.com", 22, "ssh-ed25519", &key_2222), VerifyResult::Mismatch { .. }));
    }

    // ── fingerprint format ────────────────────────────────────────────────────

    #[test]
    fn fingerprint_starts_with_sha256_prefix() {
        let fp = fingerprint_sha256(b"test key material here!");
        assert!(fp.starts_with("SHA256:"), "must use OpenSSH SHA256: prefix");
    }

    #[test]
    fn same_key_produces_same_fingerprint() {
        let raw = b"deterministic key bytes";
        assert_eq!(fingerprint_sha256(raw), fingerprint_sha256(raw));
    }

    #[test]
    fn different_keys_produce_different_fingerprints() {
        let a = fingerprint_sha256(b"key A");
        let b = fingerprint_sha256(b"key B");
        assert_ne!(a, b);
    }

    // ── persistence ───────────────────────────────────────────────────────────

    #[test]
    fn known_hosts_persists_across_load_cycles() {
        let tmp = tmp_dir();
        let dir = tmp.path().to_str().unwrap();
        let raw = fake_key(0x10);
        trust(dir, "persist.example.com", 22, "ssh-rsa", &raw).expect("trust");

        // Re-verify (forces a fresh load() call internally)
        assert!(matches!(
            verify(dir, "persist.example.com", 22, "ssh-rsa", &raw),
            VerifyResult::Trusted
        ));
    }
}
