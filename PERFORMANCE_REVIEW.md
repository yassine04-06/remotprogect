# PERFORMANCE_REVIEW.md — NexoRC

**Data:** 2026-06-13 · **Metodo:** revisione statica dei path caldi (I/O, lock, rendering, allocazioni).

---

## 1. Backend

| # | Gravità | Osservazione | Evidenza | Raccomandazione |
|---|---|---|---|---|
| P-1 | 🟡 | `totp_list` decifra **tutti** i secret ad ogni chiamata; la UI la invoca ogni 1s | `totp.rs` + `TotpModal.tsx` | Con N secret, N decrypt/s. Cache: decifrare una volta, ricalcolare solo il codice (deterministico dal tempo) lato frontend o cache backend |
| P-2 | 🔵 | `migrate_legacy_ciphertexts_to_v2` scansiona 3 tabelle ad ogni unlock | `database/mod.rs` | Una sola volta dopo migrazione; aggiungere flag "migrated" in config per saltare |
| P-3 | 🔵 | VNC: copia RGBA→RGB per ogni rect grande prima del JPEG | `vnc_client.rs` | Accettabile (JPEG riduce IPC); profilare solo se CPU alta |
| P-4 | 🔵 | r2d2 pool fisso a 16 | `database/migrations.rs:18` | OK fino a ~centinaia di connessioni; valutare `num_cpus*2` se necessario |

**Punti di forza:** DashMap (no lock globale sulle sessioni), `BEGIN IMMEDIATE` per batch, lock tenuti brevi (chiave copiata e rilasciata subito), I/O di backup/restore in `spawn_blocking` (non blocca il runtime async).

## 2. Frontend

| # | Gravità | Osservazione | Evidenza | Raccomandazione |
|---|---|---|---|---|
| P-5 | 🔵 | Bulk ops + quick-connect rifanno `getConnections()` completa dopo mutazione | `ServerSidebar.tsx`, `QuickConnectBar.tsx` | Aggiornamento ottimistico dello store invece di re-fetch |
| P-6 | 🔵 | `TotpModal` re-render ogni 1s su tutta la lista | `TotpModal.tsx` | OK per pochi item; memoizzare le righe se la lista cresce |
| P-7 | ✅ | Viste pesanti (xterm, VNC canvas, RDP) lazy-loaded + MRU mounting | `App.tsx` | Già ottimizzato |

**Punti di forza:** code-splitting per protocollo (`lazy()`), MRU tab mounting (max 4 montate + sessioni live), RAF batching dei frame VNC, WebGL addon per xterm con fallback canvas, virtual list nella sidebar.

## 3. I/O e rete

- Backup/restore, DNS, traceroute, ping, scan: tutti in `spawn_blocking`/async → non bloccano la UI.
- VNC frame batchati su RAF (16ms) lato frontend.
- Port scanner concorrente con cancellazione per-scan (DashMap di flag).

## 4. Allocazioni / copie superflue

- ✅ Clippy `needless_borrow`/`needless_clone` puliti (0 warning).
- 🔵 `String::from_utf8_lossy(...).to_string()` nei reader di terminale (telnet/shell/docker) — necessario per l'evento serializzabile; impatto trascurabile.

## 5. Benchmark mancanti

- Nessun benchmark `criterion`. **Raccomandazione:** aggiungere benchmark per: parsing asciicast, derivazione Argon2id (per tarare i parametri), throughput IPC con 500 connessioni. Non bloccante.

## Verdetto performance: **7.5/10**

Nessun collo di bottiglia critico. Le ottimizzazioni strutturali importanti (lazy-load, MRU, DashMap, RAF batching, spawn_blocking) sono **già presenti**. I punti aperti (P-1 TOTP refresh, P-5 re-fetch) sono micro-ottimizzazioni a basso impatto. Per arrivare a 9+: aggiornamenti ottimistici nello store, cache TOTP, benchmark suite.
