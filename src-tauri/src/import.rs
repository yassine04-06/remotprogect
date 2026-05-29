//! Import connections from PuTTY registry, .rdp files, and mRemoteNG confCons.xml.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::database::models::CreateConnectionRequest;
use crate::state::AppState;

// ── Shared types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedConnection {
    pub name: String,
    pub host: String,
    pub port: i32,
    /// "SSH" | "RDP" | "VNC" | "SFTP" | "FTP"
    pub protocol: String,
    pub username: String,
    /// Plaintext password — encrypted on bulk_import_connections.
    pub password: Option<String>,
    pub domain: Option<String>,
    /// Slash-delimited group hierarchy, e.g. "Servers/Production".
    pub group_path: Option<String>,
    // RDP-specific
    pub rdp_width: Option<i32>,
    pub rdp_height: Option<i32>,
    pub rdp_color_depth: Option<i32>,
    pub rdp_redirect_drives: bool,
    pub rdp_redirect_printers: bool,
    pub rdp_redirect_audio: bool,
    // SSH-specific
    pub ssh_key_path: Option<String>,
    // Import metadata
    /// "putty" | "rdp_file" | "mremoteng"
    pub source: String,
    /// Non-fatal issue encountered during parsing.
    pub warning: Option<String>,
}

impl Default for ImportedConnection {
    fn default() -> Self {
        Self {
            name: String::new(),
            host: String::new(),
            port: 22,
            protocol: "SSH".to_string(),
            username: String::new(),
            password: None,
            domain: None,
            group_path: None,
            rdp_width: None,
            rdp_height: None,
            rdp_color_depth: None,
            rdp_redirect_drives: false,
            rdp_redirect_printers: false,
            rdp_redirect_audio: false,
            ssh_key_path: None,
            source: String::new(),
            warning: None,
        }
    }
}

// ── SSH ~/.ssh/config parser ──────────────────────────────────────────────────
//
// Supports the subset of directives that map to ImportedConnection:
//   Host, HostName, Port, User, IdentityFile.
// Wildcard host patterns (containing * or ?) are silently skipped.

fn expand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix('~') {
        if let Some(home) = dirs::home_dir() {
            let rest = rest.trim_start_matches('/').trim_start_matches('\\');
            return home.join(rest).to_string_lossy().into_owned();
        }
    }
    path.to_string()
}

fn build_ssh_config_entry(alias: &str, block: &[(String, String)]) -> Option<ImportedConnection> {
    // Skip wildcards — they are global defaults, not actual servers.
    if alias.contains('*') || alias.contains('?') {
        return None;
    }

    let mut hostname = alias.to_string();
    let mut port: i32 = 22;
    let mut username = String::new();
    let mut identity_file: Option<String> = None;

    for (key, value) in block {
        match key.as_str() {
            "hostname" => hostname = value.clone(),
            "port" => port = value.parse().unwrap_or(22),
            "user" => username = value.clone(),
            "identityfile" => identity_file = Some(expand_tilde(value)),
            _ => {}
        }
    }

    if hostname.is_empty() {
        return None;
    }

    let warning = identity_file.as_ref().map(|p| {
        format!(
            "Key file noted ({}). Import the key in SSH Key Manager to use it.",
            p
        )
    });

    Some(ImportedConnection {
        name: alias.to_string(),
        host: hostname,
        port,
        protocol: "SSH".to_string(),
        username,
        ssh_key_path: identity_file,
        source: "ssh_config".to_string(),
        warning,
        ..Default::default()
    })
}

fn parse_ssh_config_content(content: &str) -> Vec<ImportedConnection> {
    let mut result = Vec::new();
    let mut current_host: Option<String> = None;
    let mut current_block: Vec<(String, String)> = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        // Skip blank lines and comments
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Split on first whitespace or '='
        let sep_idx = line.find(|c: char| c.is_whitespace() || c == '=');
        let (key, rest) = if let Some(idx) = sep_idx {
            (
                &line[..idx],
                line[idx..].trim_start_matches(|c: char| c.is_whitespace() || c == '='),
            )
        } else {
            (line, "")
        };

        if key.eq_ignore_ascii_case("Host") {
            // Flush the previous block
            if let Some(ref h) = current_host.take() {
                if let Some(conn) = build_ssh_config_entry(h, &current_block) {
                    result.push(conn);
                }
            }
            current_host = Some(rest.to_string());
            current_block.clear();
        } else if current_host.is_some() {
            current_block.push((key.to_lowercase(), rest.to_string()));
        }
    }

    // Flush last block
    if let Some(ref h) = current_host {
        if let Some(conn) = build_ssh_config_entry(h, &current_block) {
            result.push(conn);
        }
    }

    result
}

// ── RDP file parser ───────────────────────────────────────────────────────────
//
// Format: one directive per line — "key:type:value"
// Types: :s: = string, :i: = integer, :b: = binary (ignored)

fn parse_rdp_content(content: &str, default_name: &str) -> ImportedConnection {
    let mut conn = ImportedConnection {
        name: default_name.to_string(),
        port: 3389,
        protocol: "RDP".to_string(),
        source: "rdp_file".to_string(),
        ..Default::default()
    };

    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Split on FIRST colon → key, rest.
        let first = match line.find(':') {
            Some(i) => i,
            None => continue,
        };
        let key = line[..first].trim().to_lowercase();
        let rest = &line[first + 1..];

        // Split rest on FIRST colon → type_char, value.
        let second = match rest.find(':') {
            Some(i) => i,
            None => continue,
        };
        let type_char = rest[..second].trim();
        let value = rest[second + 1..].trim();

        match key.as_str() {
            "full address" if type_char == "s" => {
                // "host" or "host:port"
                if let Some(colon) = value.rfind(':') {
                    if let Ok(p) = value[colon + 1..].parse::<i32>() {
                        conn.host = value[..colon].to_string();
                        conn.port = p;
                    } else {
                        conn.host = value.to_string();
                    }
                } else {
                    conn.host = value.to_string();
                }
                // Only fall back to host as name when no custom name was provided
                // (i.e. the caller passed the host itself as the default, or name is empty).
                if conn.name.is_empty() || conn.name == conn.host {
                    conn.name = conn.host.clone();
                }
            }
            "server port" if type_char == "i" => {
                conn.port = value.parse().unwrap_or(3389);
            }
            "username" if type_char == "s" => {
                conn.username = value.to_string();
            }
            "domain" if type_char == "s" && !value.is_empty() => {
                conn.domain = Some(value.to_string());
            }
            "desktopwidth" if type_char == "i" => {
                conn.rdp_width = value.parse().ok();
            }
            "desktopheight" if type_char == "i" => {
                conn.rdp_height = value.parse().ok();
            }
            "session bpp" if type_char == "i" => {
                conn.rdp_color_depth = value.parse().ok();
            }
            "redirectdrives" if type_char == "i" => {
                conn.rdp_redirect_drives = value == "1";
            }
            "redirectprinters" if type_char == "i" => {
                conn.rdp_redirect_printers = value == "1";
            }
            "audiomode" if type_char == "i" => {
                // 0 = play locally (= redirect audio to client)
                conn.rdp_redirect_audio = value == "0";
            }
            _ => {}
        }
    }

    conn
}

