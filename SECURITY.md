# Security Policy

## Supported Versions

Only the latest release branch is actively maintained with security fixes.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report security issues by email to the maintainer listed in `package.json`. Include:

1. A description of the vulnerability and its potential impact
2. Steps to reproduce or a proof-of-concept (if safe to share)
3. Affected versions

You will receive an acknowledgment within 48 hours. Critical vulnerabilities are patched and released within 14 days.

## Security Design

### Vault Encryption

- All secrets (passwords, private keys, API tokens) are stored encrypted using **AES-256-GCM** with a unique 12-byte nonce per operation.
- The encryption key is derived from the master password using **PBKDF2-HMAC-SHA256** with 600,000 iterations and a random 32-byte salt.
- The salt and a verification token are persisted to disk; the derived key exists only in memory and is zeroed on lock or application exit.
- An auto-lock timer (15 minutes of inactivity) wipes the in-memory key.

### IPC Boundary

- All sensitive operations (encryption, file access, network connections) run exclusively in the Rust backend.
- The frontend communicates via Tauri IPC (invoke). The Tauri capability system restricts which commands and events the frontend may access.

### SSH

- Host key verification uses TOFU (Trust On First Use) stored in `known_hosts.db`. Connections to unknown hosts prompt the user to accept or reject the fingerprint.
- Private keys are stored encrypted in the vault and decrypted in memory only for the duration of the connection.

### Network

- No telemetry, analytics, or outbound connections are made except those explicitly initiated by the user (SSH, RDP, VNC, Docker, Proxmox, FTP).
- Port scanner results are stored in memory only and are not persisted.

### Credential Profiles

- Credential profiles store secrets encrypted with the same vault key.
- Exported vault files contain credentials in their encrypted form — they cannot be decrypted without the original master password.

## Known Limitations

- RDP connections are proxied through FreeRDP; any vulnerabilities in the FreeRDP subprocess apply.
- The auto-lock timer does not protect against physical access to an unlocked session.
