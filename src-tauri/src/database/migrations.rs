use r2d2_sqlite;
use rusqlite::{params, Connection, Result as SqlResult};

pub const CURRENT_SCHEMA_VERSION: i32 = 13;

// ── Database Initialization ──────────────────────────────

pub fn initialize_database(
    db_path: &str,
) -> Result<r2d2::Pool<r2d2_sqlite::SqliteConnectionManager>, Box<dyn std::error::Error>> {
    use r2d2_sqlite::SqliteConnectionManager;

    // HIGH-A2: Bump pool size to 16 so a dashboard with many tabs (Docker,
    // Proxmox, SFTP) can query SQLite concurrently without stalling.
    // SQLite WAL mode allows multiple concurrent readers.
    let manager = SqliteConnectionManager::file(db_path)
        .with_init(|conn| conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;"));
    let pool = r2d2::Pool::builder().max_size(16).build(manager)?;

    // Run migrations on one connection before handing the pool to the app.
    {
        let conn = pool.get()?;

        // MED-2: Refuse to open a DB whose schema version is NEWER than what this
        // binary understands.  This protects against a user rolling back the app
        // (e.g. via the auto-updater) to a version that does not know about new
        // columns/tables — otherwise the app would silently operate on an
        // incompatible schema and corrupt data.
        let stored_version: i32 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0); // table missing on first run → version 0

        if stored_version > CURRENT_SCHEMA_VERSION {
            return Err(Box::new(std::io::Error::other(format!(
                "Database schema version {} is newer than this version of NexoRC \
                     (max supported: {}). Please upgrade the application or restore a \
                     backup created with this version.",
                stored_version, CURRENT_SCHEMA_VERSION
            ))));
        }

        run_migrations(&conn)?;
    }

    Ok(pool)
}

/// Public wrapper for integration tests (test_helpers module in lib.rs)
pub fn run_migrations_pub(conn: &Connection) -> SqlResult<()> {
    run_migrations(conn)
}

fn run_migrations(conn: &Connection) -> SqlResult<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)",
        [],
    )?;

    // Handle legacy databases that used PRAGMA user_version for schema tracking
    let pragma_version: i32 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap_or(0);
    let schema_table_empty = conn
        .query_row("SELECT COUNT(*) FROM schema_version", [], |r| {
            r.get::<_, i32>(0)
        })
        .unwrap_or(0)
        == 0;

    if pragma_version > 0 && schema_table_empty {
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?1)",
            params![pragma_version],
        )?;
        conn.execute_batch("PRAGMA user_version = 0;")?;
        tracing::info!(
            "Migrated version tracking from PRAGMA user_version={} to schema_version table",
            pragma_version
        );
    }

    // LOW-A1: Static migration table — one entry per version in order.
    // Adding a new migration: append a migrate_vN function to the slice AND
    // bump CURRENT_SCHEMA_VERSION by 1.  The compile-time assertion below
    // enforces the invariant so a mismatch is caught at build time, not at
    // runtime on a user's machine.
    const MIGRATIONS: &[fn(&Connection) -> SqlResult<()>] = &[
        migrate_v1,
        migrate_v2,
        migrate_v3,
        migrate_v4,
        migrate_v5,
        migrate_v6,
        migrate_v7,
        migrate_v8,
        migrate_v9,
        migrate_v10,
        migrate_v11,
        migrate_v12,
        migrate_v13, // CRIT-A3: add chain_hash to audit_log
    ];

    // Compile-time guard: MIGRATIONS.len() must equal CURRENT_SCHEMA_VERSION.
    // If you add migrate_vN to the slice without bumping the constant (or vice
    // versa) this assertion fires with a clear message at compile time.
    const _: () = assert!(
        MIGRATIONS.len() == CURRENT_SCHEMA_VERSION as usize,
        "MIGRATIONS slice length must equal CURRENT_SCHEMA_VERSION — \
         bump the constant when appending a new migration function",
    );

    let current: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    for (idx, &migrate_fn) in MIGRATIONS.iter().enumerate() {
        let target = (idx + 1) as i32;
        if current < target {
            apply_migration(conn, target, migrate_fn)?;
        }
    }
    tracing::debug!(
        "Database schema is up to date (v{})",
        CURRENT_SCHEMA_VERSION
    );

    Ok(())
}

/// Run a single migration inside a savepoint so it is fully atomic.
/// On success, records the new version in schema_version and releases the savepoint.
/// On failure, rolls back to the savepoint and returns the error unchanged.
fn apply_migration(
    conn: &Connection,
    version: i32,
    migrate: fn(&Connection) -> SqlResult<()>,
) -> SqlResult<()> {
    tracing::info!("Applying database migration to v{}", version);
    let sp = format!("nexus_migration_v{}", version);
    conn.execute_batch(&format!("SAVEPOINT {};", sp))?;

    let result = (|| -> SqlResult<()> {
        migrate(conn)?;
        conn.execute(
            "INSERT OR REPLACE INTO schema_version (version) VALUES (?1)",
            params![version],
        )?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch(&format!("RELEASE {};", sp))?;
            tracing::info!("Database migration to v{} complete", version);
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch(&format!("ROLLBACK TO {};", sp));
            tracing::error!(
                "Database migration to v{} failed, rolled back: {}",
                version,
                e
            );
            Err(e)
        }
    }
}

