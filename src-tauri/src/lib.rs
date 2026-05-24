pub mod commands;
pub mod database;
pub mod docker;
mod encryption;
mod error;
pub mod import;
mod known_hosts;
mod local_shell;
mod log_writer; // HIGH-A6: PII-scrubbing size+daily rotating log writer
pub mod network;
pub mod proxmox;
pub mod rdp;
pub mod sftp_ftp;
pub mod ssh;
mod state;
pub mod tools;
pub mod vnc;
mod vnc_client;

/// Helpers exposed only for integration tests in tests/*.rs.
#[doc(hidden)]
pub mod test_helpers {
    use crate::database::CreateConnectionRequest;
    use rusqlite::Connection;

    // L-3 SAFETY: this is a `#[doc(hidden)] pub mod test_helpers` — invoked
    // only from integration tests in `src-tauri/tests/`. Panicking here aborts
    // the failing test (the desired behaviour), it is never reachable from a
    // Tauri command.
    pub fn run_migrations_test(conn: &Connection) {
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .unwrap();
        crate::database::run_migrations_pub(conn).expect("migrations failed");
    }

    pub fn make_test_connection(host: &str, protocol: &str) -> CreateConnectionRequest {
        CreateConnectionRequest {
            name: format!("Test {}", host),
            host: host.to_string(),
            port: 22,
            protocol: protocol.to_string(),
            username: "testuser".to_string(),
            password_plaintext: None,
            password_encrypted: None,
            private_key_plaintext: None,
            private_key_encrypted: None,
            group_id: None,
            use_private_key: false,
            rdp_width: None,
            rdp_height: None,
            rdp_fullscreen: None,
            domain: None,
            rdp_color_depth: None,
            rdp_redirect_audio: None,
            rdp_redirect_printers: None,
            rdp_redirect_drives: None,
            ssh_tunnels: None,
            credential_profile_id: None,
            override_credentials: None,
            jump_host_id: None,
            ssh_key_id: None,
            use_ssh_agent: None,
            tags: None,
            notes: None,
            use_ftps: None,
            rdp_nla: None,
            docker_transport: None,
            docker_socket_path: None,
            docker_tls_ca_path: None,
            docker_tls_cert_path: None,
            docker_tls_key_path: None,
            proxmox_api_token_id: None,
            proxmox_api_token_secret_encrypted: None,
        }
    }

    pub fn vnc_des_test(password: &str, challenge: &[u8; 16]) -> Vec<u8> {
        crate::vnc_client::vnc_des_encrypt_pub(password, challenge).to_vec()
    }
}

use crate::database::{CreateConnectionRequest, UpdateConnectionRequest};
use crate::state::AppState;
use dashmap::DashMap;
use std::sync::{Arc, RwLock};
use tauri::Emitter;

// ── Internal helpers ──────────────────────────────────────

#[inline]
pub(crate) fn db_err(context: &str, e: impl std::fmt::Display) -> crate::error::AppError {
    crate::error::AppError::Database(format!("{}: {}", context, e))
}
#[inline]
pub(crate) fn vault_err(context: &str, e: impl std::fmt::Display) -> crate::error::AppError {
    crate::error::AppError::Vault(format!("{}: {}", context, e))
}
#[inline]
pub(crate) fn net_err(context: &str, e: impl std::fmt::Display) -> crate::error::AppError {
    crate::error::AppError::Network(format!("{}: {}", context, e))
}
#[inline]
pub(crate) fn lock_err(e: impl std::fmt::Display) -> crate::error::AppError {
    crate::error::AppError::Internal(format!("Lock poisoned: {}", e))
}

/// Returns the current Unix timestamp in whole seconds.
pub(crate) fn current_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Stamps the idle-lock watchdog.
pub(crate) fn touch_activity(state: &AppState) {
    state
        .last_activity_ts
        .store(current_unix_secs(), std::sync::atomic::Ordering::Relaxed);
}

