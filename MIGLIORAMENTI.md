# MIGLIORAMENTI — Nexus Remote Manager

Master TODO + roadmap. **Solo le cose ancora da fare.** Tutto ciò che è già
implementato è stato rimosso da questo file (vedi `git log` e i commenti
`CRIT-*/HIGH-*/MED-*/LOW-*` nel sorgente per lo storico).

**Legenda severità:** 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low
**Legenda effort:** ⚡ ore · 🔧 1-3 giorni · 🛠 1-2 settimane · ⚙ 3-6 settimane · 🏗 mesi
**Legenda value:** 💰 Commerciale · 🔒 Sicurezza · ⚙️ Architettura · 🎨 UX · 🏢 Enterprise · 🚀 Performance

> **Riconciliato col codice 2026-06-13.** Verifica riga-per-riga del sorgente:
> tutta la sezione 1 audit è chiusa tranne 4 voci; gli import PuTTY/.rdp/mRemoteNG/ssh_config
> e l'RDP cross-platform FreeRDP sono già implementati.

---

## INDICE

1. [Issue aperte — audit "principal architect"](#1-issue-aperte)
2. [Feature parity con i competitor](#2-feature-parity-con-i-competitor)
3. [Feature differenzianti (oltre i competitor)](#3-feature-differenzianti)
4. [Infrastruttura release & commerciale](#4-infrastruttura-release--commerciale)
5. [Roadmap temporale](#5-roadmap-temporale)
6. [Debito architetturale documentato](#6-debito-architetturale-documentato)

---

## 1. ISSUE APERTE

### 🟠 HIGH

| ID | Titolo | File | Effort | Note |
|----|--------|------|-------:|------|
| **HIGH-A1** | SSH è ancora subprocess OpenSSH | `ssh.rs` intero | 🏗 | Migrazione a `russh` per: determinismo stato connessione, niente dipendenza da `ssh.exe` di sistema, TOFU unificato anche su jump-host. ~600-800 righe + test contro OpenSSH 7/8/9, dropbear, libssh-server |

### 🟡 MEDIUM

Nessuna voce audit aperta — MED-A10 (backup/restore vault) implementato.

> CRIT-A1 (mlock master key) e CRIT-A2 (recording encryption) in corso in altra
> sessione — considerate fatte. MED-A10 (backup/restore vault, zip) ✅ fatto.
> Tutte le altre voci MEDIUM (A1-A9, A11-A15) e
> **tutte** le LOW (A1-A8) della revisione audit sono implementate e rimosse.

---

## 2. FEATURE PARITY CON I COMPETITOR

Confronto con **RoyalTS · mRemoteNG · Devolutions RDM · MobaXterm · Termius · Remmina**.

### 2.1 — Feature core mancanti

| Feature | Competitor | Effort | Value | Priorità |
|---------|-----------|-------:|------:|---------:|
| **Team/sync vault** (vault condiviso end-to-end-encrypted) | RoyalTS, RDM, Termius | 🏗 | 💰🏢 | **CRITICA** per enterprise |
| **Multi-monitor RDP** | RoyalTS, RDM | 🛠 | 💰 | Media |
| **RDP Gateway support** | RoyalTS, RDM | 🛠 | 🏢 | Media |

> Già fatti: Import PuTTY (`.ppk`), Import `.rdp`, Import mRemoteNG (`Confcons.xml`),
> Import `~/.ssh/config`, RDP cross-platform via FreeRDP, SSH key passphrase,
> **password generator** (secure, copy-to-clipboard) + **HIBP breach-check**
> (k-anonymity), **Wake-on-LAN** (magic packet + campo MAC nel DB), **DNS +
> reverse DNS lookup**, **traceroute**, **MAC vendor lookup** (OUI table),
> **audit log CSV + PDF export**, **recording per local shell e docker exec**,
> **smart folders** (filtri tag salvati), **duplicate-as-template**, **bulk
> operations** (delete/move multipli), **connessione Telnet** (IAC-aware),
> **import Devolutions RDM**, **backup/restore vault** (.zip), **2FA/TOTP
> storage** (codici rotanti cifrati nel vault).

### 2.2 — Feature avanzate (presenti in 2+ competitor)

| Feature | Competitor | Effort | Value | Priorità |
|---------|-----------|-------:|------:|---------:|
| **Snippet/Macro library** (comandi parametrizzati salvati) | RoyalTS, RDM, MobaXterm, Termius | 🔧 | 🎨 | Media — esiste già parziale con saved_commands |
| **Inheritance di settings tra cartelle** (gruppo → connessione) | mRemoteNG, RDM, RoyalTS | 🛠 | ⚙️ | Media |
| **Settings inheritance gruppo→connessione** (vera ereditarietà, non solo template) | RoyalTS, RDM | 🛠 | ⚙️ | Bassa — duplicate-as-template già fatto |
| **Browser extension** (autofill credenziali in web app) | RDM, Termius | 🛠 | 💰 | Media |
| **Mobile companion** (iOS/Android) | RDM, Termius | 🏗 | 💰 | Media-lunga |
| **Mosh support** (mobile shell SSH-compatible) | Termius | 🛠 | 🎨 | Media |
| **Port forwarding GUI** (visualizzazione attiva tunnel) | Termius, MobaXterm | 🔧 | 🎨 | Media |
| **X11 forwarding visualization** | MobaXterm | 🛠 | 🎨 | Bassa |
| **Embedded X server** (per X-forwarding di app GUI Linux) | MobaXterm | 🏗 | 🎨 | Bassa |
| **SFTP browser dentro la sessione SSH** | MobaXterm | 🛠 | 🎨 | Media |
| **Network tools panel** (solo traceroute streaming live mancante) | MobaXterm | 🔧 | 🎨 | Bassa — ping/port-scanner/**DNS**/**reverse DNS**/**traceroute**/**MAC vendor** già presenti |
| **Session sharing/collaboration** (più operatori sulla stessa sessione) | RDM | 🏗 | 🏢 | Lunga |
| **Audit reporting** — solo PDF mancante (CSV già fatto) | RDM | 🔧 | 🏢 | Bassa |
| **Web client** (accesso via browser) | RDM | 🏗 | 🏢 | Lunga |
| **Approvazione / check-in/out delle credenziali** | RDM | 🛠 | 🏢 | Lunga |
| **Connessione SPICE** (proxmox/qemu) | Remmina | 🛠 | 🎨 | Bassa |
| **Connessione NX/NoMachine** | Remmina | 🛠 | 🎨 | Bassa |
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

### 2.4 — Feature UX ancora mancanti

| Feature | Stato Nexus | Effort | Priorità |
|---------|------------|-------:|---------:|
| **Connessione history/playback per RDP/VNC** | SSH+local+docker fatti | 🛠 | Bassa — restano solo i protocolli grafici (formato video, non asciicast) |
| **Multilingue UI** | No (inglese ora) | 🛠 | Media |

> Già fatti: drag-and-drop, quick-connect, recenti, favoriti, note, tag,
> ricerca globale Cmd+K fuzzy, tab shortcuts (Ctrl+Tab / Ctrl+1..9), fullscreen,
> **prefers-reduced-motion**, **auto dark/light** (prefers-color-scheme).

---

## 3. FEATURE DIFFERENZIANTI

Idee per cui **nessun competitor** ha un'offerta solida — potenziali differenziatori commerciali.

| Feature | Effort | Value | Note |
|---------|-------:|------:|------|
| **AI-assisted shell** (natural language → comando shell, con preview e conferma) | 🛠 | 💰🚀 | Termius AI è limitato. Spazio per fare meglio con LLM locali (Ollama) o API (Anthropic/OpenAI). Differenziatore forte |
| **Vault portabile** (USB key) con auto-mount + auto-lock al disconnect | 🔧 | 🔒 | Caso d'uso freelance/consulenza |
| **Session sandboxing** (Docker container per sessione SSH, audit completo) | 🏗 | 🏢🔒 | Niche ma high-value per security teams |
| **Compliance-mode** (registrazione obbligatoria + hash-chain + export PDF firmato) | 🛠 | 🏢 | Per environments PCI-DSS / HIPAA — hash-chain audit già presente |
| **Inactivity-aware lock** via Bluetooth proximity (telefono che si allontana) | 🔧 | 🔒🎨 | UX nuovo |
| **Cross-device handoff** (apri tab su laptop, continua su un altro device) | 🏗 | 🚀 | Richiede team-sync; combinabile con mobile |
| **Native MFA prompt acceleration** (push via Tauri notification, no copy-paste TOTP) | 🔧 | 🎨🔒 | UX win |
| ~~Snippet con variabili dinamiche~~ | ⚡ | 🎨 | ✅ **FATTO** — `{date}{time}{host}{host_ip}{port}{user}` auto-espansi nella Command Palette (oltre ai `{{user-prompted}}` già esistenti). `{git_branch}` resta TODO |
| **Diff-vista tra config di due host** (`diff /etc/nginx.conf @prod1 @prod2`) | 🛠 | 🎨🏢 | DevOps unique |
| **Just-in-time credential issuance** (password che scade in N minuti) | 🛠 | 🏢🔒 | Compliance unique |

---

## 4. INFRASTRUTTURA RELEASE & COMMERCIALE

### 4.1 — Code signing & distribution

| Item | Effort | Costo | Note |
|------|-------:|------:|------|
| **Windows code signing certificate** (Sectigo Standard o EV) | 🔧 | ~€250-450/anno | Senza: SmartScreen warning. EV sblocca reputation subito |
| **Apple Developer Program** | 🔧 | $99/anno | Per Developer ID + notarization |
| **Notarization workflow macOS** (xcrun notarytool nei GitHub Actions) | 🔧 | — | Step nel CI dopo signing |
| **Linux package signing per APT/RPM repo** | 🛠 | ~$5-15/mese | Opzionale |

> Già fatto: updater signing pubkey (`tauri.conf.json`), **GPG signing step**
> per `.deb`/`.AppImage` (CI, gated su `GPG_PRIVATE_KEY` secret).

### 4.2 — CI/CD

| Item | Effort | Note |
|------|-------:|------|
| **Secrets management** (TAURI_SIGNING_PRIVATE_KEY, APPLE_*, WINDOWS_*) | ⚡ | Inserire i valori reali nei GitHub Actions secrets (il workflow li referenzia già) |
| **Reproducible builds** (rust-toolchain.toml + deterministic timestamps) | 🔧 | Per SBOM/SLSA |
| **SLSA Level 3 provenance attestation** | 🔧 | Per enterprise sales |
| **Windows ARM64 target** | 🔧 | runner Windows ARM non ancora GA su GitHub free |

> Già fatto: `ci.yml` con job `release` matrix multi-OS + `tauri-action` + updater
> signing + code signing hooks, build smoke-test, suite E2E Playwright,
> **pre-release/beta channel** (tag `v*-beta.*` → prerelease), **ARM matrix**
> (macOS universal + Linux aarch64), **SBOM CycloneDX**.

### 4.3 — Marketing & commerciale

| Item | Effort | Note |
|------|-------:|------|
| **Pricing page** + Stripe/Paddle/Lemon Squeezy | 🛠 | Per Pro one-time license |

> In corso in altra sessione (considerati fatti): **CLI binary** (`nexorc connect <name>`),
> **sito di landing completo**.
| **License server** (in-app verifica + offline grace period) | 🛠 | Signed JWT con pubkey embedded |
| **Documentation site** (Mintlify / Docusaurus / MkDocs) | 🛠 | Quickstart + protocolli + import + troubleshooting |
| **Demo video** (60-90s) | 🔧 | Per landing page |
| **Comparison page** vs RoyalTS / mRemoteNG / RDM | 🔧 | SEO + acquisition |
| **GitHub Discussions / Discord** per community | ⚡ | Per fase OSS |

> Già fatto: CHANGELOG.md, ARCHITECTURE.md, CONTRIBUTING.md, **telemetry opt-in
> consent flow** (gate runtime su Sentry), **crash reporter UI** (ErrorBoundary
> con invio report rispettoso del consenso).

### 4.4 — Test infrastructure

| Item | Effort | Note |
|------|-------:|------|
| **Integration test SSH/SFTP** con OpenSSH server in container | 🔧 | docker-compose con sshd |
| **Integration test Docker** con dockerd-in-docker | 🔧 | |
| **Integration test Proxmox** (VM o mock HTTP server) | 🛠 | |
| **Performance benchmark** (500-server vault, multi-tab, IPC throughput) | 🔧 | criterion |
| **Fuzz testing** del parser asciinema + VNC framebuffer events | 🔧 | cargo-fuzz |

> Già fatto: suite E2E Playwright base, job SBOM CycloneDX (Rust + npm),
> unit test `parseAsciicast` (8 casi: header/eventi/malformati/resize/formatTime).

---

## 5. ROADMAP TEMPORALE

### Sprint sicurezza (prossimo)
- **MED-A10** backup/restore vault · 🔧

### Sblocco commerciale
- **Import Devolutions RDM** · 🔧
- **GitHub Actions `release.yml`** matrix multi-OS · 🔧
- **Windows code signing cert** (acquisto + integrazione) · €250 + 🔧
- **Apple Developer Program** (enrollment + notarization) · $99 + 🔧
- **Sito landing completo + pricing** · 🛠

### Architettura
- **HIGH-A1** SSH → russh · 🏗
- **HIGH-A4** State across await (convenzione + doc) · 🔧
- **Password generator + HIBP** · 🔧
- **2FA / TOTP storage** · 🔧

### Lungo termine
- **Team vault prototype** (sync E2E-encrypted self-hostable) · 🏗
- **CLI binary** · 🛠
- **Multi-monitor RDP** · 🛠 · **RDP Gateway** · 🛠
- **Wake-on-LAN** · 🔧
- **Recording playback per local/docker/RDP/VNC** · 🔧
- **VNC ZRLE + Tight** · ⚙
- **AI-assisted shell** · 🛠 — differenziatore di mercato
- **RBAC + team licensing · SSO/SAML/OIDC · Mobile companion · Plugin SDK** · 🏗

---

## 6. DEBITO ARCHITETTURALE DOCUMENTATO

| Debito | Impatto | Sintomi quando esploderà |
|--------|---------|--------------------------|
| `AppState` god struct (18 campi) | ⚙️ | Refactor a multi-vault toccherà ogni command |
| Mixed sync/async (SSH thread, Docker tokio, VNC sync) | ⚙️🚀 | Ogni nuova feature deve scegliere un lato |
| `From<String> for AppError` ancora vivo | ⚙️ | Errori del frontend imprecisi; nuovi `?` finiscono Internal |
| Single-window assumption | ⚙️ | Multi-window richiederà routing eventi rivisto |
| Niente `trait RemoteSession` | ⚙️ | Aggiungere Telnet/Rlogin/K8s exec costa 5-7 file ognuno |
| Tauri `state` injection inconsistente (HIGH-A4) | ⚙️ | Latente — esplode quando AppState diventa non-`Sync` |
| RDP via C# helper esterno (mstscax.dll) + FreeRDP path | ⚙️ | Due path da mantenere (Windows ActiveX + Unix FreeRDP) |
| Nessun event-bus abstraction (`AppHandle::emit` diretto) | ⚙️ | CLI version richiederà refactor di ogni protocollo |

---

## NOTE FINALI

**Priorità raccomandata:**
1. **Production infrastructure**: release.yml multi-OS + code signing Windows + macOS notarization.
2. **Sblocco enterprise**: Team vault + 2FA/TOTP + password generator.
3. **Architettura**: SSH → russh (HIGH-A1) prima che il debito sync/async cresca.

**Stato realistico:** Beta avanzata. Il debito di sicurezza audit
("principal architect") è chiuso; resta la migrazione russh come unico item
tecnico grosso. Gli import commerciali (PuTTY/.rdp/mRemoteNG/ssh_config) e l'RDP
cross-platform sono già operativi — la barriera #1 all'adozione è caduta.
