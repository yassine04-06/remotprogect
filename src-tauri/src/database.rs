use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;



const CURRENT_SCHEMA_VERSION: i32 = 6;

// ── Data Models ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CredentialType {
    SSH,
    RDP,
    FTP,
    Generic,
}

impl std::fmt::Display for CredentialType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CredentialType::SSH => write!(f, "ssh"),
            CredentialType::RDP => write!(f, "rdp"),
            CredentialType::FTP => write!(f, "ftp"),
            CredentialType::Generic => write!(f, "generic"),
        }
    }
}

impl std::str::FromStr for CredentialType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "ssh" => Ok(CredentialType::SSH),
            "rdp" => Ok(CredentialType::RDP),
            "ftp" => Ok(CredentialType::FTP),
            "generic" => Ok(CredentialType::Generic),
            _ => Ok(CredentialType::Generic),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialProfile {
    pub id: String,
    pub name: String,
    pub r#type: String, // Maps to CredentialType visually
    pub description: Option<String>,
    pub username: Option<String>,
    pub password_encrypted: Option<String>,
    pub private_key_encrypted: Option<String>,
    pub domain: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCredentialProfileRequest {
    pub name: String,
    pub r#type: String,
    pub description: Option<String>,
    pub username: Option<String>,
    pub password_encrypted: Option<String>,
    pub private_key_encrypted: Option<String>,
    pub domain: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCredentialProfileRequest {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub description: Option<String>,
    pub username: Option<String>,
    pub password_encrypted: Option<String>,
    pub private_key_encrypted: Option<String>,
    pub domain: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnel {
    pub id: String,
    pub r#type: String, // "Local", "Remote", "Dynamic"
    #[serde(rename = "localPort")]
    pub local_port: i32,
    #[serde(rename = "destinationHost")]
    pub destination_host: Option<String>,
    #[serde(rename = "destinationPort")]
    pub destination_port: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub protocol: String,
    pub username: String,
    pub password_encrypted: Option<String>,
    pub private_key_encrypted: Option<String>,
    pub group_id: Option<String>,
    pub use_private_key: bool,
    pub rdp_width: i32,
    pub rdp_height: i32,
    pub rdp_fullscreen: bool,
    pub domain: String,
    pub rdp_color_depth: i32,
    pub rdp_redirect_audio: bool,
    pub rdp_redirect_printers: bool,
    pub rdp_redirect_drives: bool,
    pub ssh_tunnels: Option<Vec<SshTunnel>>,
    pub credential_profile_id: Option<String>,
    pub override_credentials: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateConnectionRequest {
    pub name: String,
    pub host: String,
    pub port: i32,
    pub protocol: String,
    pub username: String,
    pub password_encrypted: Option<String>,
    pub private_key_encrypted: Option<String>,
    pub group_id: Option<String>,
    pub use_private_key: bool,
    pub rdp_width: Option<i32>,
    pub rdp_height: Option<i32>,
    pub rdp_fullscreen: Option<bool>,
    pub domain: Option<String>,
    pub rdp_color_depth: Option<i32>,
    pub rdp_redirect_audio: Option<bool>,
    pub rdp_redirect_printers: Option<bool>,
    pub rdp_redirect_drives: Option<bool>,
    pub ssh_tunnels: Option<Vec<SshTunnel>>,
    pub credential_profile_id: Option<String>,
    pub override_credentials: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateConnectionRequest {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub protocol: String,
    pub username: String,
    pub password_encrypted: Option<String>,
    pub private_key_encrypted: Option<String>,
    pub group_id: Option<String>,
    pub use_private_key: bool,
    pub rdp_width: Option<i32>,
    pub rdp_height: Option<i32>,
    pub rdp_fullscreen: Option<bool>,
    pub domain: Option<String>,
    pub rdp_color_depth: Option<i32>,
    pub rdp_redirect_audio: Option<bool>,
    pub rdp_redirect_printers: Option<bool>,
    pub rdp_redirect_drives: Option<bool>,
    pub ssh_tunnels: Option<Vec<SshTunnel>>,
    pub credential_profile_id: Option<String>,
    pub override_credentials: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportData {
    pub version: i32,
    pub connections: Vec<ServerConnection>,
    pub groups: Vec<Group>,
    pub credential_profiles: Vec<CredentialProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedCommand {
    pub id: String,
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSavedCommandRequest {
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSavedCommandRequest {
    pub id: String,
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub tags: Option<String>,
}

// ── Database Initialization ──────────────────────────────

pub fn initialize_database(db_path: &str) -> SqlResult<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    run_migrations(&conn)?;
    Ok(conn)
}

fn run_migrations(conn: &Connection) -> SqlResult<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)",
        [],
    )?;

    let current_version: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if current_version < 1 {
        migrate_v1(conn)?;
    }
    if current_version < 2 {
        migrate_v2(conn)?;
    }
    if current_version < 3 {
        migrate_v3(conn)?;
    }
    if current_version < 4 {
        migrate_v4(conn)?;
    }
    if current_version < 5 {
        migrate_v5(conn)?;
    }
    if current_version < 6 {
        migrate_v6(conn)?;
    }
    Ok(())
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

        INSERT OR REPLACE INTO schema_version (version) VALUES (2);
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
            "
        )?;
    }

    conn.execute("INSERT OR REPLACE INTO schema_version (version) VALUES (2);", [])?;
    Ok(())
}

fn migrate_v3(conn: &Connection) -> SqlResult<()> {
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

        INSERT INTO connections_new SELECT * FROM connections;
        DROP TABLE connections;
        ALTER TABLE connections_new RENAME TO connections;
        INSERT OR REPLACE INTO schema_version (version) VALUES (3);
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

        INSERT OR REPLACE INTO schema_version (version) VALUES (4);
        ",
    )?;
    Ok(())
}

fn migrate_v5(conn: &Connection) -> SqlResult<()> {
    conn.execute_batch(
        "
        ALTER TABLE connections ADD COLUMN ssh_tunnels TEXT;
        INSERT OR REPLACE INTO schema_version (version) VALUES (5);
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
        INSERT OR REPLACE INTO schema_version (version) VALUES (6);
        ",
    )?;
    Ok(())
}

// ── Connection CRUD ──────────────────────────────────────

pub fn create_connection(
    conn: &Connection,
    req: CreateConnectionRequest,
) -> Result<ServerConnection, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let res = ServerConnection {
        id: id.clone(),
        name: req.name.clone(),
        host: req.host.clone(),
        port: req.port,
        protocol: req.protocol.clone(),
        username: req.username.clone(),
        password_encrypted: req.password_encrypted.clone(),
        private_key_encrypted: req.private_key_encrypted.clone(),
        group_id: req.group_id.clone(),
        use_private_key: req.use_private_key,
        rdp_width: req.rdp_width.unwrap_or(1920),
        rdp_height: req.rdp_height.unwrap_or(1080),
        rdp_fullscreen: req.rdp_fullscreen.unwrap_or(false),
        domain: req.domain.clone().unwrap_or_default(),
        rdp_color_depth: req.rdp_color_depth.unwrap_or(24),
        rdp_redirect_audio: req.rdp_redirect_audio.unwrap_or(false),
        rdp_redirect_printers: req.rdp_redirect_printers.unwrap_or(false),
        rdp_redirect_drives: req.rdp_redirect_drives.unwrap_or(false),
        ssh_tunnels: req.ssh_tunnels.clone(),
        credential_profile_id: req.credential_profile_id.clone(),
        override_credentials: req.override_credentials.unwrap_or(true), // Default to true if not set (for manual creations)
        created_at: now.clone(),
        updated_at: now,
    };

    conn.execute(
        "INSERT INTO connections (id, name, host, port, protocol, username, password_encrypted, private_key_encrypted, group_id, use_private_key, rdp_width, rdp_height, rdp_fullscreen, domain, rdp_color_depth, rdp_redirect_audio, rdp_redirect_printers, rdp_redirect_drives, ssh_tunnels, credential_profile_id, override_credentials, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
        params![
            res.id, res.name, res.host, res.port, res.protocol, res.username,
            res.password_encrypted, res.private_key_encrypted, res.group_id,
            res.use_private_key as i32, res.rdp_width, res.rdp_height,
            res.rdp_fullscreen as i32, res.domain, res.rdp_color_depth,
            res.rdp_redirect_audio as i32, res.rdp_redirect_printers as i32,
            res.rdp_redirect_drives as i32,
            serde_json::to_string(&res.ssh_tunnels).unwrap_or_else(|_| "[]".to_string()),
            res.credential_profile_id, res.override_credentials as i32,
            res.created_at, res.updated_at,
        ],
    )
    .map_err(|e| format!("Failed to create connection: {}", e))?;

    Ok(res)
}

pub fn update_connection(conn: &Connection, req: UpdateConnectionRequest) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let tunnels_json = req.ssh_tunnels.map(|t| serde_json::to_string(&t).unwrap_or_default());

    conn.execute(
        "UPDATE connections SET name=?1, host=?2, port=?3, protocol=?4, username=?5,
         password_encrypted=?6, private_key_encrypted=?7, group_id=?8, use_private_key=?9,
         rdp_width=?10, rdp_height=?11, rdp_fullscreen=?12, domain=?13, rdp_color_depth=?14,
         rdp_redirect_audio=?15, rdp_redirect_printers=?16, rdp_redirect_drives=?17,
         ssh_tunnels=?18, credential_profile_id=?19, override_credentials=?20, updated_at=?21 WHERE id=?22",
        params![
            req.name, req.host, req.port, req.protocol, req.username,
            req.password_encrypted, req.private_key_encrypted, req.group_id,
            req.use_private_key as i32,
            req.rdp_width.unwrap_or(1920), req.rdp_height.unwrap_or(1080),
            req.rdp_fullscreen.unwrap_or(false) as i32,
            req.domain.unwrap_or_default(), req.rdp_color_depth.unwrap_or(24),
            req.rdp_redirect_audio.unwrap_or(false) as i32,
            req.rdp_redirect_printers.unwrap_or(false) as i32,
            req.rdp_redirect_drives.unwrap_or(false) as i32,
            tunnels_json, req.credential_profile_id,
            req.override_credentials.unwrap_or(true) as i32, now, req.id,
        ],
    )
    .map_err(|e| format!("Failed to update connection: {}", e))?;

    Ok(())
}