/// Opens a native file-picker dialog on the Rust side and returns the chosen path.
#[tauri::command]
pub async fn import_pick_file(filter_name: String, extensions: Vec<String>) -> Option<String> {
    let ext_refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    rfd::FileDialog::new()
        .add_filter(&filter_name, &ext_refs)
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn import_rdp_file(path: String) -> Result<Vec<ImportedConnection>, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("Cannot read file: {}", e))?;

    let default_name = std::path::Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("RDP Connection");

    let conn = parse_rdp_content(&content, default_name);
    if conn.host.is_empty() {
        return Err("No 'full address' directive found in the .rdp file".to_string());
    }
    Ok(vec![conn])
}

// ── PuTTY registry (Windows only) ────────────────────────────────────────────

#[tauri::command]
pub async fn import_putty_sessions() -> Result<Vec<ImportedConnection>, String> {
    #[cfg(target_os = "windows")]
    {
        scan_putty_registry()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(Vec::new())
    }
}

/// Percent-decode a PuTTY session name (registry key names are %-encoded).
#[allow(dead_code)] // used by Windows-only scan_putty_registry; keep for tests
fn putty_url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &s[i + 1..i + 3];
            if let Ok(b) = u8::from_str_radix(hex, 16) {
                out.push(b as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

#[cfg(target_os = "windows")]
fn scan_putty_registry() -> Result<Vec<ImportedConnection>, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let sessions_key = match hkcu.open_subkey(r"Software\SimonTatham\PuTTY\Sessions") {
        Ok(k) => k,
        Err(_) => return Ok(Vec::new()), // PuTTY not installed — return empty list silently
    };

    let mut connections = Vec::new();

    for name_res in sessions_key.enum_keys() {
        let encoded = match name_res {
            Ok(n) => n,
            Err(_) => continue,
        };
        let session_key = match sessions_key.open_subkey(&encoded) {
            Ok(k) => k,
            Err(_) => continue,
        };

        // Only import SSH sessions (skip Telnet, Serial, Raw, Rlogin)
        let protocol: String = session_key
            .get_value("Protocol")
            .unwrap_or_else(|_| "ssh".to_string());
        if !protocol.eq_ignore_ascii_case("ssh") {
            continue;
        }

        let host: String = session_key.get_value("HostName").unwrap_or_default();
        if host.is_empty() {
            continue;
        }

        let port: u32 = session_key.get_value("PortNumber").unwrap_or(22u32);
        let username: String = session_key.get_value("UserName").unwrap_or_default();
        let key_file: String = session_key.get_value("PublicKeyFile").unwrap_or_default();

        let display_name = putty_url_decode(&encoded);
        // Skip the built-in "Default Settings" placeholder
        if display_name.eq_ignore_ascii_case("Default Settings") {
            continue;
        }

        connections.push(ImportedConnection {
            name: display_name,
            host,
            port: port as i32,
            protocol: "SSH".to_string(),
            username,
            ssh_key_path: if key_file.is_empty() {
                None
            } else {
                Some(key_file)
            },
            source: "putty".to_string(),
            ..Default::default()
        });
    }

    Ok(connections)
}

// ── mRemoteNG XML + AES-GCM decryption ───────────────────────────────────────
//
// Encrypted password format (BlockCipherMode = GCM):
//   base64( salt[16] ‖ nonce[12] ‖ ciphertext[N] ‖ tag[16] )
//
// Key derivation: PBKDF2-HMAC-SHA1(masterPassword, salt, KdfIterations, 32 bytes)
//
// Default master password: "mR3m"

fn mremoteng_derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; 32] {
    use pbkdf2::pbkdf2_hmac;
    use sha1::Sha1;

    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha1>(password.as_bytes(), salt, iterations, &mut key);
    key
}

fn mremoteng_decrypt(b64: &str, password: &str, iterations: u32) -> Result<String, &'static str> {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};
    use base64::Engine as _;

    let data = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|_| "base64 decode failed")?;

    const SALT_LEN: usize = 16;
    const NONCE_LEN: usize = 12; // standard AES-GCM nonce size
    const TAG_LEN: usize = 16;

    if data.len() < SALT_LEN + NONCE_LEN + TAG_LEN {
        return Err("ciphertext too short");
    }

    let salt = &data[..SALT_LEN];
    let nonce_bytes = &data[SALT_LEN..SALT_LEN + NONCE_LEN];
    let ct_with_tag = &data[SALT_LEN + NONCE_LEN..]; // ciphertext || tag

    let key_bytes = mremoteng_derive_key(password, salt, iterations);
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = aes_gcm::Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ct_with_tag)
        .map_err(|_| "AES-GCM decrypt failed — wrong master password?")?;

    String::from_utf8(plaintext).map_err(|_| "decrypted value is not valid UTF-8")
}

/// Extract a named XML attribute value from a `BytesStart` element.
fn xml_attr(e: &quick_xml::events::BytesStart<'_>, name: &str) -> Option<String> {
    e.attributes()
        .filter_map(|r| r.ok())
        .find(|a| {
            std::str::from_utf8(a.key.local_name().as_ref())
                .map(|k| k == name)
                .unwrap_or(false)
        })
        .and_then(|a| a.unescape_value().ok())
        .map(|v| v.into_owned())
}

