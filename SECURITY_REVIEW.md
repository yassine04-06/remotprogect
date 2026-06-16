# SECURITY_REVIEW.md — NexoRC

**Data:** 2026-06-13 · **Metodo:** revisione manuale + verifica dipendenze + grep pattern sensibili.

---

## 1. Gestione credenziali — ✅ Forte

| Aspetto | Implementazione | Evidenza |
|---|---|---|
| Cifratura at-rest | AES-256-GCM | `aes-gcm = 0.10`, `encryption.rs` |
| Derivazione chiave | Argon2id (m=64MiB, t=3, p=4) + migrazione da PBKDF2 | `encryption.rs`, `argon2 = 0.5` |
| Master key in RAM | `MlockedKey`: `VirtualLock`/`mlock` (no swap) + `Zeroize` on drop | `locked_key.rs` |
| Password in transito | `secrecy::SecretString` | `vault.rs` |
| Verifica password | cifratura di 32 byte random — l'auth tag GCM è l'oracolo (nessun plaintext fisso) | `encryption.rs:create_verification_token` |
| Resolve credenziali | `*_connect` prendono `connection_id`, lookup+decrypt **server-side**; il plaintext non torna al frontend (eccetto path legacy rimossi) | `lib.rs:604`, `commands/credentials.rs` |
| TOTP secret | base32 cifrato AES-256-GCM; codice calcolato server-side | `totp.rs` |

## 2. Integrità & audit — ✅ Forte

- **Audit log hash-chain** SHA-256 (`chain_hash = SHA256(prev ‖ row)`) + comando `audit_log_verify` → tamper-evident. `database/audit.rs`.
- **Updater firmato** (minisign pubkey embedded). `tauri.conf.json`.
- **RdpEmbed.exe integrity** via SHA-256 (anti-tampering del helper). `rdp.rs`.

## 3. Superficie d'attacco / IPC — ✅ Buono

- **CSP ristretta:** `connect-src 'self' ipc: http://ipc.localhost ws: wss:` — nessun dominio esterno; `object-src 'none'`; `base-uri 'self'`. `tauri.conf.json`.
- **Rate limiting:** `governor` 100 req/s per comando → previene flood IPC da bug frontend. `lib.rs:453`.
- **DevTools** gated dietro `NEXORC_OPEN_DEVTOOLS=1` dentro `cfg!(debug_assertions)`. `lib.rs`.
- **HIBP breach-check** via k-anonymity (solo i primi 5 char dello SHA-1 lasciano la macchina). `network.rs`.

## 4. Logging dati sensibili — ✅ Buono, 1 nota

- **PII scrubbing** in `log_writer` + `scrub_sentry_event` (IP, fingerprint, user, host → redatti). `lib.rs:184`.
- **Telemetry opt-in**: Sentry non inizializza senza consenso esplicito. `telemetry.ts`.
- ⚠️ `ssh.rs:156` logga lo username a `debug` (scrubbed dal writer, ma valutare rimozione). **Nessuna password/token/secret loggato** (verificato via grep).

## 5. File sensibili / storage locale — ✅ Buono

- DB, config, recordings, certs in `<data_dir>/nexorc/`; recordings con `chmod 0600` (Unix).
- Restore con **path-traversal guard** (`..`/absolute rifiutati). `backup.rs`.
- Backup `.zip` contiene dati già cifrati at-rest (richiede master password per decifrare).

## 6. 🔴 Finding critico

### SEC-1 — CLI stampa password SSH in chiaro
- **File:** `src/bin/nexorc_cli.rs` (password-auth mode).
- **Rischio:** credenziale nello scrollback/log del terminale.
- **Fix:** `SSH_ASKPASS` helper temporaneo (0600, auto-delete) o stdin; mai `eprintln!` della password.

## 7. Dipendenze

- Stack crypto da crate auditati e mantenuti: `aes-gcm`, `argon2`, `sha2`, `hmac`, `rand`, `zeroize`, `secrecy`.
- ⚠️ `russh 0.44` / `russh-keys 0.44` (CLI) — verificare advisory periodicamente.
- **Raccomandazione:** aggiungere `cargo audit` al CI (step gated) + `cargo deny` per licenze/advisory. SBOM CycloneDX già presente nel workflow.

## 8. Checklist enterprise

| Controllo | Stato |
|---|---|
| Cifratura at-rest credenziali | ✅ AES-256-GCM |
| KDF resistente | ✅ Argon2id |
| Master key non swappabile | ✅ mlock/VirtualLock |
| Zeroization | ✅ |
| Audit tamper-evident | ✅ hash-chain |
| Secret non loggati | ✅ (1 username debug minore) |
| CSP / IPC hardening | ✅ |
| Rate limiting | ✅ |
| Telemetry consent | ✅ |
| Updater firmato | ✅ |
| Password in chiaro nel CLI | 🔴 da fixare |
| `cargo audit` nel CI | ❌ da aggiungere |
| Code signing binari | ❌ (richiede cert a pagamento; non bloccante per OSS/beta) |

**Verdetto sicurezza:** **8.5/10** — stack di livello enterprise. L'unico Critical (leak password CLI) e l'assenza di `cargo audit` nel CI sono gli unici gap reali; entrambi chiudibili in poche ore.