pub fn delete_connection(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM connections WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete connection: {}", e))?;
    Ok(())
}

pub fn get_connections(conn: &Connection) -> Result<Vec<ServerConnection>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, host, port, protocol, username, password_encrypted, private_key_encrypted, group_id, use_private_key, rdp_width, rdp_height, rdp_fullscreen, domain, rdp_color_depth, rdp_redirect_audio, rdp_redirect_printers, rdp_redirect_drives, ssh_tunnels, credential_profile_id, override_credentials, created_at, updated_at FROM connections ORDER BY name")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let connections = stmt
        .query_map([], |row| {
            Ok(ServerConnection {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                protocol: row.get(4)?,
                username: row.get(5)?,
                password_encrypted: row.get(6)?,
                private_key_encrypted: row.get(7)?,
                group_id: row.get(8)?,
                use_private_key: row.get::<_, i32>(9)? != 0,
                rdp_width: row.get(10)?,
                rdp_height: row.get(11)?,
                rdp_fullscreen: row.get::<_, i32>(12)? != 0,
                domain: row.get(13)?,
                rdp_color_depth: row.get(14)?,
                rdp_redirect_audio: row.get::<_, i32>(15)? != 0,
                rdp_redirect_printers: row.get::<_, i32>(16)? != 0,
                rdp_redirect_drives: row.get::<_, i32>(17)? != 0,
                ssh_tunnels: row.get::<_, Option<String>>(18)?
                    .and_then(|s| serde_json::from_str(&s).ok()),
                credential_profile_id: row.get(19)?,
                override_credentials: row.get::<_, i32>(20)? != 0,
                created_at: row.get(21)?,
                updated_at: row.get(22)?,
            })
        })
        .map_err(|e| format!("Failed to query connections: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect connections: {}", e))?;

    Ok(connections)
}

