# RELEASE_READINESS.md — NexoRC

**Data:** 2026-06-13 · Versione 1.0.4
**Baseline verificata:** clippy 0 warning · tsc+eslint 0 · 79 test Rust + 100 frontend verdi

---

## Punteggi

| Dimensione | Voto | Motivazione (evidence-based) |
|---|---:|---|
| **Architettura** | 7.5/10 | Separazione pulita commands/database/api, tipi generati. Penalità: god-struct `AppState`, god-module `import.rs` (1654 righe), sync/async misto |
| **Sicurezza** | 8.5/10 | AES-256-GCM, Argon2id, mlock+zeroize, audit hash-chain, CSP, rate-limit, telemetry consent. Penalità: leak password CLI (🔴), no `cargo audit` in CI |
| **Performance** | 7.5/10 | Lazy-load, MRU, DashMap, RAF batching, spawn_blocking già presenti. Penalità: TOTP refresh 1s, re-fetch dopo mutazioni, no benchmark |
| **UX** | 8/10 | Dark/light auto, reduced-motion, command palette, smart folders, bulk ops, crash reporter, countdown 2FA. Penalità: alcune azioni usano `window.prompt` (MAC, smart folder), no onboarding guidato |
| **Testing** | 6.5/10 | 79 Rust + 100 frontend, parser import ben coperti, nuovi moduli testati. Penalità: no integration test SSH/SFTP/Docker reali, componenti UI non testati, E2E solo on-demand |
| **Maintainability** | 7.5/10 | Naming coerente, feature-dir, tipi generati, doc aggiornata. Penalità: file >800 righe, commenti con codici interni opachi |
| **Enterprise readiness** | 6/10 | Audit tamper-evident, crypto solida, SBOM, release multi-OS. Penalità: no SSO/RBAC/team-vault, no code signing, no `cargo audit`, repo non ancora pushato |

### Media complessiva: **7.4/10** — *Beta pubblica pronta · Enterprise: gap noti*

---

## Idoneità per scenario

| Scenario | Pronto? | Note |
|---|---|---|
| **Beta pubblica** | ✅ Sì | Funzionale, sicuro, stabile. Fixare il leak password CLI prima |
| **Uso professionale (singolo/team piccolo)** | ✅ Sì | Più ricco di mRemoteNG; vault solido |
| **Vendita commerciale (prosumer)** | 🟡 Quasi | Serve: code signing, landing/pricing, docs, fix CLI |
| **Ambienti enterprise** | ❌ No | Mancano SSO/SAML, RBAC, team-vault, SOC2/FIPS, audit streaming |

---

## Cosa manca per arrivare a 10/10

### Architettura → 10
- [ ] Spezzare `AppState` in sotto-struct coese (`Sessions`, `Security`, `Db`)
- [ ] `trait RemoteSession` + registry per i protocolli
- [ ] Split `import.rs`, `sftp_ftp.rs`, `docker.rs` (>800 righe)
- [ ] Migrare i moduli nuovi (`telnet/totp/backup`) da `Result<_,String>` ad `AppError`

### Sicurezza → 10
- [ ] 🔴 Fix leak password CLI (`SSH_ASKPASS`)
- [ ] `cargo audit` + `cargo deny` nel CI (gated)
- [ ] Code signing Windows/macOS (richiede cert a pagamento)
- [ ] Pen-test esterno + threat model documentato

### Performance → 10
- [ ] Cache TOTP (no decrypt ogni secondo)
- [ ] Aggiornamenti ottimistici nello store (no re-fetch)
- [ ] Benchmark `criterion` (Argon2id tuning, IPC throughput, parseAsciicast)

### UX → 10
- [ ] Sostituire `window.prompt` con modal nativi (MAC, smart folder)
- [ ] Onboarding/tour primo avvio
- [ ] Accessibility audit (WCAG AA) completo

### Testing → 10
- [ ] Integration test SSH/SFTP/Docker in container (docker-compose)
- [ ] Test componenti UI (React Testing Library)
- [ ] E2E Playwright nel CI (non solo on-demand)
- [ ] Fuzz test parser asciinema + VNC framebuffer

### Maintainability → 10
- [ ] Glossario dei codici interni (`90-*`, `CRIT-*`) o rimozione
- [ ] Ridurre file >800 righe sotto soglia

### Enterprise → 10
- [ ] SSO/SAML/OIDC, RBAC, team-vault sync E2E
- [ ] Audit log streaming (syslog/S3 object-lock)
- [ ] SOC 2 / FIPS mode, hardware token

---

## Piano consigliato per una release commerciale stabile

**Sprint 1 — Hardening (giorni)**
1. Fix leak password CLI 🔴
2. `cargo audit`/`cargo deny` nel CI
3. Push su GitHub + tag `v1.1.0-beta.1`
4. Test runtime end-to-end (backup→restore, TOTP, Telnet, una sessione per protocollo)

**Sprint 2 — Polish (1-2 settimane)**
5. Sostituire `window.prompt` con modal
6. Split `import.rs` + `AppError` per moduli nuovi
7. Integration test SSH/SFTP in container + E2E nel CI
8. Landing + docs (in corso)

**Sprint 3 — Commerciale (settimane)**
9. Code signing Windows EV + notarization macOS (quando il budget lo consente)
10. Cache TOTP + aggiornamenti ottimistici
11. Onboarding + accessibility audit

**Oltre (mesi, solo se c'è domanda enterprise)**
12. SSO/RBAC/team-vault, audit streaming, SOC2

---

## Maturità del progetto

**Beta avanzata, qualità sopra la media per lo stadio.** Il debito di sicurezza dell'audit originale è chiuso (mlock, recording crypt, hash-chain, resolve server-side). Il prodotto è **funzionalmente più completo dei competitor OSS** (mRemoteNG, Remmina) e regge il confronto feature con i commerciali su connessioni/import/recording. I gap verso "enterprise 10/10" sono **noti, finiti e prezzabili** — non c'è incertezza tecnica, solo lavoro di esecuzione e (per il code signing) budget.
