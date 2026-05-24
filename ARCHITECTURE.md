# NexoRC Remote Manager — Architecture

## Overview

NexoRC is a Tauri v2 desktop application. The frontend is a React/TypeScript SPA rendered in a WebView; the backend is a Rust process that handles all privileged operations (cryptography, protocol connections, filesystem access).

```
┌─────────────────────────────────────────────┐
│                  WebView                     │
│  React + Zustand + Framer Motion + xterm.js  │
│  src/components/   src/store/   src/services/│
└────────────────────┬────────────────────────┘
                     │  tauri::invoke (IPC)
┌────────────────────▼────────────────────────┐
│                Rust Core                     │
│  src-tauri/src/lib.rs  (command registry)    │
│  ├── database.rs       (SQLite, migrations)  │
│  ├── encryption.rs     (AES-256-GCM, PBKDF2) │
│  ├── ssh.rs            (russh)               │
│  ├── sftp_ftp.rs       (suppaftp + FTPS)     │
│  ├── rdp.rs            (FreeRDP subprocess)  │
│  ├── vnc_client.rs     (native RFB 3.8)      │
│  ├── docker.rs         (Docker Engine API)   │
│  ├── proxmox.rs        (Proxmox REST API)    │
│  ├── network.rs        (port scanner)        │
│  └── error.rs          (AppError enum)       │
└─────────────────────────────────────────────┘
```

## Vault / Encryption

All secrets (passwords, private keys, API tokens) are encrypted at rest using AES-256-GCM. The encryption key is derived from the user's master password via PBKDF2-HMAC-SHA256 (600,000 iterations). A verification token stored alongside the salt allows unlock validation without exposing the key.

The key lives in an `RwLock<Option<Vec<u8>>>` inside `AppState`. Commands that need to encrypt/decrypt call `state.encryption_key.read()` to obtain the key.

Auto-lock: the backend has a 15-minute idle timer that wipes the in-memory key. Every vault-touching command calls `touch_activity()` to reset it.

## Database

SQLite via `rusqlite`. The schema version is tracked in `CURRENT_SCHEMA_VERSION` (database.rs). Migrations run at startup in `run_migrations()` — each migration step is idempotent. The database file lives at `$APPDATA/nexorc/vault.db` on Windows.

## Frontend State

Three Zustand stores:

| Store | Responsibility |
|-------|---------------|
| `useConnectionStore` | Connection list, groups, search, CRUD ops |
| `useCredentialStore` | Credential profiles, SSH keys, saved commands |
| `useUIStore` | Modal visibility, toasts, theme, fullscreen |
| `useTabStore` | Active tabs, tab status, split-pane state |

## IPC Pattern

Frontend API calls go through `src/services/api.ts`, which wraps every `invoke` call in a try/catch to handle races during startup. Backend commands return `Result<T, AppError>`; `AppError` serializes to `{ code: string, message: string }` so the frontend's `parseBackendError` can produce user-friendly messages.

## Protocol Implementations

| Protocol | Transport | Notes |
|----------|-----------|-------|
| SSH/SFTP | russh (pure Rust) | Jump host, agent forwarding, tunnels |
| RDP      | FreeRDP subprocess | Embeds the FreeRDP window into the app frame |
| VNC      | Native RFB 3.8 (Rust) | Canvas-based, X11 keysyms, base64 RGBA frames |
| FTP/FTPS | suppaftp 8 | Explicit TLS via NativeTlsFtpStream |
| Docker   | HTTP API (TCP or Unix socket) | Container lifecycle + exec via xterm.js |
| Proxmox  | REST API | PVE ticket + API token auth |

## Event Bus

Real-time data (SSH output, VNC frames, Docker exec output) flows from Rust to the frontend via Tauri events (`app_handle.emit(event, payload)`). The frontend subscribes with `@tauri-apps/api/event` `listen()` and tears down listeners on component unmount.