/// Build an `ImportedConnection` from a `<Node Type="Connection">` element.
fn mremoteng_node_to_conn(
    e: &quick_xml::events::BytesStart<'_>,
    container_stack: &[String],
    password: &str,
    kdf_iterations: u32,
) -> Option<ImportedConnection> {
    let name = xml_attr(e, "Name").unwrap_or_default();
    let host = xml_attr(e, "Hostname").unwrap_or_default();
    if host.is_empty() {
        return None;
    }

    let protocol_raw = xml_attr(e, "Protocol").unwrap_or_else(|| "RDP".to_string());
    let (protocol, default_port): (&str, i32) = match protocol_raw.to_uppercase().as_str() {
        "SSH2" | "SSH1" => ("SSH", 22),
        "RDP" => ("RDP", 3389),
        "VNC" => ("VNC", 5900),
        "SFTP" => ("SFTP", 22),
        "FTP" => ("FTP", 21),
        _ => return None, // Skip Telnet, Raw, HTTP, HTTPS, etc.
    };

    let port: i32 = xml_attr(e, "Port")
        .and_then(|p| p.parse().ok())
        .unwrap_or(default_port);

    let username = xml_attr(e, "Username").unwrap_or_default();
    let domain = xml_attr(e, "Domain").filter(|s| !s.is_empty());

    // Decrypt password
    let enc_pw = xml_attr(e, "Password").unwrap_or_default();
    let (password_opt, warning) = if enc_pw.is_empty() {
        (None, None)
    } else {
        match mremoteng_decrypt(&enc_pw, password, kdf_iterations) {
            Ok(pt) if pt.is_empty() => (None, None),
            Ok(pt) => (Some(pt), None),
            Err(e) => (None, Some(format!("Password not decrypted: {}", e))),
        }
    };

    // Group path from container hierarchy
    let group_path = if container_stack.is_empty() {
        None
    } else {
        Some(container_stack.join("/"))
    };

    // RDP-specific
    let rdp_redirect_drives = xml_attr(e, "RedirectDiskDrives")
        .map(|v| v == "true")
        .unwrap_or(false);
    let rdp_redirect_printers = xml_attr(e, "RedirectPrinters")
        .map(|v| v == "true")
        .unwrap_or(false);
    let rdp_redirect_audio = xml_attr(e, "RedirectSound")
        .map(|v| v == "PlayLocally")
        .unwrap_or(false);

    let (rdp_width, rdp_height) = if protocol == "RDP" {
        match xml_attr(e, "Resolution").as_deref() {
            Some(r) => {
                let parts: Vec<&str> = r.splitn(2, 'x').collect();
                if parts.len() == 2 {
                    (parts[0].parse().ok(), parts[1].parse().ok())
                } else {
                    (None, None)
                }
            }
            None => (None, None),
        }
    } else {
        (None, None)
    };

    Some(ImportedConnection {
        name,
        host,
        port,
        protocol: protocol.to_string(),
        username,
        password: password_opt,
        domain,
        group_path,
        rdp_width,
        rdp_height,
        rdp_color_depth: None,
        rdp_redirect_drives,
        rdp_redirect_printers,
        rdp_redirect_audio,
        ssh_key_path: None,
        source: "mremoteng".to_string(),
        warning,
    })
}

fn parse_mremoteng_xml(content: &str, password: &str) -> Result<Vec<ImportedConnection>, String> {
    use quick_xml::{events::Event, Reader};

    let mut reader = Reader::from_str(content);
    let mut buf = Vec::new();

    let mut connections: Vec<ImportedConnection> = Vec::new();
    let mut kdf_iterations: u32 = 1000;
    // Stack of folder names for the group_path
    let mut container_stack: Vec<String> = Vec::new();
    // Parallel stack: true = this level is a Container, false = Connection (non-self-closing)
    let mut node_type_stack: Vec<bool> = Vec::new();

    loop {
        buf.clear();
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let qname = e.name();
                let local = qname.local_name();
                let tag = std::str::from_utf8(local.as_ref()).unwrap_or("");

                match tag {
                    "Connections" => {
                        // Read KDF iterations from root element
                        if let Some(iter_str) = xml_attr(e, "KdfIterations") {
                            kdf_iterations = iter_str.parse().unwrap_or(1000);
                        }
                    }
                    "Node" => {
                        let node_type = xml_attr(e, "Type").unwrap_or_default();
                        if node_type == "Container" {
                            let folder_name = xml_attr(e, "Name").unwrap_or_default();
                            container_stack.push(folder_name);
                            node_type_stack.push(true);
                        } else {
                            node_type_stack.push(false);
                            if let Some(conn) = mremoteng_node_to_conn(
                                e,
                                &container_stack,
                                password,
                                kdf_iterations,
                            ) {
                                connections.push(conn);
                            }
                        }
                    }
                    _ => {}
                }
            }

            Ok(Event::Empty(ref e)) => {
                let qname = e.name();
                let local = qname.local_name();
                let tag = std::str::from_utf8(local.as_ref()).unwrap_or("");
                if tag == "Node" && xml_attr(e, "Type").as_deref() == Some("Connection") {
                    if let Some(conn) =
                        mremoteng_node_to_conn(e, &container_stack, password, kdf_iterations)
                    {
                        connections.push(conn);
                    }
                }
                // Empty Container (no children) → nothing to push
            }

            Ok(Event::End(ref e)) => {
                let qname = e.name();
                let local = qname.local_name();
                let tag = std::str::from_utf8(local.as_ref()).unwrap_or("");
                if tag == "Node" {
                    if let Some(was_container) = node_type_stack.pop() {
                        if was_container {
                            container_stack.pop();
                        }
                    }
                }
            }

            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
    }

    Ok(connections)
}

#[tauri::command]
pub async fn import_mremoteng(
    path: String,
    password: Option<String>,
) -> Result<Vec<ImportedConnection>, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("Cannot read file: {}", e))?;

    let pw = password.as_deref().unwrap_or("mR3m");
    parse_mremoteng_xml(&content, pw)
}

/// Import connections from an OpenSSH `~/.ssh/config` (or a custom path).
/// Pass `None` to use the default `~/.ssh/config`.
#[tauri::command]
pub async fn import_ssh_config(path: Option<String>) -> Result<Vec<ImportedConnection>, String> {
    let file_path = if let Some(p) = path {
        std::path::PathBuf::from(p)
    } else {
        dirs::home_dir()
            .ok_or_else(|| "Cannot locate home directory".to_string())?
            .join(".ssh")
            .join("config")
    };

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Cannot read {:?}: {}", file_path, e))?;

    let list = parse_ssh_config_content(&content);
    if list.is_empty() {
        return Err("No host entries found in the SSH config file.".to_string());
    }
    Ok(list)
}

