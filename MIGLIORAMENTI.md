# MIGLIORAMENTI — Nexus Remote Manager

Master TODO + roadmap. Tutte le issue ancora aperte dopo i fix dell'ultima sessione, più tutte le feature dei competitor da raggiungere/superare, più la roadmap commerciale.

**Legenda severità:**
🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low

**Legenda effort:**
⚡ ore · 🔧 1-3 giorni · 🛠 1-2 settimane · ⚙ 3-6 settimane · 🏗 mesi

**Legenda value:**
💰 Commerciale · 🔒 Sicurezza · ⚙️ Architettura · 🎨 UX · 🏢 Enterprise · 🚀 Performance

---

## INDICE

1. [Issue aperte — audit "principal architect"](#1-issue-aperte--audit-principal-architect)
2. [Feature parity con i competitor](#2-feature-parity-con-i-competitor)
3. [Feature differenzianti (oltre i competitor)](#3-feature-differenzianti-oltre-i-competitor)
4. [Infrastruttura release & commerciale](#4-infrastruttura-release--commerciale)
5. [Roadmap temporale](#5-roadmap-temporale)
6. [Debito architetturale documentato](#6-debito-architetturale-documentato)
7. [Già chiuso in questa sessione (per contesto)](#7-già-chiuso-in-questa-sessione-per-contesto)

---

## 1. ISSUE APERTE — AUDIT "PRINCIPAL ARCHITECT"

### 🔴 CRITICAL

| ID | Titolo | File | Effort | Note |
|----|--------|------|-------:|------|
| **CRIT-A1** | Master key in memoria pageable (può finire nello swap/pagefile) | `state.rs:30`, `vault.rs` | 🔧 | Wrap in `secrecy::SecretBox` + `region::lock`/`mlock`/`VirtualLock`. Senza questo, una macchina ibernata o sotto memory pressure può scrivere la chiave nel page file in chiaro. Contraddice il claim "Military Grade Encryption" |
| **CRIT-A2** | Recording salvati in chiaro (bypassano il vault) | `commands/recording.rs:60-65` | 🔧 | I `.cast` contengono ora anche input utente (M-6) — password digitate in sudo, token, segreti. Criptarli con la chiave del vault o almeno chmod 0600 + warning UI esplicito |
| **CRIT-A3** | Audit log non firmato e modificabile | `database.rs:1481-1525` | 🔧 | `DELETE FROM audit_log` cancella ogni traccia. Implementare hash-chain (ogni riga `SHA256(prev_hash ‖ row)`) + comando `audit_log_verify`. Disqualificante per compliance |
| **CRIT-A4** | `resolve_credentials` ritorna plaintext al frontend; lifetime indeterminato in heap V8 | `commands/credentials.rs:74`, ogni caller protocollo | 🛠 | Refactor architetturale: ogni `*_connect` deve prendere `connection_id` e fare lookup credenziali server-side. Il frontend non vede mai password decifrate |
| **CRIT-A5** | DevTools auto-open in build debug | `lib.rs:380-385` | ⚡ | Gate dietro env var `NEXUS_OPEN_DEVTOOLS=1` invece di `cfg(debug_assertions)`. Demo accidentale = leak credenziali |

### 🟠 HIGH

| ID | Titolo | File | Effort | Note |
|----|--------|------|-------:|------|
| **HIGH-A1** | SSH è ancora subprocess OpenSSH | `ssh.rs` intero | 🏗 | Migrazione a `russh` per: determinismo stato connessione, niente dipendenza da `ssh.exe` di sistema, key passphrase, TOFU unificato anche su jump-host. ~600-800 righe + test contro OpenSSH 7/8/9, dropbear, libssh-server |
| **HIGH-A2** | r2d2 pool fissato a 4 connessioni | `database.rs` (initialize) | ⚡ | A 500 connessioni con multi-tab refresh, satura. Bump a 16 o `num_cpus * 2` |
| **HIGH-A3** | Auto-lock non `wait()`-a i child process killati | `lib.rs:387-432` | 🔧 | `kill()` + `wait_with_timeout()` esplicito; rdp_processes leakano zombie su Windows. Inoltre il polling 30s impedisce sleep profondo sul laptop |
| **HIGH-A4** | `tauri::State` tenuto across `.await` in alcuni comandi async | docker.rs, altri | 🔧 | Convenzione: estrarre `let dd = state.data_dir.clone();` subito, droppare la guard prima dell'await. Documentare in CONTRIBUTING.md |
| **HIGH-A5** | Nessun rate limit globale sui Tauri command | `lib.rs:428-545` | 🔧 | Bug frontend (effect con dep sbagliata) può spammare migliaia di `getConnections()` → DB pool saturato. Usare `governor` crate, 100 req/s per comando |
| **HIGH-A6** | Log `tracing` salvano hostname/user/session_id in chiaro su disco | `lib.rs:268-295` | 🔧 | Filtro `tracing_subscriber` con redaction (stesso regex bank di `scrub_sentry_event`). Aggiungere anche size-based rotation, non solo daily |
| **HIGH-A7** | `change_master_password` race tra COMMIT DB e swap chiave in RAM | `commands/vault.rs:200-285` | 🔧 | Mutex globale su AppState per tutta la durata della re-key; OR spostare salt+token DENTRO la transazione DB (drop di config.json) |
| **HIGH-A8** | VNC framebuffer alloca senza bound check | `vnc_client.rs:235-310` | ⚡ | Server malevolo dichiara `65535×65535` → 16GB alloc → OOM kill. Validare `w*h*4 < 64MB` prima di allocare |

### 🟡 MEDIUM

| ID | Titolo | File | Effort | Note |
|----|--------|------|-------:|------|
| **MED-A1** | `auto_lock_secs` non persistito | `lib.rs:338` | ⚡ | Settaggio "disable auto-lock" si perde al restart. Persistere in config.json |
| **MED-A2** | Race su `unlock_lockout_count.swap(0)` | `vault.rs:355` | ⚡ | Due unlock concorrenti loggano due `unlock`. Mutex tokio su tutto il flow |
| **MED-A3** | SFTP pool nessuna eviction | `state.rs:88` | 🔧 | TTL 60min idle o close su `sftp_disconnect`. Accumulo socket morti |
| **MED-A4** | `connection_deleted` listener non sopravvive a HMR pulito | `useTabStore.ts:26-40` | ⚡ | Spostare in React context con cleanup |
| **MED-A5** | `database.rs` god module 1527 righe | `database.rs` | 🔧 | Split in `database/{mod,migrations,connections,groups,credentials,ssh_keys,audit,saved_commands}.rs` |
| **MED-A6** | Recording filename collision (stesso secondo) | `commands/recording.rs:58` | ⚡ | Usare full session_id + UUID suffix |
| **MED-A7** | `is_vault_unlocked` espone `first_run: bool` pre-auth | `commands/vault.rs:18` | ⚡ | Info leak minore. Roadmap |
| **MED-A8** | `proxmox_get_fingerprint` dead code da frontend dopo C-2 | `proxmox.rs` | 🔧 | Build "Pinned Proxmox certs" settings modal che lista `proxmox_certs.json` con bottone Forget |
| **MED-A9** | `ensure_openssh_known_hosts_file` dead code dopo H-4 | `known_hosts.rs:212` | ⚡ | Cancellare |
| **MED-A10** | Niente comando backup/restore vault completo | nuovo | 🔧 | `vault_full_backup(target: PathBuf)` tarball di db + config + lockout + proxmox_certs + known_hosts + recordings, opzionalmente re-encrypted |
| **MED-A11** | Single-instance plugin senza opt-out → niente multi-window | `lib.rs:353` | ⚡ | Setting per disabilitarlo |
| **MED-A12** | `contextmenu` disabilitato globalmente uccide accessibilità | `App.tsx:122` | ⚡ | Disabilitare solo dentro xterm, non sull'intero DOM |
| **MED-A13** | Bundle frontend non code-split per protocollo | `App.tsx`, `vite.config.ts` | ⚡ | Lazy-load TerminalView, RdpView, VncView, LocalTerminalView |
| **MED-A14** | Niente retry/backoff su API Proxmox | `proxmox.rs` ogni cmd | 🔧 | Retry 3× con jitter su 5xx/timeout/conn-refused, no retry su 4xx |
| **MED-A15** | SSH key passphrase non supportata | `api/ssh.ts`, `commands/ssh_cmds.rs` | 🔧 | Aggiungere `private_key_passphrase: Option<String>`, plumb su `SSH_ASKPASS` |

### 🔵 LOW

| ID | Titolo | File | Effort | Note |
|----|--------|------|-------:|------|
| **LOW-A1** | Migration ordering con cascading `v if v < N` match | `database.rs:380` | ⚡ | Tabella statica `MIGRATIONS: &[fn(...)]` |
| **LOW-A2** | Sentry scrub non copre `breadcrumbs` né `contexts` | `lib.rs::scrub_sentry_event` | ⚡ | Estendere lo scrub |
| **LOW-A3** | Commenti italiani residui in `database.rs`, `known_hosts.rs`, `state.rs` | vari | ⚡ | Passata mecccanica |
| **LOW-A4** | WebGL context cap (~16) → terminali oltre il limite si rompono | `TerminalView.tsx` | 🔧 | Detection contesti attivi + fallback Canvas per i meno recenti |
| **LOW-A5** | Niente shortcut globali Ctrl+Tab / Ctrl+1..9 per cambio tab | App.tsx | ⚡ | Listener globale + dispatch a useTabStore |
| **LOW-A6** | Command palette (Cmd+K) non fuzzy-matcha sui nomi connessione | `CommandPalette.tsx` | 🔧 | Aggiungere data source connessioni |
| **LOW-A7** | Nessun indicatore in-tab quando un RDP redirect drive è attivo | RDP toolbar | ⚡ | Badge nel RdpToolbar |
| **LOW-A8** | `network_scan_cancel` globale, un solo scan alla volta | `state.rs:84` | ⚡ | Per-scan AtomicBool keyed by scan_id |

---

## 2. FEATURE PARITY CON I COMPETITOR

Confronto con **RoyalTS · mRemoteNG · Devolutions RDM · MobaXterm · Termius · Remmina**.

### 2.1 — Feature core mancanti

| Feature | Competitor | Effort | Value | Priorità |
|---------|-----------|-------:|------:|---------:|
| **Import da PuTTY** (sessioni registry + `.ppk`) | RoyalTS, mRemoteNG, RDM, MobaXterm, Termius | 🛠 | 💰 | **CRITICA** — barriera #1 all'adozione commerciale |
| **Import da file `.rdp`** (Windows Remote Desktop) | RoyalTS, RDM, Remmina | 🔧 | 💰 | CRITICA |
| **Import da mRemoteNG** (`Confcons.xml` con AES decryption) | RoyalTS, RDM | 🛠 | 💰 | CRITICA |
| **Import da Devolutions RDM** | RoyalTS | 🔧 | 💰 | Alta |
| **Import da OpenSSH `~/.ssh/config`** | Termius, MobaXterm, Remmina | 🔧 | 💰 | Alta |
| **RDP cross-platform** (FreeRDP embedding su macOS/Linux) | RoyalTS, RDM, Termius, Remmina | 🏗 | 💰 | **CRITICA** — Nexus oggi è Windows-only per RDP |
| **SSH key passphrase support** | tutti | 🔧 | 🔒 | Alta |
| **Team/sync vault** (vault condiviso end-to-end-encrypted) | RoyalTS, RDM, Termius | 🏗 | 💰🏢 | **CRITICA** per enterprise |
| **2FA / TOTP storage** dentro il vault | RoyalTS, RDM, Termius | 🔧 | 🔒💰 | Alta |
| **Password generator** built-in (con regole, breach check via HIBP) | tutti tranne Remmina | 🔧 | 💰 | Alta |
| **CLI binary** (`nexus connect <name>` per scripting) | RoyalTS, RDM, MobaXterm, Termius | 🛠 | 💰⚙️ | Alta |
| **Multi-monitor RDP** | RoyalTS, RDM | 🛠 | 💰 | Media |
| **RDP Gateway support** | RoyalTS, RDM | 🛠 | 🏢 | Media |
| **Wake-on-LAN** (campo + helper che invia magic packet) | RoyalTS, RDM, mRemoteNG | 🔧 | 🎨 | Media |

### 2.2 — Feature avanzate (presenti in 2+ competitor)

| Feature | Competitor | Effort | Value | Priorità |
|---------|-----------|-------:|------:|---------:|
| **Snippet/Macro library** (comandi parametrizzati salvati) | RoyalTS, RDM, MobaXterm, Termius | 🔧 | 🎨 | Media — esiste già parziale con saved_commands |
| **Inheritance di settings tra cartelle** (gruppo → connessione) | mRemoteNG, RDM, RoyalTS | 🛠 | ⚙️ | Media |
| **Connection inheritance/template** | RoyalTS, RDM | 🔧 | ⚙️ | Media |
| **Tag-based filtering + smart folders** | RoyalTS, RDM | 🔧 | 🎨 | Media — tags esistono già ma no smart folders |
| **Bulk operations** (rename/move/edit di N connessioni) | RoyalTS, RDM | 🔧 | 🎨🏢 | Media |
| **Browser extension** (autofill credenziali in web app) | RDM, Termius | 🛠 | 💰 | Media |
| **Mobile companion** (iOS/Android) | RDM, Termius | 🏗 | 💰 | Media-lunga |
| **Mosh support** (mobile shell SSH-compatible) | Termius | 🛠 | 🎨 | Media |
| **Port forwarding GUI** (visualizzazione attiva tunnel) | Termius, MobaXterm | 🔧 | 🎨 | Media |
| **X11 forwarding visualization** | MobaXterm | 🛠 | 🎨 | Bassa |
| **Embedded X server** (per X-forwarding di app GUI Linux) | MobaXterm | 🏗 | 🎨 | Bassa |
| **SFTP browser dentro la sessione SSH** | MobaXterm | 🛠 | 🎨 | Media |
| **Network tools panel** (ping, traceroute, port scanner, MAC lookup, DNS lookup) | MobaXterm | 🔧 | 🎨 | Media |
| **Session sharing/collaboration** (più operatori sulla stessa sessione) | RDM | 🏗 | 🏢 | Lunga |
| **Audit reporting** (CSV/PDF export degli eventi) | RDM | 🔧 | 🏢 | Media |
| **Web client** (accesso via browser) | RDM | 🏗 | 🏢 | Lunga |
| **Approvazione / check-in/out delle credenziali** | RDM | 🛠 | 🏢 | Lunga |
| **Connessione SPICE** (proxmox/qemu) | Remmina | 🛠 | 🎨 | Bassa |
| **Connessione NX/NoMachine** | Remmina | 🛠 | 🎨 | Bassa |
| **Connessione Telnet/Rlogin** (legacy) | Remmina, MobaXterm | 🔧 | 🎨 | Bassa |
| **Plugin system / SDK** per protocolli e auth provider terzi | Remmina, RDM | 🏗 | ⚙️🏢 | Lunga |

### 2.3 — Feature enterprise specifiche

| Feature | Competitor | Effort | Value | Priorità |
|---------|-----------|-------:|------:|---------:|
| **SSO / SAML / OIDC** per login operatore | RDM, Termius (Business) | 🏗 | 🏢 | Lunga |
| **Active Directory integration** | RDM, RoyalTS | 🛠 | 🏢 | Lunga |
| **RBAC / permessi granulari** ("X può SSH a prod ma non RDP") | RDM | 🏗 | 🏢 | Lunga |
| **Audit log streaming** (syslog, journald, Splunk HEC, S3 object-lock) | RDM | 🔧 | 🏢 | Media |
| **Central policy enforcement** (MDM-style rollout di settings) | RDM | 🛠 | 🏢 | Lunga |
| **FIPS 140-2 mode** (crypto FIPS-validated) | RDM | 🛠 | 🏢 | Lunga |
| **SOC 2 Type 1 attestation** | RDM | 🏗 | 🏢 | Lunga |
| **Hardware token support** (YubiKey, FIDO2 per master pw) | RoyalTS, RDM | 🛠 | 🔒🏢 | Media |
| **Smart card auth** per RDP | RoyalTS, RDM | 🛠 | 🏢 | Media |

### 2.4 — Feature UX che hanno già tutti

| Feature | Stato Nexus | Effort | Priorità |
|---------|------------|-------:|---------:|
| **Dark/light theme** (con prefers-color-scheme) | Da verificare | ⚡ | Bassa |
| **Drag-and-drop riorganizza connessioni** | Sì | — | ✅ |
| **Quick-connect bar** (apri server digitando nome) | Sì | — | ✅ |
| **Connessione recenti** | Sì (last_connected_at) | — | ✅ |
| **Favoriti** | Sì (is_favorite) | — | ✅ |
| **Note per connessione** | Sì (notes field) | — | ✅ |
| **Tag** | Sì (tags field) | — | ✅ |
| **Ricerca globale (Cmd+K)** | Parziale | 🔧 | Bassa |
| **Tab shortcuts (Ctrl+Tab, Ctrl+1..9)** | No | ⚡ | Bassa |
| **Fullscreen toggle (F11)** | Sì (RDP) | — | ✅ |
| **`prefers-reduced-motion`** | No | ⚡ | Bassa |
| **Connessione history/playback** | Sì (SSH only) | 🛠 | Media — estendere agli altri protocolli |
| **Multilingue UI** | No (inglese ora) | 🛠 | Media |

---

## 3. FEATURE DIFFERENZIANTI (OLTRE I COMPETITOR)

Idee per cui **nessun competitor** ha un'offerta solida — potenziali differenziatori commerciali.

| Feature | Effort | Value | Note |
|---------|-------:|------:|------|
| **AI-assisted shell** (natural language → comando shell, con preview e conferma) | 🛠 | 💰🚀 | Termius ha qualcosa di simile (Termius AI) ma limitato. Spazio per fare meglio integrando con LLM locali (Ollama) o API (Anthropic/OpenAI). Differenziatore forte |
| **Vault portabile** (USB key) con auto-mount + auto-lock al disconnect | 🔧 | 🔒 | Caso d'uso freelance/consulenza |
| **Session sandboxing** (Docker container per sessione SSH, audit completo) | 🏗 | 🏢🔒 | Niche ma high-value per security teams |
| **Compliance-mode** (registrazione obbligatoria + hash-chain + export PDF firmato) | 🛠 | 🏢 | Per environments PCI-DSS / HIPAA |
| **Inactivity-aware lock** che si triggera anche su Bluetooth proximity (es. quando il telefono si allontana) | 🔧 | 🔒🎨 | UX nuovo |
| **Cross-device handoff** (apri tab su laptop, continua su un altro device) | 🏗 | 🚀 | Richiede team-sync; combinabile con mobile |
| **Connection health dashboard** real-time (latenza, packet loss, disponibilità SSH/RDP) con grafici 24h | 🛠 | 🏢 | Nessun competitor ha questo bene |
| **Native MFA prompt acceleration** (push autenticate via Tauri notification, no copy-paste TOTP) | 🔧 | 🎨🔒 | UX win |
| **Snippet con variabili dinamiche** (`{date}`, `{git_branch}`, `{host_ip}`) | 🔧 | 🎨 | DevOps utility |
| **Diff-vista tra config di due host** (es. `diff /etc/nginx.conf @prod1 @prod2`) | 🛠 | 🎨🏢 | DevOps unique |
| **Just-in-time credential issuance** (richiedi al vault una password che scade in N minuti) | 🛠 | 🏢🔒 | Compliance unique |

---

## 4. INFRASTRUTTURA RELEASE & COMMERCIALE

### 4.1 — Code signing & distribution

| Item | Effort | Costo $ | Note |
|------|-------:|--------:|------|
| **Windows code signing certificate** (Sectigo Standard) | 🔧 | ~€250/anno | 1-3 settimane verifica identità. Senza: SmartScreen warning |
| **Windows code signing certificate EV** (sblocca SmartScreen subito) | 🔧 | ~€450/anno | Alternativa al sopra; reputation immediata |
| **Apple Developer Program** | 🔧 | $99/anno | Per Developer ID + notarization. 24-48h verifica |
| **Notarization workflow macOS** (xcrun notarytool nei GitHub Actions) | 🔧 | — | Step nel CI dopo signing |
| **GPG signing per .deb e .AppImage Linux** | ⚡ | — | Defesa in depth |
| **Linux package signing per APT/RPM repo** | 🛠 | ~$5-15/mese hosting | Opzionale |

### 4.2 — CI/CD

| Item | Effort | Note |
|------|-------:|------|
| **`.github/workflows/release.yml`** con matrix (windows-latest, macos-latest, ubuntu-22.04) | 🔧 | Vedi snippet già pronto |
| **`tauri-apps/tauri-action@v0`** integrazione | 🔧 | Genera latest.json firmato automaticamente |
| **Secrets management** (TAURI_SIGNING_PRIVATE_KEY, APPLE_*, WINDOWS_*) in GitHub Actions secrets | ⚡ | |
| **Reproducible builds** (rust-toolchain.toml + lockfile + deterministic timestamps) | 🔧 | Per SBOM/SLSA |
| **SBOM generation** (cargo-cyclonedx) | ⚡ | Per supply chain |
| **SLSA Level 3 provenance attestation** | 🔧 | Per enterprise sales |
| **Smoke test post-build** (lancio headless del binario per verificare che parte) | 🔧 | Su tutti gli OS della matrix |
| **Pre-release channel** (beta) separato da stable | 🔧 | Tag `v1.0.0-beta.1` |

### 4.3 — Marketing & commerciale

| Item | Effort | Note |
|------|-------:|------|
| **Sito di landing** (Vercel/Cloudflare Pages) | 🛠 | Esiste già la cartella `landing/` da completare |
| **Pricing page** + Stripe/Paddle/Lemon Squeezy integration | 🛠 | Per Pro one-time license |
| **License server** (in-app verifica + offline grace period) | 🛠 | Per Pro license: validazione signed JWT con pubkey embedded |
| **Documentation site** (Mintlify, Docusaurus, MkDocs) | 🛠 | Quickstart + protocolli + import + troubleshooting |
| **CHANGELOG.md** + auto-update notes generation | ⚡ | Per release notes nell'updater |
| **Demo video** (60-90s) | 🔧 | Per landing page |
| **Comparison page** vs RoyalTS / mRemoteNG / RDM | 🔧 | SEO + acquisition |
| **GitHub Discussions / Discord** per community | ⚡ | Per fase OSS |
| **CONTRIBUTING.md + ARCHITECTURE.md** | 🔧 | Per onboarding contributor |
| **Telemetry opt-in** (Sentry già pronto, manca consent flow nell'unlock screen) | 🔧 | |
| **Crash reporter UI** (avvisa l'utente che è successo qualcosa) | 🔧 | |

### 4.4 — Test infrastructure

| Item | Effort | Note |
|------|-------:|------|
| **Playwright E2E** suite per il flow vault → connect | 🛠 | tauri-driver setup |
| **Integration test SSH** con OpenSSH server in container | 🔧 | docker-compose con sshd configurato |
| **Integration test SFTP** | 🔧 | Stesso container SSH |
| **Integration test Docker** con dockerd-in-docker | 🔧 | |
| **Integration test Proxmox** | 🛠 | Più complesso (VM Proxmox); o mock HTTP server |
| **Property-based test su `parseAsciicast`** | ⚡ | proptest già in dev-dependencies |
| **Performance benchmark** (500-server vault, multi-tab, IPC throughput) | 🔧 | criterion benchmark suite |
| **Fuzz testing** del parser asciinema + VNC framebuffer events | 🔧 | cargo-fuzz |
| **CI matrix completion: Linux ARM** (aarch64 per Raspberry Pi / cloud ARM) | 🔧 | |
| **CI matrix: Windows ARM64** | 🔧 | |

---

## 5. ROADMAP TEMPORALE

### Settimana 1 (quick wins)
- CRIT-A5 (DevTools gate) · ⚡
- HIGH-A8 (VNC bound check) · ⚡
- HIGH-A2 (pool size bump) · ⚡
- MED-A1, A2, A4, A6, A9 · ⚡
- LOW-A1, A2, A3, A8 · ⚡

### Mese 1
- **CRIT-A1** mlock master key · 🔧
- **CRIT-A2** encrypt recordings · 🔧
- **HIGH-A3** auto-lock proper reap · 🔧
- **HIGH-A5** rate limit IPC · 🔧
- **HIGH-A6** log redaction · 🔧
- **MED-A3** SFTP pool TTL · 🔧
- **MED-A14** Proxmox retry · 🔧
- **Import PuTTY** · 🛠 — **commercial unblocker**
- **GitHub Actions release workflow** · 🔧
- **Windows code signing cert** (acquisto + integrazione) · €250 + 🔧
- **Apple Developer Program** (enrollment + notarization) · $99 + 🔧

### Mese 3
- **CRIT-A3** hash-chained audit log · 🔧
- **CRIT-A4** refactor `resolve_credentials` away · 🛠
- **HIGH-A1** SSH → russh · 🏗
- **HIGH-A7** rekey global lock · 🔧
- **Import `.rdp` files** · 🔧
- **Import mRemoteNG** · 🛠
- **Import `~/.ssh/config`** · 🔧
- **SSH key passphrase** (MED-A15) · 🔧
- **Cross-platform RDP via FreeRDP** · 🏗 — **second commercial unblocker**
- **Split `database.rs`** (MED-A5) · 🔧
- **Backup/restore command** (MED-A10) · 🔧
- **Tauri capability scoping** · 🔧
- **Accessibility audit** (MED-A12, LOW-A5, prefers-reduced-motion) · 🔧
- **Sito di landing completo + pricing** · 🛠

### Mese 6
- **VNC ZRLE + Tight** · ⚙
- **2FA / TOTP storage** · 🔧
- **Password generator + HIBP check** · 🔧
- **Team vault prototype** (sync E2E-encrypted con backend self-hostable) · 🏗
- **Audit log streaming** (syslog/journald/S3) · 🔧
- **CLI binary** · 🛠
- **Recording per local shell + docker exec** · 🔧
- **Wake-on-LAN** · 🔧
- **Multi-window mode** (MED-A11 inverso) · ⚡
- **Snippet con variabili dinamiche** · 🔧
- **Network tools panel** (MobaXterm parity) · 🔧
- **Smart folders + tag filtering avanzato** · 🔧

### Mese 12
- **RBAC + team licensing** · 🏗
- **SSO / SAML / OIDC** · 🏗
- **Mobile companion** (Tauri Mobile o React Native) · 🏗
- **Plugin SDK** · 🏗
- **SOC 2 Type 1** · 🏗
- **FIPS-validated crypto build** · 🛠
- **AI-assisted shell** · 🛠 — differenziatore di mercato
- **Browser extension** · 🛠
- **Diff-vista config tra host** · 🛠
- **Web client** (accesso via browser) · 🏗
- **Multi-monitor RDP** · 🛠
- **RDP Gateway support** · 🛠

---

## 6. DEBITO ARCHITETTURALE DOCUMENTATO

| Debito | Impatto | Sintomi quando esploderà |
|--------|---------|--------------------------|
| `AppState` god struct (18 campi) | ⚙️ | Refactor a multi-vault toccherà ogni command. Risolvere prima del Mese 12 |
| `database.rs` 1527 righe (MED-A5) | ⚙️ | Revisioni delle migration impossibili leggere |
| Mixed sync/async (SSH thread, Docker tokio, VNC sync) | ⚙️🚀 | Ogni nuova feature deve scegliere un lato |
| `From<String> for AppError` ancora vivo | ⚙️ | Errori del frontend imprecisi; nuovi `?` finiscono Internal |
| Single-window assumption | ⚙️ | Multi-window richiederà routing eventi rivisto |
| Niente `trait RemoteSession` | ⚙️ | Aggiungere Telnet/Rlogin/K8s exec costa 5-7 file ognuno |
| Tauri `state` injection convention inconsistente (HIGH-A4) | ⚙️ | Latente — esplode quando AppState diventa non-`Sync` |
| 2 sorgenti di verità known_hosts (JSON + OpenSSH file generato) | ⚙️ | OK con russh; va via |
| RDP via C# helper esterno (mstscax.dll) | ⚙️ | Cross-platform RDP forza un secondo helper FreeRDP, due path da mantenere |
| Italian doc comments (LOW-A3) | ⚙️ | Adoption friction per contributor non-italiani |
| Nessun event-bus abstraction (`AppHandle::emit` diretto) | ⚙️ | CLI version richiederà refactor di ogni protocollo |

---

## 7. GIÀ CHIUSO IN QUESTA SESSIONE (per contesto)

Documentato per evitare di re-aprire issue già risolte.

| ID | Issue | Commit |
|----|-------|--------|
| **C-1** | Auto-updater senza chiave di firma | `68a4a4a` |
| **C-2** | Proxmox TLS verification disabilitata (MITM) | `7b47f43` |
| **H-1** | SSH terminal non supporta resize | `fa70354` |
| **H-2** | SSH parsing fragile dello stato (parziale — russh aperto come HIGH-A1) | `fa70354` |
| **H-3** | Docker over plaintext HTTP only | `104ca49` |
| **H-4** | Due known_hosts store separati | `fa70354` |
| **H-5** | Proxmox console webview cookie injection | `8e0da4e` |
| **M-1** | Test coverage store + tab-id bug | `d3e5a4c` |
| **M-2** | Tutti i tab montati simultaneamente | `967d7d4` |
| **M-3** | `From<String> for AppError` collassa su Internal (parziale — documentato) | `7d59fb0` |
| **M-4** | `config.json` permessi default | `7d59fb0` |
| **M-5** | Lockout unlock non escalante | `7d59fb0` |
| **M-6** | Recording solo SSH e solo output (parziale — input+resize SSH fatti) | `6f34418` |
| **M-7** | `panic = "abort"` in release | `7d59fb0` |
| **L-1** | 18 eslint-disable (3 reali fixati) | `897f8a8` |
| **L-2** | Commenti Rust italiani (user-facing strings tradotte) | `897f8a8` |
| **L-3** | 4 unwrap/expect verificati con SAFETY comments | `897f8a8` |
| **L-4** | VNC RFB 3.8 baseline (parziale — CopyRect aggiunto, ZRLE/Tight aperto) | `897f8a8` |
| **MED-1** | Split `lib.rs` in commands/ modules | precedente |
| **MED-2** | Schema version downgrade refuse | precedente |
| **MED-3** | Mutex<Connection> → r2d2 pool | `e118361` |
| **MED-4** | AppError typed across protocols | `b6b0828` |
| **LOW-4** | Vitest frontend test suite | `edffe16` |
| **LOW-5** | Split api.ts in 15 moduli | `5b9ce92` |
| **LOW-6** | Stringhe UI miste italiano/inglese | `ec8918b` |
| **LOW-7** | Password strength meter solo visivo | `ec8918b` |
| **LOW-8** | VncView senza toolbar | `2909147` |
| **LOW-9** | Session recording senza playback UI | `2909147` |

---

## NOTE FINALI

**Priorità raccomandata per il prossimo trimestre:**
1. **Sicurezza non negoziabile**: CRIT-A1 (mlock chiave), CRIT-A2 (recording crypt), HIGH-A8 (VNC bound).
2. **Sblocco commerciale**: Import PuTTY + `.rdp` + mRemoteNG. **Senza questo nessuno migra.**
3. **Sblocco multi-piattaforma**: RDP via FreeRDP su macOS/Linux. **Senza questo l'app è Windows-RDP-only.**
4. **Production infrastructure**: Code signing Windows + macOS notarization + GitHub Actions release workflow.

Tutto il resto è importante ma può aspettare il secondo trimestre. La regola è semplice: ogni feature che non sblocca uno dei 4 punti sopra è procrastinazione finché quelli non sono chiusi.

**Stato realistico:** Beta. Maturità ~6-9 mesi di sviluppo concentrato dal product-ready commerciale. Probabilità di successo ~40-55%, limitata principalmente da capacità di esecuzione (singolo dev / piccolo team), non dal gap tecnico — il gap tecnico è chiaro, finito, prezzabile.
