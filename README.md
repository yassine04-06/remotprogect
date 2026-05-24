# NexoRC — Remote Connection Manager

A cross-platform remote connection manager built with **Tauri 2**, **React 19**, and **Rust**.

Manage SSH, RDP, VNC, SFTP/FTP, Proxmox, Docker, and local terminal sessions from a single app — all protected by an AES-256-GCM encrypted credential vault.

---

## Features

### Connections
- **SSH** — full xterm.js terminal, key-based auth, tunnels, broadcast mode (send input to multiple sessions at once)
- **RDP** — embedded via C# ActiveX helper (Windows); automatic fallback to `mstsc.exe`
- **VNC** — launches your system VNC viewer
- **SFTP / FTP** — file manager with upload/download progress bars, resume support for interrupted transfers
- **Local Terminal** — PowerShell or bash, depending on your OS
- **Proxmox** — list and manage VMs/containers, open console, start/stop/restart
- **Docker** — list containers, stream logs, open interactive exec sessions

### Security
- AES-256-GCM encrypted vault; key derived with PBKDF2-HMAC-SHA256 (100 000 iterations)
- Password strength meter (Weak / Fair / Good / Strong) enforced at vault creation
- Credential profiles: store encrypted passwords and SSH private keys separately from connection definitions
- Zero plaintext secrets stored on disk

### Productivity
- Connection groups with collapsible sidebar
- Command library: save and recall frequently used shell commands
- Quick Connect bar: open a session by typing `[ssh://][user@]host[:port]`
- Health dashboard: ping all connections and view latency history
- Network/port scanner with real-time progress and cancellation
- Dark / light theme

---

## System Requirements

| Requirement | Version | Notes |
|---|---|---|
| **OS** | Windows 10/11, macOS 12+, Linux | RDP embedding is Windows-only |
| **Rust** | 1.77+ | Install via [rustup.rs](https://rustup.rs) |
| **Node.js** | 18+ | For the frontend build |
| **WebView2** | any | Pre-installed on Windows 11; [download](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) for Windows 10 |

### RDP Embedding (Windows only)

| Requirement | Notes |
|---|---|
| **.NET Framework 4.x** | Pre-installed on Windows 8.1+. Verify: `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\` |

The C# helper (`RdpEmbed.exe`) is **auto-compiled during `cargo build`** when `csc.exe` is found. If it is missing at build time, a non-blocking `cargo:warning` is emitted and the app falls back to `mstsc.exe` at runtime.

---

## Development Setup

```bash
# 1. Install frontend dependencies
npm install

# 2. Start dev server (hot-reloading frontend + Tauri)
npm run tauri dev
```

### Other scripts

```bash
npm run build          # Production frontend build (tsc + vite)
npm run lint           # ESLint (0 errors policy)
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier formatter
npm run tauri build    # Full production build → NSIS/MSI installer
```

The production build:
1. Compiles the frontend (Vite + TypeScript)
2. Compiles the Rust backend
3. Auto-compiles `RdpEmbed.exe` from `src-tauri/helpers/RdpEmbed.cs` (Windows, if .NET present)
4. Bundles into `src-tauri/target/release/bundle/`

---

## First Launch

1. Start the app — you will be prompted to **create a master password** (minimum 8 characters, strength meter shown).
2. The vault is locked automatically on exit and must be unlocked on the next launch.
3. Add connections via the **+** button in the sidebar, or use **Quick Connect** in the top bar.
4. Passwords and SSH keys can be stored in **Credential Profiles** (sidebar → key icon) and linked to any connection.

---

## Configuration

All data is stored locally in the OS app-data directory:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\nexorc\` |
| macOS | `~/Library/Application Support/nexorc/` |
| Linux | `~/.local/share/nexorc/` |

Contents:
- `nexorc.db` — SQLite database (connections, groups, command library, credential profiles)
- `vault.bin` — encrypted vault config (PBKDF2 salt + verification token)

---

## Architecture

```
src/                        # React 19 frontend (TypeScript + Tailwind v4)
├── components/             # UI components (one file per view/modal)
├── services/api.ts         # Tauri invoke() wrappers
├── store/                  # Zustand stores (connections, tabs, UI, credentials)
├── hooks/                  # useResolvedCredentials, …
├── types/index.ts          # Shared TypeScript types
└── utils/errorMapper.ts    # Tauri error-code → human-readable string

src-tauri/src/              # Rust backend
├── lib.rs                  # Tauri command registration + app bootstrap
├── database.rs             # SQLite via rusqlite — schema v1→v6 migrations
├── encryption.rs           # AES-256-GCM vault + PBKDF2 key derivation
├── ssh.rs                  # SSH sessions (ssh2 crate)
├── rdp.rs                  # RDP: embedded C# helper + mstsc fallback
├── vnc.rs                  # VNC launcher
├── sftp_ftp.rs             # SFTP (ssh2) + FTP (suppaftp), progress + resume
├── proxmox.rs              # Proxmox REST API client
├── docker.rs               # Docker REST API — containers, logs, exec
├── network.rs              # Async network/port scanner with progress events
├── local_shell.rs          # Local PTY shell (portable-pty)
├── state.rs                # AppState (shared Tauri managed state)
└── error.rs                # Centralized AppError enum + serde mapping

src-tauri/helpers/
└── RdpEmbed.cs             # C# RDP ActiveX wrapper (auto-compiled at build time)
```

---

## Troubleshooting

### RDP — "RdpEmbed.exe not found"

The C# helper was not compiled. Options:

**1. Install .NET Framework 4.x** (pre-installed on Windows 8.1+) and rebuild:
```bash
npm run tauri build
```

**2. Manual compile:**
```bat
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe ^
  /target:winexe /optimize+ ^
  /out:src-tauri\helpers\RdpEmbed.exe ^
  /reference:System.dll ^
  /reference:System.Windows.Forms.dll ^
  /reference:System.Drawing.dll ^
  src-tauri\helpers\RdpEmbed.cs
```

**3. Fallback:** the app automatically falls back to launching `mstsc.exe` if the helper is unavailable.

---

### Vault — "Incorrect master password"

The vault uses PBKDF2-HMAC-SHA256 with 100 000 iterations. Enter the exact password set during first launch. There is no recovery mechanism by design — this ensures the vault cannot be brute-forced.

---

### SFTP/FTP — transfer stalls with no progress

- Check that the remote server supports the protocol (SFTP requires an SSH server with the SFTP subsystem enabled).
- Large files emit progress events every 64 KB; a stall at 0 % usually means the connection was dropped before the first chunk.
- Interrupted transfers resume automatically on retry (SFTP: server-side append; FTP: REST/APPE commands).

---

### App won't start — "WebView2 runtime not found"

Download and install the **WebView2 Evergreen Runtime** from Microsoft:
[https://developer.microsoft.com/en-us/microsoft-edge/webview2/](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

---

## License

MIT
