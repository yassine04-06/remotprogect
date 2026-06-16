# AUDIT_REPORT.md — Revisione enterprise NexoRC

**Data:** 2026-06-13 · **Metodo:** evidence-based (ogni finding cita `file:riga`)
**Scope:** 48 file Rust (~14.6k LOC) + 90 file TS/TSX (~16.9k LOC)
**Baseline qualità:** `cargo clippy` 0 warning · `tsc`+`eslint` 0 · 79 test Rust + 100 frontend verdi

Legenda gravità: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low

---

## 1. Architettura

| # | Gravità | Problema | Evidenza | Impatto | Rischio futuro | Soluzione |
|---|---|---|---|---|---|---|
| A-1 | 🟠 | `AppState` god-struct (~20 campi: pool, chiave, 6 mappe sessioni, rate-limiter, lockout…) | `state.rs` | Ogni comando dipende dall'intero stato; refactor multi-vault tocca tutto | Alto se si va multi-tenant/multi-window | Raggruppare in sotto-struct coese (`Sessions`, `Security`, `Db`) dietro l'`AppState` |
| A-2 | 🟡 | Nessun `trait RemoteSession` comune | moduli `ssh/rdp/vnc/telnet/docker` | Ogni protocollo nuovo = 5-7 file (backend, command, api, view, routing) | Medio | Astrarre connect/send/disconnect/stream in un trait + registry |
| A-3 | 🟡 | Sync/async misto (SSH `thread::spawn`, Docker/Telnet tokio, VNC sync) | `ssh.rs`, `docker.rs`, `telnet.rs`, `vnc_client.rs` | Ogni feature deve scegliere modello di concorrenza; difficile ragionare globalmente | Medio | Documentato come scelta consapevole; consolidare su tokio quando si tocca un modulo |
| A-4 | 🟡 | `import.rs` 1654 righe — god module multi-formato | `import.rs` | Difficile navigare/testare; 6 parser in un file | Medio | Split `import/{putty,rdp,mremoteng,royalts,rdm,ssh_config}.rs` |
| A-5 | 🔵 | Single-window assumption | `lib.rs` setup | Multi-window richiede routing eventi rivisto | Basso | Documentato; non urgente |
| A-6 | 🔵 | RDP doppio path (C# ActiveX Windows + FreeRDP Unix) | `rdp.rs` | Due code-path da mantenere | Basso | Inevitabile per cross-platform; isolare dietro interfaccia |

**Punti di forza:** separazione `commands/` per dominio, `database/` splittato in 8 moduli, `services/api/` 1-modulo-per-dominio, componenti per feature-dir, tipi TS generati dal backend (single source of truth).

## 2. Sicurezza (dettaglio in SECURITY_REVIEW.md)

| # | Gravità | Problema | Evidenza | Soluzione |
|---|---|---|---|---|
| S-1 | 🔴 | CLI stampa password SSH in chiaro su stderr | `nexorc_cli.rs` (`paste when ssh prompts: {pw}`) | Usare `SSH_ASKPASS`, mai stamparla |
| S-2 | 🔵 | Username loggato a `debug` | `ssh.rs:156` | OK (PII scrubbing attivo via `log_writer`), ma valutare di rimuovere |

**Punti di forza (verificati):** AES-256-GCM (`aes-gcm`), Argon2id (`argon2`), master key in `MlockedKey` con `VirtualLock`/`mlock` + `Zeroize` (`locked_key.rs`), `secrecy` per password in transito, audit hash-chain SHA-256, CSP ristretta (`connect-src 'self' ipc: ws: wss:`), rate-limit 100 req/s (`governor`), telemetry gated su consenso, TOTP server-side, recording cifrati, restore con path-traversal guard.

## 3. Performance (dettaglio in PERFORMANCE_REVIEW.md)

| # | Gravità | Problema | Evidenza | Soluzione |
|---|---|---|---|---|
| P-1 | 🟡 | `totp_list` decifra tutti i secret ogni secondo (refresh UI) | `TotpModal.tsx` + `totp.rs` | Cache lato frontend dei secret decifrati; ricalcolare solo il codice |
| P-2 | 🔵 | `getConnections` rifà query completa dopo ogni mutazione bulk | `ServerSidebar.tsx` bulk ops | Aggiornamento ottimistico dello store |
| P-3 | 🔵 | VNC framebuffer: copie RGBA→RGB per JPEG ad ogni rect grande | `vnc_client.rs` | Accettabile; profilare solo se necessario |

**Punti di forza:** r2d2 pool (16), DashMap concurrent (no lock globale), lazy-load viste pesanti, MRU tab mounting, JPEG per rect grandi, bound-check framebuffer.

## 4. Concorrenza

| # | Gravità | Problema | Evidenza | Soluzione |
|---|---|---|---|---|
| C-1 | ✅ | Guard `std::sync` across `.await` | verificato: chiave copiata fuori dai guard (`proxmox.rs:265`, pattern in tutti i `*_connect`) | Nessun fix — corretto per costruzione (RwLockReadGuard non Send) |
| C-2 | 🔵 | Thread reader di sessione non sempre `join()`-ati al disconnect | `ssh.rs`, `local_shell.rs` | `panic=unwind` mitiga; valutare handle tracking |

**Punti di forza:** DashMap per tutte le mappe di sessione (lock per-shard), tokio Mutex async dove serve (docker writer), `rekey_lock` per serializzare re-key, `BEGIN IMMEDIATE` per migration/migrazioni ciphertext.

## 5. Gestione errori

| # | Gravità | Problema | Evidenza | Soluzione |
|---|---|---|---|---|
| E-1 | 🟡 | `From<String> for AppError` collassa su `Internal` | `error.rs` | Nuovi `?` perdono tipizzazione; migrare gradualmente a varianti tipate |
| E-2 | 🔵 | Moduli nuovi (`telnet`, `totp`, `backup`) ritornano `Result<_, String>` invece di `AppError` | `telnet.rs`, `totp.rs`, `backup.rs` | Allineare ad `AppError` per coerenza (cosmetico) |

**Punti di forza:** `AppError` tipizzato propagato al frontend, `errorMapper.ts` traduce in messaggi user-friendly, ErrorBoundary con crash report.

## 6. Test coverage (dettaglio in fondo)

- **Rust:** 79 test (import parser ben coperti, known_hosts, proxmox ticket validation, telnet IAC, TOTP, backup staging). **Gap:** nessun integration test SSH/SFTP/Docker reale (richiede container), nessun test su `vault.rs` re-key flow, nessun test su `network.rs` traceroute parsing.
- **Frontend:** 100 test (store, hooks, api, parseAsciicast, errorMapper). **Gap:** componenti UI non testati (solo logica); E2E Playwright esiste ma gira solo on-demand.

## 7. Manutenibilità / Naming / Documentazione

- ✅ Naming coerente e descrittivo (italiano nei commenti storici, inglese nelle stringhe user-facing).
- ✅ Tipi TS generati = single source of truth.
- 🟡 Commenti storici con codici interni (`90-7`, `MED-A8`, `CRIT-A3`) — utili per tracciabilità ma opachi per un nuovo dev; ARCHITECTURE.md ora li contestualizza.
- 🟡 `import.rs`, `sftp_ftp.rs`, `docker.rs` > 800 righe — candidati a split.

## Riepilogo conteggio findings

| Gravità | Conteggio |
|---|---|
| 🔴 Critical | 1 (S-1 password CLI) |
| 🟠 High | 1 (A-1 god-struct) |
| 🟡 Medium | 8 |
| 🔵 Low | 7 |

**Conclusione:** codebase **sopra la media** per un progetto a questo stadio — sicurezza forte, build pulita, test discreti. I problemi sono di **scalabilità manutentiva** (god-struct, god-module) non di correttezza. Un solo Critical (leak password CLI) è azionabile in minuti.