fn migrate_v1(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (parent_id) REFERENCES groups(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            protocol TEXT NOT NULL,
            username TEXT NOT NULL,
            password_encrypted TEXT,
            private_key_encrypted TEXT,
            group_id TEXT,
            use_private_key INTEGER DEFAULT 0,
            rdp_width INTEGER DEFAULT 1920,
            rdp_height INTEGER DEFAULT 1080,
            rdp_fullscreen INTEGER DEFAULT 0,
            domain TEXT DEFAULT '',
            rdp_color_depth INTEGER DEFAULT 24,
            rdp_redirect_audio INTEGER DEFAULT 0,
            rdp_redirect_printers INTEGER DEFAULT 0,
            rdp_redirect_drives INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
        );
        ",
    )?;
    Ok(())
}

fn migrate_v2(conn: &Connection) -> SqlResult<()> {
    let table_info: Vec<String> = conn
        .prepare("PRAGMA table_info(connections)")?
        .query_map([], |row| row.get(1))?
        .collect::<Result<Vec<String>, _>>()?;

    if !table_info.contains(&"domain".to_string()) {
        conn.execute_batch(
            "
            CREATE TABLE connections_new (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                protocol TEXT NOT NULL,
                username TEXT NOT NULL,
                password_encrypted TEXT,
                private_key_encrypted TEXT,
                group_id TEXT,
                use_private_key INTEGER DEFAULT 0,
                rdp_width INTEGER DEFAULT 1920,
                rdp_height INTEGER DEFAULT 1080,
                rdp_fullscreen INTEGER DEFAULT 0,
                domain TEXT DEFAULT '',
                rdp_color_depth INTEGER DEFAULT 24,
                rdp_redirect_audio INTEGER DEFAULT 0,
                rdp_redirect_printers INTEGER DEFAULT 0,
                rdp_redirect_drives INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
            );

            INSERT INTO connections_new (
                id, name, host, port, protocol, username, password_encrypted,
                private_key_encrypted, group_id, use_private_key,
                rdp_width, rdp_height, rdp_fullscreen, created_at, updated_at
            )
            SELECT
                id, name, host, port, protocol, username, password_encrypted,
                private_key_encrypted, group_id, use_private_key,
                rdp_width, rdp_height, rdp_fullscreen, created_at, updated_at
            FROM connections;

            DROP TABLE connections;
            ALTER TABLE connections_new RENAME TO connections;
            ",
        )?;
    }

    Ok(())
}

fn migrate_v3(conn: &Connection) -> SqlResult<()> {
    // Rebuilds the connections table with explicit FK constraints.
    // Uses explicit column list in INSERT SELECT to avoid SELECT * fragility.
    conn.execute_batch(
        "
        CREATE TABLE connections_new (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            protocol TEXT NOT NULL,
            username TEXT NOT NULL,
            password_encrypted TEXT,
            private_key_encrypted TEXT,
            group_id TEXT,
            use_private_key INTEGER DEFAULT 0,
            rdp_width INTEGER DEFAULT 1920,
            rdp_height INTEGER DEFAULT 1080,
            rdp_fullscreen INTEGER DEFAULT 0,
            domain TEXT DEFAULT '',
            rdp_color_depth INTEGER DEFAULT 24,
            rdp_redirect_audio INTEGER DEFAULT 0,
            rdp_redirect_printers INTEGER DEFAULT 0,
            rdp_redirect_drives INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
        );

        INSERT INTO connections_new (
            id, name, host, port, protocol, username,
            password_encrypted, private_key_encrypted, group_id, use_private_key,
            rdp_width, rdp_height, rdp_fullscreen, domain, rdp_color_depth,
            rdp_redirect_audio, rdp_redirect_printers, rdp_redirect_drives,
            created_at, updated_at
        )
        SELECT
            id, name, host, port, protocol, username,
            password_encrypted, private_key_encrypted, group_id, use_private_key,
            rdp_width, rdp_height, rdp_fullscreen,
            COALESCE(domain, ''), rdp_color_depth,
            rdp_redirect_audio, rdp_redirect_printers, rdp_redirect_drives,
            created_at, updated_at
        FROM connections;

        DROP TABLE connections;
        ALTER TABLE connections_new RENAME TO connections;
        ",
    )?;
    Ok(())
}

fn migrate_v4(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS saved_commands (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            command TEXT NOT NULL,
            description TEXT,
            tags TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        ",
    )?;
    Ok(())
}