// ── Remote Desktop Manager (RDM) XML ─────────────────────────────────────────
//
// Supported format: Devolutions RDM "XML Data Source" export (.rdm).
// Structure: <ArrayOfConnection><Connection>...</Connection></ArrayOfConnection>
// ConnectionType values: RdpVersion*, SSHShell, SSH2Shell, VNC, SFTP, FTP.
// Group path: <Group>Folder\SubFolder</Group> — backslash-separated.

fn rdm_type_to_protocol(conn_type: &str) -> Option<(&'static str, i32)> {
    let ct = conn_type.to_ascii_lowercase();
    if ct.contains("rdp") {
        Some(("RDP", 3389))
    } else if ct.contains("ssh") {
        Some(("SSH", 22))
    } else if ct == "vnc" {
        Some(("VNC", 5900))
    } else if ct == "sftp" {
        Some(("SFTP", 22))
    } else if ct == "ftp" {
        Some(("FTP", 21))
    } else {
        None
    }
}

fn parse_rdm_xml(content: &str) -> Result<Vec<ImportedConnection>, String> {
    use quick_xml::{events::Event, Reader};
    use std::collections::HashMap;

    let mut reader = Reader::from_str(content);
    let mut buf = Vec::new();
    let mut result = Vec::new();

    let mut in_conn = false;
    let mut fields: HashMap<String, String> = HashMap::new();
    let mut current_field: Option<String> = None;

    loop {
        buf.clear();
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let qname = e.name();
                let local = qname.local_name();
                let tag = std::str::from_utf8(local.as_ref())
                    .unwrap_or("")
                    .to_string();
                if tag == "Connection" && !in_conn {
                    in_conn = true;
                    fields.clear();
                    current_field = None;
                } else if in_conn {
                    current_field = Some(tag);
                }
            }
            Ok(Event::Text(ref e)) if in_conn => {
                if let (Some(ref field), Ok(text)) = (&current_field, e.unescape()) {
                    let trimmed = text.trim().to_string();
                    if !trimmed.is_empty() {
                        fields.insert(field.clone(), trimmed);
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let qname = e.name();
                let local = qname.local_name();
                let tag = std::str::from_utf8(local.as_ref()).unwrap_or("");
                if tag == "Connection" && in_conn {
                    let conn_type = fields
                        .get("ConnectionType")
                        .map(String::as_str)
                        .unwrap_or("");
                    if let Some((proto, def_port)) = rdm_type_to_protocol(conn_type) {
                        let host = fields
                            .get("Host")
                            .or_else(|| fields.get("HostName"))
                            .cloned()
                            .unwrap_or_default();
                        if !host.is_empty() {
                            let name = fields.get("Name").cloned().unwrap_or_else(|| host.clone());
                            let port = fields
                                .get("Port")
                                .and_then(|p| p.parse().ok())
                                .unwrap_or(def_port);
                            let username = fields
                                .get("UserName")
                                .or_else(|| fields.get("Username"))
                                .cloned()
                                .unwrap_or_default();
                            let domain = fields.get("Domain").filter(|s| !s.is_empty()).cloned();
                            let password =
                                fields.get("Password").filter(|s| !s.is_empty()).cloned();
                            // Group: RDM uses backslash hierarchy
                            let group_path = fields
                                .get("Group")
                                .filter(|s| !s.is_empty())
                                .map(|g| g.replace('\\', "/"));
                            let rdp_width = if proto == "RDP" {
                                fields.get("ScreenWidth").and_then(|v| v.parse().ok())
                            } else {
                                None
                            };
                            let rdp_height = if proto == "RDP" {
                                fields.get("ScreenHeight").and_then(|v| v.parse().ok())
                            } else {
                                None
                            };
                            let rdp_color_depth = if proto == "RDP" {
                                fields.get("ColorDepth").and_then(|v| v.parse().ok())
                            } else {
                                None
                            };
                            let rdp_redirect_drives = fields
                                .get("RedirectDiskDrive")
                                .map(|v| v == "true")
                                .unwrap_or(false);
                            let rdp_redirect_printers = fields
                                .get("RedirectPrinter")
                                .map(|v| v == "true")
                                .unwrap_or(false);
                            let rdp_redirect_audio = fields
                                .get("AudioRedirectionMode")
                                .map(|v| v.to_ascii_lowercase().contains("redirect"))
                                .unwrap_or(false);
                            result.push(ImportedConnection {
                                name,
                                host,
                                port,
                                protocol: proto.to_string(),
                                username,
                                password,
                                domain,
                                group_path,
                                rdp_width,
                                rdp_height,
                                rdp_color_depth,
                                rdp_redirect_drives,
                                rdp_redirect_printers,
                                rdp_redirect_audio,
                                ssh_key_path: None,
                                source: "rdm".to_string(),
                                warning: None,
                            });
                        }
                    }
                    in_conn = false;
                    fields.clear();
                    current_field = None;
                } else if in_conn {
                    current_field = None;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn import_rdm(path: String) -> Result<Vec<ImportedConnection>, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("Cannot read file: {}", e))?;
    let list = parse_rdm_xml(&content)?;
    if list.is_empty() {
        Err("No importable connections found (RDP, SSH, VNC, SFTP, FTP only).".to_string())
    } else {
        Ok(list)
    }
}

// ── RoyalTS XML (.rtsx / .rtsz) ──────────────────────────────────────────────
//
// .rtsx = plain UTF-8 XML export.
// .rtsz = ZIP archive containing a single .rtsx file (RoyalTS v5+ native format).
//
// XML structure:
//   <RoyalDocument>
//     <Objects>
//       <RoyalFolder><Name>…</Name><Objects>
//         <Royal*Connection><Name>…</Name><URI>…</URI>…</Royal*Connection>
//       </Objects></RoyalFolder>
//     </Objects>
//   </RoyalDocument>
//
// Recognised connection elements:
//   RoyalRDSConnection (RDP 3389), RoyalSSHConnection (SSH 22),
//   RoyalVNCConnection (VNC 5900), RoyalSFTPConnection (SFTP 22),
//   RoyalFTPConnection (FTP 21).

const ROYALTS_CONN_TYPES: &[(&str, &str, i32)] = &[
    ("RoyalRDSConnection", "RDP", 3389),
    ("RoyalSSHConnection", "SSH", 22),
    ("RoyalVNCConnection", "VNC", 5900),
    ("RoyalSFTPConnection", "SFTP", 22),
    ("RoyalFTPConnection", "FTP", 21),
];

fn parse_royalts_xml(content: &str) -> Result<Vec<ImportedConnection>, String> {
    use quick_xml::{events::Event, Reader};
    use std::collections::HashMap;

    let mut reader = Reader::from_str(content);
    let mut buf = Vec::new();
    let mut result = Vec::new();

    // Track full element-name path so we can distinguish <RoyalFolder>/<Name>
    // from <Royal*Connection>/<Name>.
    let mut tag_stack: Vec<String> = Vec::new();
    // Depth counter (incremented on Start, decremented on End).
    let mut doc_depth: usize = 0;

    // Folder hierarchy
    let mut folder_names: Vec<String> = Vec::new(); // one entry per open RoyalFolder

    // Connection state
    let mut in_conn: Option<(String, &'static str, i32)> = None; // (tag, protocol, default_port)
    let mut conn_depth: usize = 0; // doc_depth when the connection element was opened
    let mut fields: HashMap<String, String> = HashMap::new();
    let mut current_field: Option<String> = None;

    loop {
        buf.clear();
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let qname = e.name();
                let local = qname.local_name();
                let tag = std::str::from_utf8(local.as_ref())
                    .unwrap_or("")
                    .to_string();
                doc_depth += 1;
                tag_stack.push(tag.clone());

                if in_conn.is_none() {
                    if tag == "RoyalFolder" {
                        folder_names.push(String::new()); // name filled when <Name> text arrives
                    } else if let Some(&(_, proto, port)) = ROYALTS_CONN_TYPES
                        .iter()
                        .find(|&&(ct, _, _)| ct == tag.as_str())
                    {
                        in_conn = Some((tag, proto, port));
                        conn_depth = doc_depth;
                        fields.clear();
                        current_field = None;
                    }
                } else {
                    // Inside a connection — track the current child element name.
                    current_field = Some(tag);
                }
            }
            Ok(Event::Text(ref e)) => {
                let text = match e.unescape() {
                    Ok(t) => t.trim().to_string(),
                    Err(_) => continue,
                };
                if text.is_empty() {
                    continue;
                }

                if in_conn.is_some() {
                    if let Some(ref field) = current_field {
                        fields.insert(field.clone(), text);
                    }
                } else {
                    // Detect <RoyalFolder><Name>…</Name> — tag_stack ends with
                    // ["RoyalFolder", "Name"] when we're right inside the folder's Name.
                    let tlen = tag_stack.len();
                    if tlen >= 2
                        && tag_stack[tlen - 1] == "Name"
                        && tag_stack[tlen - 2] == "RoyalFolder"
                    {
                        if let Some(last) = folder_names.last_mut() {
                            *last = text;
                        }
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let qname = e.name();
                let local = qname.local_name();
                let tag = std::str::from_utf8(local.as_ref())
                    .unwrap_or("")
                    .to_string();

                if let Some((ref ct, proto, def_port)) = in_conn.clone() {
                    if tag == ct.as_str() && doc_depth == conn_depth {
                        // Emit the connection we've been accumulating.
                        let host = fields
                            .get("URI")
                            .or_else(|| fields.get("HostName"))
                            .or_else(|| fields.get("Host"))
                            .cloned()
                            .unwrap_or_default();
                        if !host.is_empty() {
                            let name = fields.get("Name").cloned().unwrap_or_else(|| host.clone());
                            let port = fields
                                .get("CustomPort")
                                .or_else(|| fields.get("Port"))
                                .and_then(|p| p.parse().ok())
                                .unwrap_or(def_port);
                            let username = fields
                                .get("Username")
                                .or_else(|| fields.get("UserName"))
                                .cloned()
                                .unwrap_or_default();
                            let domain = fields.get("Domain").filter(|s| !s.is_empty()).cloned();
                            let password =
                                fields.get("Password").filter(|s| !s.is_empty()).cloned();
                            let group_path = {
                                let non_empty: Vec<&str> = folder_names
                                    .iter()
                                    .filter(|n| !n.is_empty())
                                    .map(String::as_str)
                                    .collect();
                                if non_empty.is_empty() {
                                    None
                                } else {
                                    Some(non_empty.join("/"))
                                }
                            };
                            result.push(ImportedConnection {
                                name,
                                host,
                                port,
                                protocol: proto.to_string(),
                                username,
                                password,
                                domain,
                                group_path,
                                source: "royalts".to_string(),
                                ..Default::default()
                            });
                        }
                        in_conn = None;
                        fields.clear();
                        current_field = None;
                    } else {
                        // Closing a child element of the connection.
                        current_field = None;
                    }
                } else if tag == "RoyalFolder" {
                    folder_names.pop();
                }

                tag_stack.pop();
                doc_depth -= 1;
            }
            Ok(Event::Empty(_)) => {
                // Self-closing tags carry no text — no depth change needed.
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn import_royalts(path: String) -> Result<Vec<ImportedConnection>, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read file: {}", e))?;

    // .rtsz files are ZIP archives; .rtsx files are plain XML.
    let content: String = if bytes.starts_with(b"PK\x03\x04") {
        use std::io::Read as _;
        let cursor = std::io::Cursor::new(&bytes);
        let mut archive =
            zip::ZipArchive::new(cursor).map_err(|e| format!("ZIP open error: {}", e))?;
        let mut xml_content = String::new();
        let mut found = false;
        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("ZIP entry error: {}", e))?;
            let name = file.name().to_lowercase();
            if name.ends_with(".rtsx") || name.ends_with(".xml") {
                file.read_to_string(&mut xml_content)
                    .map_err(|e| format!("ZIP extract error: {}", e))?;
                found = true;
                break;
            }
        }
        if !found {
            return Err("No .rtsx XML file found inside the .rtsz archive.".to_string());
        }
        xml_content
    } else {
        String::from_utf8(bytes).map_err(|e| format!("File is not valid UTF-8: {}", e))?
    };

    let list = parse_royalts_xml(&content)?;
    if list.is_empty() {
        Err("No importable connections found (RDP, SSH, VNC, SFTP, FTP only).".to_string())
    } else {
        Ok(list)
    }
}

// ── Bulk import ───────────────────────────────────────────────────────────────

/// Resolve or create a slash-delimited group hierarchy, returning the leaf group id.
fn find_or_create_group_path(db: &rusqlite::Connection, path: &str) -> Result<String, String> {
    let segments: Vec<&str> = path
        .split('/')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let mut parent_id: Option<String> = None;

    for segment in &segments {
        let existing: Option<String> = if parent_id.is_none() {
            db.query_row(
                "SELECT id FROM groups WHERE name = ?1 AND parent_id IS NULL LIMIT 1",
                rusqlite::params![*segment],
                |row| row.get(0),
            )
            .ok()
        } else {
            db.query_row(
                "SELECT id FROM groups WHERE name = ?1 AND parent_id = ?2 LIMIT 1",
                rusqlite::params![*segment, parent_id.as_deref()],
                |row| row.get(0),
            )
            .ok()
        };

        parent_id = Some(if let Some(id) = existing {
            id
        } else {
            let group = crate::database::groups::create_group(db, segment, parent_id.as_deref())?;
            group.id
        });
    }

    parent_id.ok_or_else(|| "Empty group path".to_string())
}

#[tauri::command]
pub async fn bulk_import_connections(
    state: State<'_, AppState>,
    connections: Vec<ImportedConnection>,
) -> Result<usize, String> {
    let db = state
        .db
        .get()
        .map_err(|e| format!("DB pool error: {}", e))?;

    let mut count = 0usize;

    for import in &connections {
        // Resolve or create group hierarchy
        let group_id = if let Some(path) = &import.group_path {
            if !path.is_empty() {
                Some(find_or_create_group_path(&db, path)?)
            } else {
                None
            }
        } else {
            None
        };

        // Encrypt password with vault key
        let password_encrypted = if let Some(pt) = &import.password {
            if pt.is_empty() {
                None
            } else {
                let key_guard = state.encryption_key.read().map_err(|_| "Lock poisoned")?;
                let key = key_guard.as_ref().ok_or("Vault is locked")?;
                Some(
                    crate::encryption::encrypt_v2(pt, key)
                        .map_err(|e| format!("Encryption error: {}", e))?,
                )
            }
        } else {
            None
        };

        let request = CreateConnectionRequest {
            name: import.name.clone(),
            host: import.host.clone(),
            port: import.port,
            protocol: import.protocol.clone(),
            username: import.username.clone(),
            password_plaintext: None,
            password_encrypted,
            private_key_plaintext: None,
            private_key_encrypted: None,
            group_id,
            use_private_key: import.ssh_key_path.is_some(),
            rdp_width: import.rdp_width,
            rdp_height: import.rdp_height,
            rdp_fullscreen: None,
            domain: import.domain.clone(),
            rdp_color_depth: import.rdp_color_depth,
            rdp_redirect_audio: Some(import.rdp_redirect_audio),
            rdp_redirect_printers: Some(import.rdp_redirect_printers),
            rdp_redirect_drives: Some(import.rdp_redirect_drives),
            ssh_tunnels: None,
            credential_profile_id: None,
            override_credentials: None,
            jump_host_id: None,
            ssh_key_id: None,
            use_ssh_agent: Some(false),
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
        };

        crate::database::connections::create_connection(&db, request)
            .map_err(|e| format!("Failed to create '{}': {}", import.name, e))?;

        count += 1;
    }

    Ok(count)
}

// ── NexoRC vault JSON → ImportedConnection ───────────────────────────────────
//
// Reads an exported NexoRC vault JSON file and converts each ServerConnection
// into an ImportedConnection for selective merge-import via the ImportDialog.
// Passwords are NOT transferred — the user must re-enter credentials after import.

#[tauri::command]
pub async fn import_nexorc_json(path: String) -> Result<Vec<ImportedConnection>, String> {
    use crate::database::models::{ExportData, Group};
    use std::collections::HashMap;

    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read file: {}", e))?;
    let export: ExportData =
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid NexoRC JSON: {}", e))?;

    // Build group_id → name map for resolving a human-readable group path.
    let group_map: HashMap<String, Group> = export
        .groups
        .iter()
        .map(|g| (g.id.clone(), g.clone()))
        .collect();

    // Walk group ancestors to build "Parent/Child" path.
    let resolve_group_path = |gid: &str| -> Option<String> {
        let mut parts = Vec::new();
        let mut current_id = gid.to_string();
        for _ in 0..10 {
            // guard against cycles
            if let Some(g) = group_map.get(&current_id) {
                parts.push(g.name.clone());
                match &g.parent_id {
                    Some(pid) => current_id = pid.clone(),
                    None => break,
                }
            } else {
                break;
            }
        }
        if parts.is_empty() {
            None
        } else {
            parts.reverse();
            Some(parts.join("/"))
        }
    };

    let list = export
        .connections
        .into_iter()
        .map(|c| {
            let group_path = c.group_id.as_deref().and_then(resolve_group_path);
            ImportedConnection {
                name: c.name,
                host: c.host,
                port: c.port,
                protocol: c.protocol,
                username: c.username,
                password: None, // never transfer encrypted blobs — user re-enters
                domain: if c.domain.is_empty() {
                    None
                } else {
                    Some(c.domain)
                },
                group_path,
                rdp_width: Some(c.rdp_width).filter(|&w| w > 0),
                rdp_height: Some(c.rdp_height).filter(|&h| h > 0),
                rdp_color_depth: Some(c.rdp_color_depth).filter(|&d| d > 0),
                rdp_redirect_drives: c.rdp_redirect_drives,
                rdp_redirect_printers: c.rdp_redirect_printers,
                rdp_redirect_audio: c.rdp_redirect_audio,
                ssh_key_path: None,
                source: "nexorc".to_string(),
                warning: Some(
                    "Passwords not transferred — re-enter credentials after import.".to_string(),
                ),
            }
        })
        .collect();

    Ok(list)
}

// ── M-1: Parser unit tests ────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    // ── RDP parser ────────────────────────────────────────────────────────────

    #[test]
    fn rdp_basic_fields() {
        let content = "full address:s:192.168.1.100\nusername:s:admin\nserver port:i:3389\n";
        let c = parse_rdp_content(content, "test.rdp");
        assert_eq!(c.host, "192.168.1.100");
        assert_eq!(c.username, "admin");
        assert_eq!(c.port, 3389);
        assert_eq!(c.protocol, "RDP");
        assert_eq!(c.source, "rdp_file");
    }

    #[test]
    fn rdp_domain_extracted() {
        let content = "full address:s:10.0.0.1\ndomain:s:CORP\n";
        let c = parse_rdp_content(content, "test.rdp");
        assert_eq!(c.domain.as_deref(), Some("CORP"));
    }

    #[test]
    fn rdp_empty_domain_not_set() {
        let content = "full address:s:10.0.0.1\ndomain:s:\n";
        let c = parse_rdp_content(content, "test.rdp");
        assert!(c.domain.is_none(), "empty domain string must not be set");
    }

    #[test]
    fn rdp_redirect_flags() {
        let content = "redirectdrives:i:1\nredirectprinters:i:1\naudiomode:i:0\n";
        let c = parse_rdp_content(content, "test.rdp");
        assert!(c.rdp_redirect_drives);
        assert!(c.rdp_redirect_printers);
        assert!(c.rdp_redirect_audio);
    }

    #[test]
    fn rdp_redirect_flags_off() {
        let content = "redirectdrives:i:0\nredirectprinters:i:0\naudiomode:i:2\n";
        let c = parse_rdp_content(content, "test.rdp");
        assert!(!c.rdp_redirect_drives);
        assert!(!c.rdp_redirect_printers);
        assert!(!c.rdp_redirect_audio, "audiomode != 0 means no local audio");
    }

    #[test]
    fn rdp_resolution_parsed() {
        let content = "desktopwidth:i:1920\ndesktopheight:i:1080\nsession bpp:i:32\n";
        let c = parse_rdp_content(content, "test.rdp");
        assert_eq!(c.rdp_width, Some(1920));
        assert_eq!(c.rdp_height, Some(1080));
        assert_eq!(c.rdp_color_depth, Some(32));
    }

    #[test]
    fn rdp_default_name_replaced_by_host() {
        let content = "full address:s:myhost.example.com\n";
        let c = parse_rdp_content(content, "myhost.example.com");
        // When the default name equals the host the parser sets name = host
        assert_eq!(c.name, "myhost.example.com");
    }

    #[test]
    fn rdp_non_default_name_kept() {
        let content = "full address:s:10.0.0.1\n";
        let c = parse_rdp_content(content, "My Server");
        assert_eq!(c.name, "My Server");
    }

    // ── SSH config parser ─────────────────────────────────────────────────────

    #[test]
    fn ssh_config_basic_host() {
        let cfg = "Host myserver\n    HostName 10.0.0.1\n    User admin\n    Port 2222\n";
        let list = parse_ssh_config_content(cfg);
        assert_eq!(list.len(), 1);
        let h = &list[0];
        assert_eq!(h.name, "myserver");
        assert_eq!(h.host, "10.0.0.1");
        assert_eq!(h.username, "admin");
        assert_eq!(h.port, 2222);
        assert_eq!(h.protocol, "SSH");
        assert_eq!(h.source, "ssh_config");
    }

    #[test]
    fn ssh_config_no_hostname_uses_alias() {
        let cfg = "Host myserver\n    User admin\n";
        let list = parse_ssh_config_content(cfg);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].host, "myserver", "no HostName → alias used as host");
    }

    #[test]
    fn ssh_config_wildcard_skipped() {
        let cfg = "Host *\n    ServerAliveInterval 60\nHost prod\n    HostName 10.0.0.1\n";
        let list = parse_ssh_config_content(cfg);
        assert_eq!(list.len(), 1, "wildcard Host block must be skipped");
        assert_eq!(list[0].name, "prod");
    }

    #[test]
    fn ssh_config_multiple_hosts() {
        let cfg = "Host web\n    HostName web.example.com\n\nHost db\n    HostName db.example.com\n    Port 5432\n";
        let list = parse_ssh_config_content(cfg);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "web");
        assert_eq!(list[1].name, "db");
        assert_eq!(list[1].port, 5432);
    }

    #[test]
    fn ssh_config_identity_file_generates_warning() {
        let cfg = "Host srv\n    HostName 10.0.0.1\n    IdentityFile ~/.ssh/id_ed25519\n";
        let list = parse_ssh_config_content(cfg);
        assert_eq!(list.len(), 1);
        let h = &list[0];
        assert!(
            h.ssh_key_path.is_some(),
            "IdentityFile must populate ssh_key_path"
        );
        assert!(
            h.warning.is_some(),
            "IdentityFile should produce a warning about manual key import"
        );
    }

    #[test]
    fn ssh_config_comments_and_blanks_ignored() {
        let cfg =
            "\n# This is a comment\n\nHost srv\n    # another comment\n    HostName 10.0.0.2\n";
        let list = parse_ssh_config_content(cfg);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].host, "10.0.0.2");
    }

    #[test]
    fn ssh_config_default_port_22() {
        let cfg = "Host srv\n    HostName 10.0.0.1\n";
        let list = parse_ssh_config_content(cfg);
        assert_eq!(list[0].port, 22);
    }

    // ── RDM XML parser ────────────────────────────────────────────────────────

    #[test]
    fn rdm_basic_rdp() {
        let xml = r#"<?xml version="1.0"?>
<ArrayOfConnection>
  <Connection>
    <Name>Test Server</Name>
    <ConnectionType>RdpVersion6</ConnectionType>
    <Host>192.168.1.100</Host>
    <Port>3389</Port>
    <UserName>admin</UserName>
    <Domain>CORP</Domain>
    <Group>Production\Web</Group>
    <ScreenWidth>1920</ScreenWidth>
    <ScreenHeight>1080</ScreenHeight>
    <ColorDepth>32</ColorDepth>
  </Connection>
</ArrayOfConnection>"#;
        let list = parse_rdm_xml(xml).unwrap();
        assert_eq!(list.len(), 1);
        let c = &list[0];
        assert_eq!(c.name, "Test Server");
        assert_eq!(c.host, "192.168.1.100");
        assert_eq!(c.port, 3389);
        assert_eq!(c.protocol, "RDP");
        assert_eq!(c.username, "admin");
        assert_eq!(c.domain.as_deref(), Some("CORP"));
        assert_eq!(
            c.group_path.as_deref(),
            Some("Production/Web"),
            "backslash must become forward-slash"
        );
        assert_eq!(c.rdp_width, Some(1920));
        assert_eq!(c.rdp_height, Some(1080));
        assert_eq!(c.rdp_color_depth, Some(32));
        assert_eq!(c.source, "rdm");
    }

    #[test]
    fn rdm_ssh_connection() {
        let xml = r#"<ArrayOfConnection>
  <Connection>
    <Name>Linux Box</Name>
    <ConnectionType>SSHShell</ConnectionType>
    <Host>10.0.0.1</Host>
    <Port>22</Port>
    <UserName>root</UserName>
  </Connection>
</ArrayOfConnection>"#;
        let list = parse_rdm_xml(xml).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].protocol, "SSH");
        assert_eq!(list[0].host, "10.0.0.1");
        assert_eq!(list[0].username, "root");
    }

    #[test]
    fn rdm_unsupported_type_skipped() {
        let xml = r#"<ArrayOfConnection>
  <Connection>
    <Name>Web</Name>
    <ConnectionType>HTTP</ConnectionType>
    <Host>example.com</Host>
  </Connection>
  <Connection>
    <Name>SSH Box</Name>
    <ConnectionType>SSH2Shell</ConnectionType>
    <Host>10.0.0.2</Host>
  </Connection>
</ArrayOfConnection>"#;
        let list = parse_rdm_xml(xml).unwrap();
        assert_eq!(list.len(), 1, "HTTP connection must be skipped");
        assert_eq!(list[0].protocol, "SSH");
    }

    #[test]
    fn rdm_group_backslash_converted_to_slash() {
        let xml = r#"<ArrayOfConnection>
  <Connection>
    <Name>S</Name>
    <ConnectionType>RdpVersion6</ConnectionType>
    <Host>1.2.3.4</Host>
    <Group>A\B\C</Group>
  </Connection>
</ArrayOfConnection>"#;
        let list = parse_rdm_xml(xml).unwrap();
        assert_eq!(list[0].group_path.as_deref(), Some("A/B/C"));
    }

    #[test]
    fn rdm_missing_host_skipped() {
        let xml = r#"<ArrayOfConnection>
  <Connection>
    <Name>No Host</Name>
    <ConnectionType>RdpVersion6</ConnectionType>
  </Connection>
</ArrayOfConnection>"#;
        let list = parse_rdm_xml(xml).unwrap();
        assert!(list.is_empty(), "connection without host must be skipped");
    }

    // ── RoyalTS XML parser ────────────────────────────────────────────────────

    #[test]
    fn royalts_basic_ssh() {
        let xml = r#"<?xml version="1.0"?>
<RoyalDocument>
  <Objects>
    <RoyalSSHConnection>
      <Name>Linux Server</Name>
      <URI>10.0.0.1</URI>
      <CustomPort>22</CustomPort>
      <Username>root</Username>
    </RoyalSSHConnection>
  </Objects>
</RoyalDocument>"#;
        let list = parse_royalts_xml(xml).unwrap();
        assert_eq!(list.len(), 1);
        let c = &list[0];
        assert_eq!(c.name, "Linux Server");
        assert_eq!(c.host, "10.0.0.1");
        assert_eq!(c.port, 22);
        assert_eq!(c.protocol, "SSH");
        assert_eq!(c.username, "root");
        assert_eq!(c.source, "royalts");
    }

    #[test]
    fn royalts_folder_hierarchy() {
        let xml = r#"<RoyalDocument><Objects>
  <RoyalFolder>
    <Name>Production</Name>
    <Objects>
      <RoyalFolder>
        <Name>Web</Name>
        <Objects>
          <RoyalRDSConnection>
            <Name>Web01</Name>
            <URI>192.168.1.100</URI>
          </RoyalRDSConnection>
        </Objects>
      </RoyalFolder>
    </Objects>
  </RoyalFolder>
</Objects></RoyalDocument>"#;
        let list = parse_royalts_xml(xml).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].group_path.as_deref(), Some("Production/Web"));
        assert_eq!(list[0].protocol, "RDP");
        assert_eq!(list[0].port, 3389);
    }

    #[test]
    fn royalts_multiple_protocols() {
        let xml = r#"<RoyalDocument><Objects>
  <RoyalRDSConnection><Name>Win</Name><URI>10.0.0.1</URI></RoyalRDSConnection>
  <RoyalSSHConnection><Name>Lin</Name><URI>10.0.0.2</URI></RoyalSSHConnection>
  <RoyalVNCConnection><Name>VNC</Name><URI>10.0.0.3</URI></RoyalVNCConnection>
  <RoyalSFTPConnection><Name>SFTP</Name><URI>10.0.0.4</URI></RoyalSFTPConnection>
  <RoyalFTPConnection><Name>FTP</Name><URI>10.0.0.5</URI></RoyalFTPConnection>
</Objects></RoyalDocument>"#;
        let list = parse_royalts_xml(xml).unwrap();
        assert_eq!(list.len(), 5);
        let protos: Vec<&str> = list.iter().map(|c| c.protocol.as_str()).collect();
        assert!(protos.contains(&"RDP"));
        assert!(protos.contains(&"SSH"));
        assert!(protos.contains(&"VNC"));
        assert!(protos.contains(&"SFTP"));
        assert!(protos.contains(&"FTP"));
    }

    #[test]
    fn royalts_default_port_when_absent() {
        let xml = r#"<RoyalDocument><Objects>
  <RoyalFTPConnection><Name>FTP</Name><URI>ftp.example.com</URI></RoyalFTPConnection>
</Objects></RoyalDocument>"#;
        let list = parse_royalts_xml(xml).unwrap();
        assert_eq!(list[0].port, 21);
    }

    #[test]
    fn royalts_missing_uri_skipped() {
        let xml = r#"<RoyalDocument><Objects>
  <RoyalSSHConnection><Name>NoURI</Name></RoyalSSHConnection>
</Objects></RoyalDocument>"#;
        let list = parse_royalts_xml(xml).unwrap();
        assert!(list.is_empty(), "connection without URI must be skipped");
    }

    #[test]
    fn royalts_connections_after_folder_exit_have_no_group() {
        let xml = r#"<RoyalDocument><Objects>
  <RoyalFolder>
    <Name>Group1</Name>
    <Objects>
      <RoyalSSHConnection><Name>Inside</Name><URI>1.1.1.1</URI></RoyalSSHConnection>
    </Objects>
  </RoyalFolder>
  <RoyalSSHConnection><Name>Outside</Name><URI>2.2.2.2</URI></RoyalSSHConnection>
</Objects></RoyalDocument>"#;
        let list = parse_royalts_xml(xml).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].group_path.as_deref(), Some("Group1"));
        assert!(
            list[1].group_path.is_none(),
            "connection outside folder must have no group"
        );
    }

    // ── PuTTY URL-decode ──────────────────────────────────────────────────────

    #[test]
    fn putty_decode_space() {
        assert_eq!(putty_url_decode("my%20server"), "my server");
    }

    #[test]
    fn putty_decode_colon() {
        assert_eq!(putty_url_decode("host%3A22"), "host:22");
    }

    #[test]
    fn putty_decode_plain() {
        assert_eq!(putty_url_decode("plain"), "plain");
    }

    #[test]
    fn putty_decode_uppercase_hex() {
        assert_eq!(putty_url_decode("%41%42%43"), "ABC");
    }
}