// ── Group CRUD ───────────────────────────────────────────

pub fn create_group(conn: &Connection, name: &str, parent_id: Option<&str>) -> Result<Group, String> {
    let id = Uuid::new_v4().to_string();
    let sort_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM groups WHERE parent_id IS ?1",
            params![parent_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO groups (id, name, parent_id, sort_order) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, parent_id, sort_order],
    )
    .map_err(|e| format!("Failed to create group: {}", e))?;

    Ok(Group {
        id,
        name: name.to_string(),
        parent_id: parent_id.map(|s| s.to_string()),
        sort_order,
    })
}

pub fn update_group(conn: &Connection, id: &str, name: &str) -> Result<(), String> {
    conn.execute("UPDATE groups SET name = ?1 WHERE id = ?2", params![name, id])
        .map_err(|e| format!("Failed to update group: {}", e))?;
    Ok(())
}

pub fn delete_group(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM groups WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete group: {}", e))?;
    Ok(())
}

pub fn get_groups(conn: &Connection) -> Result<Vec<Group>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, parent_id, sort_order FROM groups ORDER BY sort_order")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let groups = stmt
        .query_map([], |row| {
            Ok(Group {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                sort_order: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to query groups: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect groups: {}", e))?;

    Ok(groups)
}

// ── Export / Import ──────────────────────────────────────

pub fn export_all(conn: &Connection) -> Result<ExportData, String> {
    let connections = get_connections(conn)?;
    let groups = get_groups(conn)?;
    let credential_profiles = get_credential_profiles(conn)?;
    Ok(ExportData {
        version: CURRENT_SCHEMA_VERSION,
        connections,
        groups,
        credential_profiles,
    })
}

/// FIX: import avvolto in una transazione atomica.
/// Se qualsiasi inserimento fallisce, il database torna allo stato originale.
pub fn import_all(conn: &Connection, data: ExportData) -> Result<(), String> {
    // Avvia la transazione prima di toccare qualsiasi dato
    conn.execute("BEGIN TRANSACTION", [])
        .map_err(|e| format!("Failed to begin transaction: {}", e))?;

    // Closure che esegue tutto il lavoro — se ritorna Err, facciamo ROLLBACK
    let result = (|| -> Result<(), String> {
        conn.execute("DELETE FROM connections", [])
            .map_err(|e| format!("Failed to clear connections: {}", e))?;
        conn.execute("DELETE FROM groups", [])
            .map_err(|e| format!("Failed to clear groups: {}", e))?;

        for group in &data.groups {
            conn.execute(
                "INSERT INTO groups (id, name, parent_id, sort_order) VALUES (?1, ?2, ?3, ?4)",
                params![group.id, group.name, group.parent_id, group.sort_order],
            )
            .map_err(|e| format!("Failed to import group '{}': {}", group.name, e))?;
        }

        for cp in &data.credential_profiles {
            conn.execute(
                "INSERT INTO credential_profiles (id, name, type, description, username, password_encrypted, private_key_encrypted, domain, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                 params![
                     cp.id, cp.name, cp.r#type, cp.description, cp.username, cp.password_encrypted,
                     cp.private_key_encrypted, cp.domain, cp.created_at, cp.updated_at
                 ]
            ).map_err(|e| format!("Failed to import credential profile '{}': {}", cp.name, e))?;
        }

        for c in &data.connections {
            conn.execute(
                "INSERT INTO connections (id, name, host, port, protocol, username,
                 password_encrypted, private_key_encrypted, group_id, use_private_key,
                 rdp_width, rdp_height, rdp_fullscreen, domain, rdp_color_depth,
                 rdp_redirect_audio, rdp_redirect_printers, rdp_redirect_drives,
                 ssh_tunnels, credential_profile_id, override_credentials, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
                params![
                    c.id, c.name, c.host, c.port, c.protocol, c.username,
                    c.password_encrypted, c.private_key_encrypted, c.group_id,
                    c.use_private_key as i32, c.rdp_width, c.rdp_height,
                    c.rdp_fullscreen as i32, c.domain, c.rdp_color_depth,
                    c.rdp_redirect_audio as i32, c.rdp_redirect_printers as i32,
                    c.rdp_redirect_drives as i32,
                    serde_json::to_string(&c.ssh_tunnels).unwrap_or_else(|_| "[]".to_string()),
                    c.credential_profile_id, c.override_credentials as i32,
                    c.created_at, c.updated_at,
                ],
            )
            .map_err(|e| format!("Failed to import connection '{}': {}", c.name, e))?;
        }

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", [])
                .map_err(|e| format!("Failed to commit transaction: {}", e))?;
            Ok(())
        }
        Err(e) => {
            // Rollback garantisce che il DB resti intatto in caso di errore
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

// ── Saved Commands CRUD ────────────────────────────────────

pub fn create_saved_command(conn: &Connection, req: CreateSavedCommandRequest) -> Result<SavedCommand, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    let res = SavedCommand {
        id: id.clone(),
        name: req.name.clone(),
        command: req.command.clone(),
        description: req.description.clone(),
        tags: req.tags.clone(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    conn.execute(
        "INSERT INTO saved_commands (id, name, command, description, tags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![res.id, res.name, res.command, res.description, res.tags, res.created_at, res.updated_at],
    )
    .map_err(|e| format!("Failed to create saved command: {}", e))?;

    Ok(res)
}

pub fn get_saved_commands(conn: &Connection) -> Result<Vec<SavedCommand>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, command, description, tags, created_at, updated_at FROM saved_commands ORDER BY name")
        .map_err(|e| e.to_string())?;

    let cmds = stmt
        .query_map([], |row| {
            Ok(SavedCommand {
                id: row.get(0)?,
                name: row.get(1)?,
                command: row.get(2)?,
                description: row.get(3)?,
                tags: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(cmds)
}

pub fn update_saved_command(conn: &Connection, req: UpdateSavedCommandRequest) -> Result<SavedCommand, String> {
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE saved_commands SET name=?1, command=?2, description=?3, tags=?4, updated_at=?5 WHERE id=?6",
        params![req.name, req.command, req.description, req.tags, now, req.id],
    )
    .map_err(|e| format!("Failed to update saved command: {}", e))?;

    let mut stmt = conn
        .prepare("SELECT id, name, command, description, tags, created_at, updated_at FROM saved_commands WHERE id=?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([&req.id]).map_err(|e| e.to_string())?;

    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        Ok(SavedCommand {
            id: row.get(0).unwrap(),
            name: row.get(1).unwrap(),
            command: row.get(2).unwrap(),
            description: row.get(3).unwrap(),
            tags: row.get(4).unwrap(),
            created_at: row.get(5).unwrap(),
            updated_at: row.get(6).unwrap(),
        })
    } else {
        Err("Saved command not found after update".into())
    }
}

pub fn delete_saved_command(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM saved_commands WHERE id=?1", params![id])
        .map_err(|e| format!("Failed to delete saved command: {}", e))?;
    Ok(())
}

// ── Credential Profiles CRUD ───────────────────────────────

pub fn create_credential_profile(conn: &Connection, req: CreateCredentialProfileRequest) -> Result<CredentialProfile, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();

    let res = CredentialProfile {
        id: id.clone(),
        name: req.name.clone(),
        r#type: req.r#type.clone(),
        description: req.description.clone(),
        username: req.username.clone(),
        password_encrypted: req.password_encrypted.clone(),
        private_key_encrypted: req.private_key_encrypted.clone(),
        domain: req.domain.clone(),
        created_at: now,
        updated_at: now,
    };

    conn.execute(
        "INSERT INTO credential_profiles (id, name, type, description, username, password_encrypted, private_key_encrypted, domain, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            res.id, res.name, res.r#type, res.description, res.username,
            res.password_encrypted, res.private_key_encrypted, res.domain,
            res.created_at, res.updated_at
        ],
    )
    .map_err(|e| format!("Failed to create credential profile: {}", e))?;

    Ok(res)
}

pub fn get_credential_profiles(conn: &Connection) -> Result<Vec<CredentialProfile>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, type, description, username, password_encrypted, private_key_encrypted, domain, created_at, updated_at FROM credential_profiles ORDER BY name")
        .map_err(|e| e.to_string())?;

    let profiles = stmt
        .query_map([], |row| {
            Ok(CredentialProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                r#type: row.get(2)?,
                description: row.get(3)?,
                username: row.get(4)?,
                password_encrypted: row.get(5)?,
                private_key_encrypted: row.get(6)?,
                domain: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(profiles)
}

pub fn update_credential_profile(conn: &Connection, req: UpdateCredentialProfileRequest) -> Result<(), String> {
    let now = Utc::now().timestamp();

    conn.execute(
        "UPDATE credential_profiles SET name=?1, type=?2, description=?3, username=?4, password_encrypted=?5, private_key_encrypted=?6, domain=?7, updated_at=?8 WHERE id=?9",
        params![
            req.name, req.r#type, req.description, req.username, req.password_encrypted,
            req.private_key_encrypted, req.domain, now, req.id
        ],
    )
    .map_err(|e| format!("Failed to update credential profile: {}", e))?;
    Ok(())
}

pub fn delete_credential_profile(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM credential_profiles WHERE id=?1", params![id])
        .map_err(|e| format!("Failed to delete credential profile: {}", e))?;
    Ok(())
}