fn migrate_v5(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "
        ALTER TABLE connections ADD COLUMN ssh_tunnels TEXT;
        ",
    )?;
    Ok(())
}

fn migrate_v6(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS credential_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            type TEXT NOT NULL,
            description TEXT,
            username TEXT,
            password_encrypted TEXT,
            private_key_encrypted TEXT,
            domain TEXT,
            created_at INTEGER,
            updated_at INTEGER
        );
        ALTER TABLE connections ADD COLUMN credential_profile_id TEXT;
        ALTER TABLE connections ADD COLUMN override_credentials INTEGER DEFAULT 1;
        ",
    )?;
    Ok(())
}

fn migrate_v7(conn: &Connection) -> SqlResult<()> {
    // 30-14: add indexes on frequently filtered columns to speed up sidebar loads
    // and group-based queries as the connection list grows.
    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_connections_group_id   ON connections(group_id);
        CREATE INDEX IF NOT EXISTS idx_connections_protocol   ON connections(protocol);
        CREATE INDEX IF NOT EXISTS idx_groups_parent_id       ON groups(parent_id);
        ",
    )?;
    Ok(())
}

fn migrate_v8(conn: &Connection) -> SqlResult<()> {
    // 30-8: add jump_host_id column to connections for SSH ProxyJump support.
    conn.execute_batch(
        "ALTER TABLE connections ADD COLUMN jump_host_id TEXT REFERENCES connections(id);",
    )?;
    Ok(())
}

fn migrate_v9(conn: &Connection) -> SqlResult<()> {
    // 90-1: SSH key vault — stores encrypted private keys and their public counterparts.
    // 90-2: per-connection SSH agent forwarding flag.
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS ssh_keys (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            key_type    TEXT NOT NULL DEFAULT 'ed25519',
            public_key  TEXT NOT NULL,
            private_key_encrypted TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            comment     TEXT,
            created_at  INTEGER NOT NULL
        );
        ALTER TABLE connections ADD COLUMN use_ssh_agent INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE connections ADD COLUMN ssh_key_id TEXT REFERENCES ssh_keys(id) ON DELETE SET NULL;
        ",
    )?;
    Ok(())
}

fn migrate_v10(conn: &Connection) -> SqlResult<()> {
    // 90-7: tags, recently used, favorites
    // 90-8: per-server notes
    // 90-10: audit log
    conn.execute_batch(
        "
        ALTER TABLE connections ADD COLUMN tags TEXT;
        ALTER TABLE connections ADD COLUMN last_connected_at INTEGER;
        ALTER TABLE connections ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE connections ADD COLUMN notes TEXT;

        CREATE TABLE IF NOT EXISTS audit_log (
            id          TEXT PRIMARY KEY,
            timestamp   INTEGER NOT NULL,
            action      TEXT NOT NULL,
            entity_type TEXT NOT NULL DEFAULT '',
            entity_id   TEXT NOT NULL DEFAULT '',
            entity_name TEXT NOT NULL DEFAULT '',
            outcome     TEXT NOT NULL DEFAULT 'ok',
            details     TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp DESC);
        ",
    )?;
    Ok(())
}

fn migrate_v11(conn: &Connection) -> SqlResult<()> {
    // 90-12: RDP NLA per-connection toggle
    // 90-13: Docker Unix socket transport
    // 90-14: FTPS flag
    // 90-15: Proxmox API token auth fields
    conn.execute_batch(
        "
        ALTER TABLE connections ADD COLUMN use_ftps INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE connections ADD COLUMN rdp_nla INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE connections ADD COLUMN docker_transport TEXT NOT NULL DEFAULT 'tcp';
        ALTER TABLE connections ADD COLUMN docker_socket_path TEXT;
        ALTER TABLE connections ADD COLUMN proxmox_api_token_id TEXT;
        ALTER TABLE connections ADD COLUMN proxmox_api_token_secret_encrypted TEXT;
        ",
    )?;
    Ok(())
}

fn migrate_v12(conn: &Connection) -> SqlResult<()> {
    // H-3: Docker mutual-TLS (https) transport — CA / client cert / client key paths
    conn.execute_batch(
        "
        ALTER TABLE connections ADD COLUMN docker_tls_ca_path TEXT;
        ALTER TABLE connections ADD COLUMN docker_tls_cert_path TEXT;
        ALTER TABLE connections ADD COLUMN docker_tls_key_path TEXT;
        ",
    )?;
    Ok(())
}

fn migrate_v13(conn: &Connection) -> SqlResult<()> {
    // CRIT-A3: add chain_hash column for tamper-evident hash-chain.
    // Existing rows get an empty string; audit_log_verify marks them "legacy".
    conn.execute_batch("ALTER TABLE audit_log ADD COLUMN chain_hash TEXT NOT NULL DEFAULT '';")?;
    Ok(())
}