/// Encrypt any `*_plaintext` fields in a `CreateConnectionRequest` using the
/// vault master key, placing the ciphertext into the corresponding
/// `*_encrypted` field.
pub(crate) fn encrypt_connection_create_fields(
    state: &tauri::State<AppState>,
    request: &mut CreateConnectionRequest,
) -> Result<(), crate::error::AppError> {
    let key_guard = state.encryption_key.read().map_err(lock_err)?;
    let key = key_guard.as_ref().ok_or("Vault locked")?;
    if let Some(pt) = request.password_plaintext.take() {
        if !pt.is_empty() {
            request.password_encrypted = Some(encryption::encrypt_v2(&pt, key)?);
        }
    }
    if let Some(pt) = request.private_key_plaintext.take() {
        if !pt.is_empty() {
            request.private_key_encrypted = Some(encryption::encrypt_v2(&pt, key)?);
        }
    }
    Ok(())
}

/// Same as above for `UpdateConnectionRequest`.
pub(crate) fn encrypt_connection_update_fields(
    state: &tauri::State<AppState>,
    request: &mut UpdateConnectionRequest,
) -> Result<(), crate::error::AppError> {
    let key_guard = state.encryption_key.read().map_err(lock_err)?;
    let key = key_guard.as_ref().ok_or("Vault locked")?;
    if let Some(pt) = request.password_plaintext.take() {
        if !pt.is_empty() {
            request.password_encrypted = Some(encryption::encrypt_v2(&pt, key)?);
        }
    }
    if let Some(pt) = request.private_key_plaintext.take() {
        if !pt.is_empty() {
            request.private_key_encrypted = Some(encryption::encrypt_v2(&pt, key)?);
        }
    }
    Ok(())
}

// ── App Entry Point ──────────────────────────────────────

/// Show a fatal error dialog (native cross-platform) and exit the process.
fn fatal_error(msg: &str) -> ! {
    tracing::error!("FATAL: {}", msg);
    let _ = rfd::MessageDialog::new()
        .set_title("NexoRC — Fatal Error")
        .set_description(msg)
        .set_level(rfd::MessageLevel::Error)
        .show();
    std::process::exit(1);
}

