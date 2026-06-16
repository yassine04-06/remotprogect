# CLAUDE_CONTEXT.md — Memoria persistente del progetto

> Letto da Claude all'inizio di ogni sessione. Aggiornare le sezioni rilevanti
> ad ogni modifica e appendere alla cronologia in fondo.

---

## Stato attuale progetto

- **Nome:** NexoRC — Remote Connection Manager
- **Versione:** 1.0.4 (vedi `src-tauri/Cargo.toml`)
- **Stack:** Tauri 2 · React 19 · Rust (edition 2021) · SQLite (rusqlite + r2d2)
- **Dimensione:** ~14.6k LOC Rust (48 file), ~16.9k LOC TS/TSX (90 file)
- **Build status:** ✅ `cargo check`/`clippy` 0 warning · ✅ `tsc`+`eslint` 0 · ✅ test verdi
- **Test:** 79 unit/integration Rust (56 lib + 23 db_tests) + 100 frontend (vitest)
- **Repo GitHub:** `github.com/yassine04-06/remotprogect` (updater endpoint in `tauri.conf.json`)
- **⚠️ La cartella locale NON è un repo git** (scaricata come ZIP) — i miglioramenti recenti non sono ancora pushati.

## Architettura (sintesi — dettaglio in ARCHITECTURE.md)

- **Backend Rust:** `lib.rs` (entry + ~120 comandi Tauri) → `commands/` (dominio) → `database/` (8 moduli, r2d2 pool) + moduli protocollo (`ssh`, `rdp`, `vnc_client`, `sftp_ftp`, `docker`, `proxmox`, `telnet`, `local_shell`).
- **Stato condiviso:** `AppState` (god-struct, ~20 campi) con `DashMap` per sessioni e `RwLock<Option<MlockedKey>>` per la master key.
- **Frontend:** React + Zustand (4 store: UI, connection, credential, tab) + `services/api/` (18 moduli, 1 per dominio) + componenti per feature-dir (`vnc/ rdp/ ssh/ modals/ sidebar/ forms/ docker/`).
- **IPC:** comandi Tauri `invoke` + eventi `emit` per streaming (terminali, VNC frame, status).
- **CLI companion:** bin `nexorc` (`src/bin/nexorc_cli.rs`) legge lo stesso vault.

## Feature implementate

