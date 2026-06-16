# ARCHITECTURE.md — NexoRC

**Aggiornato:** 2026-06-13 · Versione 1.0.4

---

## 1. Panoramica del sistema

NexoRC è un connection manager desktop cross-platform (Windows/macOS/Linux) costruito su **Tauri 2**. Il frontend è **React 19 + Zustand** in un WebView; il backend è un processo **Rust** che gestisce tutte le operazioni privilegiate (crittografia, connessioni di protocollo, filesystem). Tutte le credenziali vivono in un vault locale cifrato **AES-256-GCM** con chiave derivata via **Argon2id**. Nessun servizio cloud.

Protocolli: SSH, RDP, VNC, SFTP/FTP, Telnet, local shell, Proxmox, Docker.

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (WebView)                       │
│  React 19 · Zustand (UI/connection/credential/tab)            │
│  components/{sidebar,vnc,rdp,ssh,modals,forms,docker}         │
│  services/api/<dominio>.ts  ──invoke──►                       │
└───────────────────────────────┬─────────────────────────────┘
                  Tauri IPC (invoke ⇄ command, emit ⇄ event)
┌───────────────────────────────┴─────────────────────────────┐
│                       Backend (Rust)                          │
│  lib.rs  (entry, ~120 #[tauri::command], AppState)            │
│   ├── commands/   (vault, connections, credentials, ssh, …)   │
│   ├── database/   (pool r2d2 · 8 moduli · migrations v1→v15)  │
│   ├── protocolli  (ssh, rdp, vnc_client, sftp_ftp, docker,    │
│   │               proxmox, telnet, local_shell)               │
│   ├── encryption · locked_key (mlock) · known_hosts           │
│   ├── network · tools · import · backup · totp                │
│   └── log_writer (PII scrubbing) · error (AppError)           │
└──────────────────────────────────────────────────────────────┘
        SQLite (connections.db) · config.json · recordings/
```

CLI companion: bin **`nexorc`** (`src/bin/nexorc_cli.rs`) — legge lo stesso vault; `russh` per `exec`, system `ssh` per `connect`.

## 2. Vault / Crittografia

- Segreti cifrati at-rest con **AES-256-GCM**. Chiave derivata via **Argon2id** (m=64MiB, t=3, p=4) dal master password + salt in `config.json`. Vault legacy PBKDF2 migrati silenziosamente all'unlock.
- **Token di verifica** = cifratura di 32 byte random: l'auth-tag GCM è l'oracolo, nessun plaintext fisso (`encryption.rs:create_verification_token`).
- La chiave vive in `AppState.encryption_key: RwLock<Option<MlockedKey>>`. `MlockedKey` usa `VirtualLock`/`mlock` (no swap su disco) + `Zeroize` on drop (`locked_key.rs`).
- **Auto-lock**: timer idle (default 15 min, configurabile e persistito) azzera la chiave; ogni comando vault-touching chiama `touch_activity()`.
- **Regola di concorrenza:** la chiave va copiata fuori dal `RwLockReadGuard` prima di ogni `.await` (il guard non è `Send`).

## 3. Database

SQLite via **rusqlite** + pool **r2d2** (16 connessioni). Schema versionato: `CURRENT_SCHEMA_VERSION` + slice `MIGRATIONS` (`database/migrations.rs`). Le migration sono **additive e idempotenti**, eseguite all'avvio in transazione. File: `<data_dir>/nexorc/connections.db`. Moduli: `connections, groups, credentials, ssh_keys, saved_commands, audit, import_export, migrations`.

## 4. Stato frontend (Zustand)

| Store | Responsabilità |
|---|---|
| `useConnectionStore` | Lista connessioni, gruppi, ricerca, CRUD, `templateConnection` |
| `useCredentialStore` | Credential profiles, SSH keys, saved commands |
| `useUIStore` | Visibilità modali, toast, tema, fullscreen, 2FA modal |
| `useTabStore` | Tab attivi, status, split-pane, MRU |

## 5. Pattern IPC

Le chiamate passano per `src/services/api/<dominio>.ts` (1 modulo per dominio, re-export da `index.ts`), ognuna wrappa `invoke` in try/catch per le race di startup. I comandi ritornano `Result<T, AppError>`; `AppError` serializza in `{ code, message }` → `parseBackendError`/`errorMapper.ts` producono messaggi user-friendly. **I tipi TS sono generati dal backend** via `ts-rs` (`generate_types` bin) → `src/types/generated.ts` (non editare a mano).

## 6. Implementazioni protocollo

| Protocollo | Transport | Note |
|---|---|---|
| SSH | system `ssh` (desktop) / `russh` (CLI) | Jump host, tunnel, agent, key passphrase |
| SFTP/FTP | ssh2 / suppaftp (FTPS esplicito) | File manager con resume |
| RDP | C# ActiveX helper (Windows) / FreeRDP (Unix) | Helper embeddato + integrity SHA-256 |
| VNC | RFB nativo Rust | Canvas, JPEG/CopyRect, bound-check framebuffer |
| Telnet | TCP raw + IAC handler | Carry-over per sequenze IAC split |
| Docker | HTTP API (TCP/Unix/TLS) | Lifecycle + exec via xterm |
| Proxmox | REST API | PVE ticket + API token, TLS pinning (TOFU) |
| Local shell | PTY (portable-pty) | PowerShell/zsh/bash |

## 7. Event bus

Dati real-time (output SSH/shell/docker/telnet, frame VNC, status) fluiscono da Rust al frontend via `app_handle.emit("<proto>:<kind>:{id}", payload)`. Il frontend ascolta con `listen()` e fa teardown all'unmount. Il **recorder** (`recording_sessions: DashMap`) è agganciato ai loop di output di SSH/local/docker (protocol-agnostic, formato asciicast).

## 8. Flussi critici

- **Unlock:** password → Argon2id → verifica auth-tag → `MlockedKey` in AppState → migrazione KDF/ciphertext se necessario.
- **Connect:** `*_connect(connection_id)` → lookup DB → decrypt **server-side** → sessione in DashMap → streaming via eventi.
- **Restore (staged):** `vault_restore` spacchetta in `.restore_staging/`; `apply_staged_restore()` applica all'avvio **prima** di aprire il DB (no file-lock).

## 9. Decisioni architetturali

| Decisione | Razionale |
|---|---|
| `panic = "unwind"` in release | Catturare panic nei thread reader → disconnect, non crash app |
| Tipi TS generati da `ts-rs` | Single source of truth del contratto IPC |
| Credenziali decifrate solo server-side | Il plaintext non vive nell'heap V8 |
| `MlockedKey` | Master key non swappabile + zeroizzata |
| Restore staged all'avvio | Evita corruzione DB aperto su Windows |
| TOTP server-side | Secret cifrato non lascia il backend |
| DashMap per sessioni | Concorrenza senza lock globale |
| Telemetry consent-gated | Privacy by default |

## 10. Punti critici (maneggiare con cura)

- **`AppState`**: god-struct toccata da quasi ogni comando.
- **Migration**: solo additive; aggiornare `CURRENT_SCHEMA_VERSION` + `MIGRATIONS` + assert nei test.
- **Tipi generati**: dopo modifica di un modello esposto, rigenerare e allineare i chiamanti.
- **CLI `nexorc`**: dipende dallo schema di `config.json`/DB.
- **Mixed sync/async**: SSH thread, Docker/Telnet tokio, VNC sync.

## 11. Build & toolchain

`npm run tauri dev` · `cargo build --release` · `npm run build` · `npm run generate-types` (~2 min). CI `ci.yml`: rust/frontend/build/release(matrix multi-OS + ARM)/SBOM; E2E Playwright on-demand.
