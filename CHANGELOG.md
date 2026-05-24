# Changelog

All notable changes to NexoRC — Remote Connection Manager are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.0.0] — 2026-05-24

### Added
- **SSH** — native Rust SSH via `russh 0.44`: TOFU host verification, jump-host support, local port forwarding, session recording (asciinema v2), auto-reconnect with backoff, terminal search (Ctrl+F), split panes (H/V), SSH key vault with passphrase support
- **RDP** — Windows native via `mstscax.dll` with NLA, drive/printer redirection, fullscreen; RDP Gateway and multi-monitor planned
- **VNC** — native RFB 3.8 implementation: VNC DES auth, Raw/CopyRect encoding, auto-hide toolbar (Ctrl+Alt+Del, fullscreen, reconnect)
- **SFTP/FTP/FTPS** — full file manager with upload/download, resume, connection pooling (60-min TTL)
- **Docker** — container management over TCP+TLS and Unix socket; exec terminal, log streaming
- **Proxmox** — API token + cookie auth, TOFU TLS certificate pinning, console WebView, VM/CT management
- **Vault** — AES-256-GCM v2 encrypted vault, PBKDF2-HMAC-SHA256 (600k iterations), auto-lock (configurable), escalating lockout, atomic re-key, master password change
- **Import** — PuTTY registry, `.rdp` files, mRemoteNG `confCons.xml`, OpenSSH `~/.ssh/config`, Devolutions RDM `.rdm`, RoyalTS `.rtsx`/`.rtsz`
- **Audit log** — SHA-256 hash-chain tamper detection, CSV export, chain verify command
- **Session recording** — asciinema v2 with player UI (play/pause/speed), keyboard/resize events captured
- **SSH key manager** — encrypted key vault, PEM import, key generation, per-connection key selector
- **Favourites, tags, notes, drag & drop** group assignment
- **Sidebar virtualisation** — `react-window` for 500+ server lists
- **Auto-updater** — `tauri-plugin-updater` with minisign signature verification
- **Single-instance** — optional via `allow_multiple_instances` config key
- **Sentry** — opt-in error reporting with PII scrubbing
- **Playwright E2E** — vault login, SSH connect, import dialog flows (12 tests)
- **Vitest** — 70 unit tests for hooks, services, utilities

### Security
- Credential isolation: passwords never leave Rust; all `*_connect` commands take `connection_id` only
- CSP strict policy; no `unsafe-eval`
- Audit log hash-chain (SHA-256): tampered rows flagged visually
- Proxmox TLS TOFU: MITM change detected and blocked
- Rate limiting on all Tauri IPC commands (governor 0.6)
- Log PII redaction + size-based rotation (10 MiB)
- Atomic config writes (crash-safe rename)
- Known hosts unified store (JSON-based TOFU for SSH + SFTP)

---

## [Unreleased]

- RDP cross-platform via FreeRDP (macOS/Linux)
- 2FA/TOTP storage in vault
- Password generator + HIBP breach check
- Team/sync vault (E2E-encrypted)
- CLI binary (`nexorc connect <name>`)