SSH (subprocess OpenSSH per sessione interattiva; `russh` nel CLI), RDP (helper C# ActiveX su Windows + fallback `mstsc`/FreeRDP su Unix), VNC (RFB nativo, JPEG/CopyRect), SFTP/FTP, Telnet (IAC-aware), local shell, Proxmox, Docker exec. Vault AES-256-GCM + Argon2id. Credential profiles. SSH key vault. Import PuTTY/`.rdp`/mRemoteNG/RoyalTS/`~/.ssh/config`/RDM. Session recording (SSH+local+docker, asciicast). 2FA/TOTP. Backup/restore vault (.zip, staged). Audit log hash-chain + export CSV/PDF. Health dashboard. Port scanner + DNS/reverse-DNS/traceroute/MAC-vendor/Wake-on-LAN. Command palette + snippet con variabili. Smart folders, bulk operations, duplicate-as-template. Telemetry opt-in + crash reporter. Auto dark/light + reduced-motion.

## Feature mancanti / non implementate

- SSH desktop ancora subprocess OpenSSH (no `russh` lato app — solo nel CLI)
- Recording playback per RDP/VNC (sono video, non asciicast)
- Team vault / sync E2E · RBAC · SSO/SAML/OIDC · mobile · plugin SDK (enterprise)
- Hardware token (YubiKey/FIDO2) · JIT credentials
- Pricing/license server · docs site · demo video
- SPICE / NX (protocolli grafici)

## Debiti tecnici (vedi AUDIT_REPORT.md)

1. **`import.rs` 1654 righe** — god module, va splittato per formato.
2. **`AppState` god-struct** (~20 campi) — refactor a multi-vault toccherà ogni comando.
3. **Sync/async misto** (SSH thread, Docker tokio, VNC sync) — ogni feature sceglie un lato.
4. **`From<String> for AppError`** ancora vivo — nuovi `?` collassano su Internal.
5. **Single-window assumption** — multi-window richiede routing eventi rivisto.
6. **Nessun `trait RemoteSession`** — ogni nuovo protocollo costa 5-7 file.
7. **RDP doppio path** (C# helper Windows + FreeRDP Unix).

## Bug noti (vedi BUG_REPORT.md)

- **Risolti in questa sessione:** restore corrompeva DB (→ staged-restore), Telnet IAC split, database_tests non compilava, schema-version test stale.
- **Aperto (sicurezza):** `nexorc_cli.rs:~153` stampa la password SSH in chiaro su stderr in modalità password-auth.

## Decisioni importanti

- **`panic = "unwind"`** in release (non "abort"): un panic in un thread reader di sessione viene catturato e trasformato in disconnect.
- **Token di verifica vault = cifratura di 32 byte random** (l'auth tag GCM è l'oracolo, nessun plaintext fisso).
- **Telemetry gated su consenso runtime** — Sentry non parte finché l'utente non opta in.
- **Restore staged** — applicato all'avvio prima di aprire il DB (no file-lock su Windows).
- **TOTP server-side** — il secret base32 (cifrato) non lascia mai il backend; solo il codice 6 cifre va al frontend.

## Convenzioni di codice

- **Rust:** comandi Tauri in `commands/` o moduli protocollo; errori via `AppError` (typed); chiave master copiata fuori dai guard prima di `.await` (RwLockReadGuard non è Send); `#[ts(...)]` per i tipi esposti al frontend.
- **Tipi TS generati** da `cargo run --bin generate_types` (o `npm run generate-types`) → `src/types/generated.ts`. **Non editare a mano.** Aggiungere nuovi tipi anche nell'export del bin.
- **Migration DB:** aggiungere `migrate_vN` + voce nello slice `MIGRATIONS` + bump `CURRENT_SCHEMA_VERSION` (assert legato alla costante nei test).
- **Frontend:** Zustand per stato, `services/api/<dominio>.ts` per IPC, componenti per feature-dir, Tailwind + CSS vars per i temi.
- **Test:** `#[cfg(test)] mod tests` nei moduli Rust; vitest per il frontend.

## TODO prioritizzati

1. 🔴 Fix leak password CLI (`nexorc_cli`) → usare `SSH_ASKPASS`, non stamparla.
2. 🟠 Split `import.rs` per formato (putty/rdp/mremoteng/royalts/rdm/sshconfig).
3. 🟠 Pushare su GitHub (la cartella locale non è un repo git).
4. 🟡 `trait RemoteSession` per ridurre il costo di nuovi protocolli.
5. 🟡 Test runtime end-to-end delle feature nuove (backup→restore, TOTP, Telnet).

## Ultime modifiche effettuate

Vedi cronologia in fondo.

## Informazioni che Claude dovrebbe conoscere prima di lavorare

- **Più agenti hanno lavorato in parallelo** su questo tree — verificare sempre lo stato reale (`cargo check`, `tsc`) prima di assumere.
- Dopo aver cambiato un modello Rust esposto al frontend, **rigenerare i tipi** e aggiornare i chiamanti (i tipi `Option<T>` con `#[ts(optional = nullable)]` generano `?: T | null`).
- `generate_types` impiega ~2 min (ricompila la lib). Pianificare di conseguenza.
- La macchina di sviluppo non ha .NET csc → warning `RdpEmbed.cs compilation failed` è atteso, non un bug.
- Non esiste `gh` CLI sulla macchina; git sì.

---

## Cronologia modifiche

- **2026-06-13** — **Push GitHub + CI green:** repo collegato a `yassine04-06/remotprogect`, nuova versione pushata (commit su `main`, storia preservata). Fix CI: ① `cargo fmt --all` (lo step fmt bloccava i 3 job Rust); ② `cargo audit` reso vero gate con 3 advisory ignorati e documentati — `RUSTSEC-2023-0071` (rsa Marvin, no fix upstream), `RUSTSEC-2026-0154/0153` (russh/russh-cryptovec unbounded alloc, **solo CLI**, fix richiede russh≥0.60 = major break). **TODO sicurezza:** rimuovere russh instradando il CLI `exec` su `ssh` di sistema (elimina entrambi gli advisory + la dipendenza). `target/` aggiunto a `.gitignore`.
- **2026-06-13** — **M-D (UX polish):** ① `PromptDialog` riusabile promise-based (`usePromptStore` + `prompt()`) → eliminati tutti i `window.prompt` (WoL MAC con validazione, smart folder name); ② onboarding: empty-state HealthDashboard trasformato in "Welcome" con CTA "Add first connection" + "Import"; ③ a11y: `role=dialog`/`aria-modal`/esc-to-close su PromptDialog/TotpModal/ConnectionForm/SettingsModal (9/11 modali già con esc, 70 aria-label esistenti). **A11y completo WCAG AA resta dedicato** (focus-trap, contrasto su tutti i temi, test con screen reader — non eseguibile senza assistive tech). tsc+eslint+100 test verdi.
- **2026-06-13** — **M-C (performance):** ① TotpModal: countdown locale + refetch solo a fine finestra 30s (≥30× meno decrypt); ② aggiornamenti ottimistici store in QuickConnectBar (append) e bulk-move sidebar (patch group_id) invece di re-fetch completo; ③ benchmark `criterion` (`benches/crypto_bench.rs`: Argon2id derive, encrypt_v2/decrypt_auto). tsc+cargo check verdi.
- **2026-06-13** — **M-A (sicurezza) + M-B (quick-win):** ① fix leak password CLI → `SSH_ASKPASS` (Unix) / clipboard via stdin (Windows), mai più `eprintln!` della password; ② job `cargo audit` nel CI (non-blocking); ③ rimosso username dal log SSH debug; ④ flag `ciphertext_v2_migrated` in config.json (no rescan ad ogni unlock); ⑤ TotpModal ferma il polling a vault locked (notice inline); ⑥ restore downgrade-guard (rifiuta backup da schema più recente). **#33 (AppError nei moduli nuovi) rinviato a M-E** — è migrazione a catena cosmetica, non quick-win. Tutto verde.
- **2026-06-13** — Sessione QA enterprise: generati AUDIT/BUG/SECURITY/PERFORMANCE/RELEASE_READINESS report, ARCHITECTURE e questo file. Fix: staged-restore (no DB corruption), Telnet IAC-split carry-over, database_tests `mac_address`, schema-version test → costante, 4 warning clippy. Aggiunti unit test (telnet IAC, TOTP, backup). Tutto verde.
- **2026-06-13** — M5: backup/restore vault (.zip), 2FA/TOTP storage (migration v15).
- **2026-06-13** — M3/M4: smart folders, duplicate-as-template, bulk operations, Telnet (migration: protocol enum + nessuna colonna), import RDM (già presente).
- **2026-06-13** — M2: traceroute, MAC vendor, Wake-on-LAN + campo MAC (migration v14), DNS/reverse-DNS, HIBP, audit CSV/PDF, recording local/docker.
- **2026-06-13** — M1: telemetry consent, crash reporter, ARM CI matrix, beta channel, GPG signing.
- **(altra sessione)** — CLI `nexorc` (russh), CRIT-A1 mlock master key (`locked_key.rs`), CRIT-A2 recording encryption.
