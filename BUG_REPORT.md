# BUG_REPORT.md — Bug hunt NexoRC

**Data:** 2026-06-13 · **Metodo:** analisi statica + clippy + revisione manuale dei pattern a rischio.

---

## Bug RISOLTI in questa sessione

### B-1 🔴 `vault_restore` corrompeva il database (RISOLTO)
- **Riproduzione:** Settings → Restore Backup mentre l'app è in uso. Su Windows, `fs::write` su `connections.db` mentre SQLite (pool r2d2) lo tiene aperto → file lock / corruzione.
- **Fix applicato:** staged-restore. `vault_restore` spacchetta in `<data_dir>/.restore_staging/`; `apply_staged_restore()` (`backup.rs`) sposta i file all'avvio **prima** di aprire il DB (`lib.rs`, prima di `initialize_database`). + 2 unit test.

### B-2 🔴 Telnet: corruzione stream su sequenza IAC spezzata (RISOLTO)
- **Riproduzione:** server Telnet che invia una negoziazione `IAC DO <opt>` a cavallo di due `read()` TCP → byte persi, terminale corrotto.
- **Fix applicato:** carry-over stateful in `telnet.rs` (`process_iac` ritorna il `leftover`, ri-prependuto al chunk successivo). + 4 unit test (incluso `carries_split_command`).

### B-3 🟠 `database_tests.rs` non compilava (RISOLTO)
- **Causa:** aggiunta campo `mac_address` (M2) non propagata ai mock `UpdateConnectionRequest`.
- **Fix:** aggiunto `mac_address: None`. + test schema-version legato a `CURRENT_SCHEMA_VERSION` (non più hardcodato).

---

## Bug APERTI

### B-4 🔴 CLI: password SSH stampata in chiaro
- **File:** `src/bin/nexorc_cli.rs` — modalità password-auth: `eprintln!("...paste when ssh prompts: {pw}")`.
- **Impatto:** la password resta nello scrollback del terminale e in eventuali log di sessione. Leak di credenziale.
- **Riproduzione:** `nexorc connect <host-con-password>` → password visibile a schermo.
- **Fix consigliato:** scrivere la password su un helper `SSH_ASKPASS` temporaneo (chmod 0600, auto-eliminato) ed esportare `SSH_ASKPASS`/`SSH_ASKPASS_REQUIRE=force`, oppure passare via stdin. Mai stamparla.

---

## Pattern a rischio — VERIFICATI sicuri (no bug)

| Pattern | Verifica | Esito |
|---|---|---|
| Guard `std::sync` across `.await` | chiave copiata fuori dal guard prima dell'await (`proxmox.rs:265`, tutti i `*_connect`); `RwLockReadGuard` non è `Send` → il compilatore garantirebbe l'errore | ✅ sicuro |
| `unwrap()/expect()` prod (49 occorrenze) | concentrati in `#[cfg(test)]` (known_hosts 16, import 11, backup 9, totp 4, network 2) o infallibili (`NonZeroU32::new(100)`, `try_into` slice a lunghezza fissa `vnc_client.rs:148`) | ✅ nessun panic raggiungibile |
| Overflow framebuffer VNC | bound-check `w*h*4 < 64MiB` su ServerInit e per-rect (`vnc_client.rs:52,260,456`) | ✅ protetto |
| Path traversal in restore/import | guard `..`/absolute rifiutati (`backup.rs`, import canonicalize) | ✅ protetto |
| Lock poisoning | `.read().map_err(lock_err)` ovunque, mai `.unwrap()` su lock in prod | ✅ gestito |
| Panic in thread reader sessione | `panic = "unwind"` + il thread isolato → al massimo disconnette la sessione | ✅ contenuto |
| TOTP HMAC offset out-of-bounds | `offset = hash[19] & 0xf` (max 15) + 3 = 18 < 20 (SHA-1) | ✅ sicuro |
| Migration concorrenti | `BEGIN IMMEDIATE` + `rekey_lock` | ✅ serializzato |

## Edge case da monitorare (non bug, ma fragili)

| # | Area | Nota |
|---|---|---|
| EC-1 | `traceroute`/`tracert` parsing | output localizzato: il parser usa regex IP language-independent, ma se il tool non è installato ritorna errore chiaro. Nessun crash. |
| EC-2 | `totp_list` con vault locked | ritorna errore "Vault locked" — corretto, ma la UI si refresha ogni 1s → spam di errori se aperta a vault locked. Mitigare: non aprire il modal a vault locked. |
| EC-3 | Restore di backup da versione schema futura | nessun downgrade guard sul DB restaurato; le migration sono additive quindi un DB più nuovo potrebbe avere colonne non lette. Documentare "non ripristinare backup da versioni più recenti". |
| EC-4 | Thread reader non `join()`-ati | su disconnect rapido ripetuto potrebbero accumularsi brevemente; `panic=unwind` + drop dei canali li termina. Monitorare con molte sessioni. |

## Conclusione

**1 bug critico aperto** (leak password CLI, fix in minuti). **3 bug critici/alti risolti** in questa sessione con test di regressione. Nessun panic raggiungibile in produzione, nessuna race su lock, nessun overflow non protetto. Il codice è **robusto sul fronte memory/concorrenza**.