/// CRIT-3 / LOW-A2: Strip PII from a Sentry event before it is sent.
/// Scrubs message, exception values, breadcrumbs, and extra context entries.
fn scrub_sentry_event(event: &mut sentry::protocol::Event<'static>) {
    let patterns: &[(&str, &str)] = &[
        (r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "<ip>"),
        (r"SHA256:[A-Za-z0-9+/=]{43,}", "<fingerprint>"),
        (r"(?i)\buser(?:name)?:\s*\S+", "user:<scrubbed>"),
        (r"(?i)\bhost(?:name)?:\s*\S+", "host:<scrubbed>"),
    ];

    let scrub = |s: &str| -> String {
        let mut out = s.to_string();
        for (pat, repl) in patterns {
            if let Ok(re) = regex::Regex::new(pat) {
                out = re.replace_all(&out, *repl).into_owned();
            }
        }
        out
    };

    // Scrub event-level message
    if let Some(ref mut msg) = event.message {
        *msg = scrub(msg);
    }

    // Scrub exception values
    for exc in &mut event.exception.values {
        if let Some(ref mut val) = exc.value {
            *val = scrub(val);
        }
    }

    // LOW-A2: Scrub breadcrumb messages — every navigational step the user took
    // can embed hostnames / IPs in its message field.
    for bc in &mut event.breadcrumbs.values {
        if let Some(ref mut msg) = bc.message {
            *msg = scrub(msg);
        }
        // Scrub breadcrumb data map (string values only)
        for val in bc.data.values_mut() {
            if let sentry::protocol::Value::String(ref mut s) = val {
                *s = scrub(s);
            }
        }
    }

    // LOW-A2: Scrub extra context (arbitrary key-value bag attached by the app)
    for val in event.extra.values_mut() {
        if let sentry::protocol::Value::String(ref mut s) = val {
            *s = scrub(s);
        }
    }

    // Drop fields that are inherently PII and have no redactable representation
    event.request = None;
    event.user = None;
    event.server_name = None;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ── CRIT-3 fix: Sentry opt-in with PII scrubbing ─────────────────────
    let sentry_enabled = std::env::var("NEXUS_SENTRY_ENABLED")
        .ok()
        .map(|v| v == "1" || v.to_lowercase() == "true")
        .unwrap_or(false);

    let _sentry_guard = if sentry_enabled {
        std::env::var("SENTRY_DSN")
            .ok()
            .filter(|dsn| !dsn.is_empty())
            .map(|dsn| {
                sentry::init((
                    dsn,
                    sentry::ClientOptions {
                        release: sentry::release_name!(),
                        before_send: Some(std::sync::Arc::new(
                            |mut event: sentry::protocol::Event<'static>| {
                                scrub_sentry_event(&mut event);
                                Some(event)
                            },
                        )),
                        ..Default::default()
                    },
                ))
            })
    } else {
        None
    };

    // ── Resolve data directory ─────────────────────────────────────────────
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("nexorc");
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        eprintln!(
            "FATAL: cannot create data dir {}: {}",
            data_dir.display(),
            e
        );
        let _ = rfd::MessageDialog::new()
            .set_title("NexoRC — Fatal Error")
            .set_description(format!(
                "Failed to create data directory:\n{}\n\nPath: {}",
                e,
                data_dir.display()
            ))
            .set_level(rfd::MessageLevel::Error)
            .show();
        std::process::exit(1);
    }

    // ── Initialize tracing ─────────────────────────────────────────────────
    //
    // HIGH-A6: replaced `tracing_appender::rolling::daily` with a custom writer
    // that (a) scrubs PII from every log line and (b) rotates at 10 MiB so no
    // single log file grows unboundedly.  Daily roll is also handled inside the
    // writer by checking the wall-clock ordinal day on each write.
    let log_dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    let scrub_writer = log_writer::ScrubRotateWriter::new(&log_dir).unwrap_or_else(|e| {
        fatal_error(&format!(
            "Cannot open log file in {}:\n{}",
            log_dir.display(),
            e
        ))
    });
    // non_blocking moves scrub_writer into a background I/O thread so that
    // logging calls on the tokio runtime never block on disk writes.
    // _log_guard must stay alive for the process lifetime — drop it and the
    // background thread flushes & exits, losing any buffered lines.
    let (non_blocking_file, _log_guard) = tracing_appender::non_blocking(scrub_writer);

    let default_level = if cfg!(debug_assertions) {
        tracing::Level::DEBUG
    } else {
        tracing::Level::INFO
    };

    use tracing_subscriber::prelude::*;
    let env_filter =
        tracing_subscriber::EnvFilter::from_default_env().add_directive(default_level.into());

    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(non_blocking_file)
        .with_ansi(false)
        .with_target(false)
        .with_thread_ids(true);
    let stdout_layer = tracing_subscriber::fmt::layer()
        .with_target(false)
        .with_thread_ids(true);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer)
        .with(stdout_layer)
        .init();

    tracing::info!("Starting NexoRC backend...");
    tracing::info!("Data dir: {}", data_dir.display());
    tracing::info!("Log dir : {}", log_dir.display());

    let db_path = data_dir.join("connections.db");
    let config_path = data_dir.join("config.json");

    let db_path_str = db_path
        .to_str()
        .unwrap_or_else(|| fatal_error("The database path contains non-UTF-8 characters."));

    let pool = database::initialize_database(db_path_str).unwrap_or_else(|e| {
        fatal_error(&format!(
            "Failed to initialize database:\n{}\n\nFile: {}",
            e, db_path_str
        ))
    });

    let (
        salt,
        verification_token,
        kdf_iterations_loaded,
        auto_lock_secs_loaded,
        allow_multiple_instances,
    ) = if config_path.exists() {
        let config_str = std::fs::read_to_string(&config_path).unwrap_or_default();
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&config_str) {
            let salt = config["salt"].as_str().and_then(|s| {
                base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s).ok()
            });
            let token = config["verification_token"].as_str().map(|s| s.to_string());
            let iters = config["kdf"]["iterations"]
                .as_u64()
                .map(|n| n as u32)
                .unwrap_or_else(|| {
                    if salt.is_some() {
                        100_000
                    } else {
                        encryption::DEFAULT_KDF_ITERATIONS
                    }
                });
            // MED-A1: restore persisted auto-lock timeout (default 15 min = 900 s)
            let auto_lock = config["auto_lock_secs"].as_u64().unwrap_or(900);
            // MED-A11: allow user to opt out of single-instance enforcement
            let multi = config["allow_multiple_instances"]
                .as_bool()
                .unwrap_or(false);
            (salt, token, iters, auto_lock, multi)
        } else {
            (
                None,
                None,
                encryption::DEFAULT_KDF_ITERATIONS,
                900u64,
                false,
            )
        }
    } else {
        (
            None,
            None,
            encryption::DEFAULT_KDF_ITERATIONS,
            900u64,
            false,
        )
    };

    tracing::info!(
        "KDF: PBKDF2-HMAC-SHA256 × {} iterations",
        kdf_iterations_loaded
    );

    let config_path_str = config_path
        .to_str()
        .unwrap_or_else(|| fatal_error("The config-file path contains non-UTF-8 characters."))
        .to_string();
    let data_dir_str = data_dir
        .to_str()
        .unwrap_or_else(|| fatal_error("The data-directory path contains non-UTF-8 characters."))
        .to_string();

    let app_state = AppState {
        db: pool,
        encryption_key: RwLock::new(None),
        salt: RwLock::new(salt),
        verification_token: RwLock::new(verification_token),
        config_path: config_path_str,
        data_dir: data_dir_str,
        kdf_iterations: RwLock::new(kdf_iterations_loaded),
        last_activity_ts: Arc::new(std::sync::atomic::AtomicU64::new(current_unix_secs())),
        auto_lock_secs: RwLock::new(auto_lock_secs_loaded),
        unlock_fail_count: Arc::new(std::sync::atomic::AtomicU32::new(0)),
        unlock_lockout_until: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        // M-5: restore persisted consecutive-lockout count so a restart cannot
        // bypass the escalating backoff.
        unlock_lockout_count: Arc::new(std::sync::atomic::AtomicU32::new(
            commands::vault::load_lockout_count(data_dir.to_str().unwrap_or(".")),
        )),
        rdp_processes: DashMap::new(),
        rdp_sessions: DashMap::new(),
        ssh_sessions: DashMap::new(),
        shell_sessions: DashMap::new(),
        docker_exec_sessions: DashMap::new(),
        network_scan_cancel: DashMap::new(),
        sftp_pool: DashMap::new(),
        recording_sessions: DashMap::new(),
        vnc_sessions: DashMap::new(),
        // HIGH-A5: 100 req/s per command name
        command_limiter: {
            use governor::{Quota, RateLimiter};
            use std::num::NonZeroU32;
            Arc::new(RateLimiter::dashmap(Quota::per_second(
                NonZeroU32::new(100).unwrap(),
            )))
        },
        // HIGH-A7: serializes concurrent change_master_password calls
        rekey_lock: std::sync::Mutex::new(()),
        // MED-A2: serializes concurrent unlock_vault calls
        unlock_mutex: std::sync::Mutex::new(()),
    };

    // MED-A11: single-instance enforcement is opt-out — users who need to run
    // separate NexoRC windows (e.g. two monitors, separate vaults) can set
    // allow_multiple_instances=true in config.json or via the Settings UI.
    // The change takes effect on the NEXT launch.
    let mut builder = tauri::Builder::default();
    if !allow_multiple_instances {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(|app| {
            // CRIT-A5: DevTools only available in debug builds, gated behind an
            // explicit env-var so an accidental demo never leaks credentials via
            // the network / storage inspector.
            #[cfg(debug_assertions)]
            if std::env::var("NEXORC_OPEN_DEVTOOLS")
                .map(|v| v == "1")
                .unwrap_or(false)
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            // 30-3: auto-lock idle watcher + MED-A3: SFTP pool sweep
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                use std::sync::atomic::Ordering;
                use tauri::Manager;
                // MED-A3: evict stale SFTP sessions every 10 watcher iterations
                // (10 × 30 s = 5 min sweep cadence).
                let mut sftp_sweep_counter: u8 = 0;
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(30));
                    let state = handle.state::<AppState>();

                    // MED-A3: SFTP background eviction (independent of auto-lock state)
                    sftp_sweep_counter += 1;
                    if sftp_sweep_counter >= 10 {
                        sftp_sweep_counter = 0;
                        sftp_ftp::pool_evict_stale(&state.sftp_pool);
                        tracing::debug!(
                            "SFTP pool sweep complete ({} entries remaining)",
                            state.sftp_pool.len()
                        );
                    }

                    let timeout_secs = match state.auto_lock_secs.read() {
                        Ok(g) => *g,
                        Err(e) => *e.into_inner(),
                    };
                    if timeout_secs == 0 {
                        continue;
                    }

                    let is_unlocked = match state.encryption_key.read() {
                        Ok(g) => g.is_some(),
                        Err(e) => e.into_inner().is_some(),
                    };
                    if !is_unlocked {
                        continue;
                    }

                    let last_ts = state.last_activity_ts.load(Ordering::Relaxed);
                    if current_unix_secs().saturating_sub(last_ts) < timeout_secs {
                        continue;
                    }

                    {
                        use zeroize::Zeroize;
                        let mut key_guard = state
                            .encryption_key
                            .write()
                            .unwrap_or_else(|e| e.into_inner());
                        if let Some(ref mut key) = *key_guard {
                            key.zeroize();
                        }
                        *key_guard = None;
                    }
                    state.ssh_sessions.clear();
                    state.shell_sessions.clear();
                    state.docker_exec_sessions.clear();
                    state.sftp_pool.clear(); // MED-A3: drop cached sessions on auto-lock

                    // HIGH-A3: kill + wait each RDP child to prevent zombie processes.
                    // Drain the map so ownership moves to the cleanup threads.
                    let pids: Vec<String> = state
                        .rdp_processes
                        .iter()
                        .map(|e| e.key().clone())
                        .collect();
                    for k in pids {
                        if let Some((_, mut child)) = state.rdp_processes.remove(&k) {
                            // Spawn a thread so kill+wait never blocks the watcher loop.
                            std::thread::spawn(move || {
                                let _ = child.kill();
                                // wait() reaps the zombie; on Windows it's near-instant
                                // after TerminateProcess, on Unix it waits for SIGKILL.
                                let _ = child.wait();
                            });
                        }
                    }
                    state.rdp_sessions.clear();

                    let _ = handle.emit("vault:auto-locked", ());
                    tracing::info!("Vault auto-locked after {}s of inactivity", timeout_secs);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Vault
            commands::vault::is_vault_unlocked,
            commands::vault::is_first_run,
            commands::vault::get_allow_multiple_instances,
            commands::vault::set_allow_multiple_instances,
            commands::vault::set_master_password,
            commands::vault::change_master_password,
            commands::vault::unlock_vault,
            commands::vault::lock_vault,
            commands::vault::set_auto_lock_timeout,
            // Connections
            commands::connections::create_connection,
            commands::connections::update_connection,
            commands::connections::delete_connection,
            commands::connections::get_connections,
            commands::connections::get_connections_summary,
            commands::connections::check_for_update,
            // Groups
            commands::groups::create_group,
            commands::groups::update_group,
            commands::groups::delete_group,
            commands::groups::get_groups,
            // Credential Profiles
            commands::credentials::create_credential_profile,
            commands::credentials::get_credential_profiles,
            commands::credentials::update_credential_profile,
            commands::credentials::delete_credential_profile,
            // CRIT-A4: resolve_credentials removed from IPC — now internal-only
            // Export / Import
            commands::export_import::export_connections,
            commands::export_import::import_connections,
            commands::export_import::vault_export_file,
            commands::export_import::vault_import_file,
            // SSH
            commands::ssh_cmds::ssh_connect,
            commands::ssh_cmds::ssh_send_input,
            commands::ssh_cmds::ssh_resize,
            commands::ssh_cmds::ssh_disconnect,
            // SSH host-key TOFU (NXS-001)
            commands::known_hosts::ssh_probe_host_key,
            commands::known_hosts::ssh_trust_host_key,
            commands::known_hosts::ssh_forget_host_key,
            // SSH Key Manager (90-1)
            commands::ssh_keys::ssh_key_list,
            commands::ssh_keys::ssh_key_create,
            commands::ssh_keys::ssh_key_delete,
            commands::ssh_keys::ssh_key_generate,
            // Session Recording (90-3, LOW-9)
            commands::recording::ssh_recording_start,
            commands::recording::ssh_recording_stop,
            commands::recording::ssh_recording_list,
            commands::recording::ssh_recording_read,
            // Local Shell
            commands::local_shell::shell_spawn,
            commands::local_shell::shell_send_input,
            commands::local_shell::shell_disconnect,
            commands::local_shell::shell_resize,
            // RDP
            commands::rdp_cmds::rdp_check_available,
            commands::rdp_cmds::rdp_connect,
            commands::rdp_cmds::rdp_disconnect,
            commands::rdp_cmds::rdp_embed_window,
            commands::rdp_cmds::rdp_is_window_alive,
            commands::rdp_cmds::rdp_set_visibility,
            commands::rdp_cmds::rdp_focus,
            commands::rdp_cmds::rdp_send_command,
            commands::rdp_cmds::rdp_resize_embedded,
            // VNC (external binary legacy)
            vnc::vnc_check_availability,
            vnc::vnc_connect,
            // VNC (90-11: native RFB 3.8 client)
            vnc_client::vnc_native_connect,
            vnc_client::vnc_native_disconnect,
            vnc_client::vnc_native_key_event,
            // Tools (whitelisted predefined tools only — NXS-002)
            tools::run_predefined_tool,
            // Network
            network::scan_network,
            network::cancel_network_scan,
            network::ping_server,
            // SFTP & FTP
            sftp_ftp::sftp_list_dir,
            sftp_ftp::sftp_upload,
            sftp_ftp::sftp_download,
            sftp_ftp::sftp_delete,
            sftp_ftp::sftp_rename,
            sftp_ftp::sftp_mkdir,
            sftp_ftp::sftp_disconnect, // MED-A3
            sftp_ftp::ftp_list_dir,
            sftp_ftp::ftp_upload,
            sftp_ftp::ftp_download,
            sftp_ftp::ftp_delete,
            sftp_ftp::ftp_rename,
            sftp_ftp::ftp_mkdir,
            // Saved Commands
            commands::saved_commands::create_saved_command,
            commands::saved_commands::get_saved_commands,
            commands::saved_commands::update_saved_command,
            commands::saved_commands::delete_saved_command,
            // Proxmox
            proxmox::proxmox_auth,
            proxmox::proxmox_get_resources,
            proxmox::proxmox_vm_action,
            proxmox::proxmox_open_console,
            proxmox::proxmox_auth_token,
            proxmox::proxmox_get_fingerprint,
            proxmox::proxmox_list_pinned_certs,
            proxmox::proxmox_forget_cert,
            // Docker
            docker::docker_get_containers,
            docker::docker_container_action,
            docker::docker_get_logs,
            docker::docker_exec_start,
            docker::docker_exec_input,
            docker::docker_exec_resize,
            docker::docker_exec_stop,
            // 90-7: Favorites & recently used
            commands::misc::toggle_favorite,
            commands::misc::update_last_connected,
            // 90-9: Drag & drop group assignment
            commands::misc::update_connection_group,
            // 90-10: Audit log
            commands::misc::audit_log_list,
            // CRIT-A3: hash-chain verification
            commands::misc::audit_log_verify,
            // Import (PuTTY / .rdp / mRemoteNG / SSH config)
            import::import_pick_file,
            import::import_rdp_file,
            import::import_putty_sessions,
            import::import_mremoteng,
            import::import_ssh_config,
            import::import_rdm,
            import::import_royalts,
            import::bulk_import_connections,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| fatal_error(&format!("Error running the Tauri application:\n{}", e)));
}
