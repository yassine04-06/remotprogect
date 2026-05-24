// database_tests.rs — Integration tests for all major database CRUD operations.
//
// Run with: cargo test --test database_tests

use remote_manager_lib::database::{
    CreateCredentialProfileRequest, CreateSavedCommandRequest, CreateSshKeyRequest, SshTunnel,
    UpdateConnectionRequest, UpdateCredentialProfileRequest, UpdateSavedCommandRequest,
};
use remote_manager_lib::{database, test_helpers};

// ── Setup helper ─────────────────────────────────────────────

fn setup_db() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    test_helpers::run_migrations_test(&conn);
    conn
}

// ── Connection CRUD tests ────────────────────────────────────

#[test]
fn test_create_connection_basic() {
    let conn = setup_db();
    let req = test_helpers::make_test_connection("192.168.1.10", "SSH");
    let created = database::create_connection(&conn, req).expect("create_connection failed");

    assert!(!created.id.is_empty(), "id should not be empty");
    assert_eq!(created.host, "192.168.1.10");
    assert_eq!(created.protocol, "SSH");
    assert_eq!(created.username, "testuser");
    assert_eq!(created.port, 22);
    assert!(!created.use_private_key);
    assert!(!created.rdp_nla);
    assert!(!created.use_ftps);
    assert_eq!(created.docker_transport, "tcp");
    assert!(created.password_encrypted.is_none());
    assert!(created.group_id.is_none());
    assert!(!created.created_at.is_empty());
    assert!(!created.updated_at.is_empty());
}

#[test]
fn test_create_connection_all_protocols() {
    let conn = setup_db();
    let protocols = ["SSH", "RDP", "VNC", "SFTP", "FTP", "PROXMOX", "DOCKER"];

    for protocol in &protocols {
        let req = test_helpers::make_test_connection("host.example.com", protocol);
        let created = database::create_connection(&conn, req).expect("create failed");
        assert_eq!(&created.protocol, protocol);
    }

    let all = database::get_connections(&conn).expect("get_connections failed");
    assert_eq!(
        all.len(),
        protocols.len(),
        "all protocols should be in the DB"
    );

    let actual_protocols: Vec<&str> = all.iter().map(|c| c.protocol.as_str()).collect();
    for proto in &protocols {
        assert!(
            actual_protocols.contains(proto),
            "protocol {} not found in DB",
            proto
        );
    }
}

#[test]
fn test_update_connection() {
    let conn = setup_db();
    let req = test_helpers::make_test_connection("original-host", "SSH");
    let created = database::create_connection(&conn, req).expect("create failed");

    let update = UpdateConnectionRequest {
        id: created.id.clone(),
        name: "Updated Name".to_string(),
        host: "updated-host".to_string(),
        port: 2222,
        protocol: "SSH".to_string(),
        username: "newuser".to_string(),
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
        proxmox_api_token_id: None,
        proxmox_api_token_secret_encrypted: None,
        docker_tls_ca_path: None,
        docker_tls_cert_path: None,
        docker_tls_key_path: None,
    };

    database::update_connection(&conn, update).expect("update failed");

    let all = database::get_connections(&conn).expect("get_connections failed");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "Updated Name");
    assert_eq!(all[0].host, "updated-host");
    assert_eq!(all[0].port, 2222);
    assert_eq!(all[0].username, "newuser");
}

#[test]
fn test_delete_connection() {
    let conn = setup_db();
    let req = test_helpers::make_test_connection("host-to-delete", "SSH");
    let created = database::create_connection(&conn, req).expect("create failed");

    database::delete_connection(&conn, &created.id).expect("delete failed");

    let all = database::get_connections(&conn).expect("get_connections failed");
    assert!(
        all.is_empty(),
        "connections list should be empty after deletion"
    );
}

#[test]
fn test_get_connections_returns_all() {
    let conn = setup_db();
    for i in 0..5 {
        let req = test_helpers::make_test_connection(&format!("host-{}", i), "SSH");
        database::create_connection(&conn, req).expect("create failed");
    }

    let all = database::get_connections(&conn).expect("get_connections failed");
    assert_eq!(all.len(), 5, "should return all 5 connections");
}

#[test]
fn test_connection_group_assignment() {
    let conn = setup_db();
    let group = database::create_group(&conn, "My Group", None).expect("create group failed");

    let mut req = test_helpers::make_test_connection("grouped-host", "SSH");
    req.group_id = Some(group.id.clone());
    let created = database::create_connection(&conn, req).expect("create connection failed");

    assert_eq!(
        created.group_id.as_deref(),
        Some(group.id.as_str()),
        "connection should have the group_id set"
    );

    let all = database::get_connections(&conn).expect("get_connections failed");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].group_id.as_deref(), Some(group.id.as_str()));
}

#[test]
fn test_connection_unique_ids() {
    let conn = setup_db();
    let mut ids = std::collections::HashSet::new();

    for i in 0..10 {
        let req = test_helpers::make_test_connection(&format!("host-{}", i), "SSH");
        let created = database::create_connection(&conn, req).expect("create failed");
        // Validate UUID format (basic check: non-empty, contains hyphens)
        assert!(!created.id.is_empty());
        assert!(created.id.contains('-'), "ID should be UUID format");
        ids.insert(created.id);
    }

    assert_eq!(ids.len(), 10, "all 10 IDs must be unique");
}

#[test]
fn test_update_connection_preserves_encrypted_fields() {
    let conn = setup_db();
    let mut req = test_helpers::make_test_connection("secure-host", "SSH");
    req.password_encrypted = Some("v2:encrypted_password_blob".to_string());

    let created = database::create_connection(&conn, req).expect("create failed");
    assert_eq!(
        created.password_encrypted.as_deref(),
        Some("v2:encrypted_password_blob")
    );

    // Update only the name; keep password_encrypted the same
    let update = UpdateConnectionRequest {
        id: created.id.clone(),
        name: "Renamed Connection".to_string(),
        host: created.host.clone(),
        port: created.port,
        protocol: created.protocol.clone(),
        username: created.username.clone(),
        password_plaintext: None,
        password_encrypted: created.password_encrypted.clone(),
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
        proxmox_api_token_id: None,
        proxmox_api_token_secret_encrypted: None,
        docker_tls_ca_path: None,
        docker_tls_cert_path: None,
        docker_tls_key_path: None,
    };

    database::update_connection(&conn, update).expect("update failed");

    let all = database::get_connections(&conn).expect("get_connections failed");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "Renamed Connection");
    assert_eq!(
        all[0].password_encrypted.as_deref(),
        Some("v2:encrypted_password_blob"),
        "password_encrypted must not change when only name is updated"
    );
}

// ── Group CRUD tests ─────────────────────────────────────────

#[test]
fn test_create_group() {
    let conn = setup_db();
    let group = database::create_group(&conn, "Test Group", None).expect("create_group failed");

    assert!(!group.id.is_empty());
    assert_eq!(group.name, "Test Group");
    assert!(group.parent_id.is_none());

    let groups = database::get_groups(&conn).expect("get_groups failed");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].id, group.id);
    assert_eq!(groups[0].name, "Test Group");
}

#[test]
fn test_delete_group_nullifies_connections() {
    let conn = setup_db();
    let group =
        database::create_group(&conn, "Group To Delete", None).expect("create group failed");

    let mut req = test_helpers::make_test_connection("host-in-group", "SSH");
    req.group_id = Some(group.id.clone());
    let created = database::create_connection(&conn, req).expect("create connection failed");
    assert_eq!(created.group_id.as_deref(), Some(group.id.as_str()));

    // Delete the group; FK ON DELETE SET NULL should nullify connection's group_id
    database::delete_group(&conn, &group.id).expect("delete group failed");

    let groups = database::get_groups(&conn).expect("get_groups failed");
    assert!(groups.is_empty(), "group should be deleted");

    // Connection should still exist but with group_id = NULL
    let all = database::get_connections(&conn).expect("get_connections failed");
    assert_eq!(all.len(), 1, "connection should still exist");
    assert!(
        all[0].group_id.is_none(),
        "group_id should be null after group deletion (ON DELETE SET NULL)"
    );
}

#[test]
fn test_group_sort_order() {
    let conn = setup_db();

    // Create 3 groups — sort_order is auto-assigned sequentially
    let g1 = database::create_group(&conn, "Alpha", None).expect("create g1 failed");
    let g2 = database::create_group(&conn, "Beta", None).expect("create g2 failed");
    let g3 = database::create_group(&conn, "Gamma", None).expect("create g3 failed");

    let groups = database::get_groups(&conn).expect("get_groups failed");
    assert_eq!(groups.len(), 3);

    // The groups table is ordered by sort_order; verify g1 < g2 < g3
    let pos_g1 = groups.iter().position(|g| g.id == g1.id).unwrap();
    let pos_g2 = groups.iter().position(|g| g.id == g2.id).unwrap();
    let pos_g3 = groups.iter().position(|g| g.id == g3.id).unwrap();

    assert!(
        pos_g1 < pos_g2 && pos_g2 < pos_g3,
        "groups should be returned in ascending sort_order (g1={}, g2={}, g3={})",
        pos_g1,
        pos_g2,
        pos_g3
    );
}

// ── Credential Profile tests ──────────────────────────────────

#[test]
fn test_create_credential_profile() {
    let conn = setup_db();

    let req = CreateCredentialProfileRequest {
        name: "SSH Profile".to_string(),
        r#type: "ssh".to_string(),
        description: Some("My SSH credential".to_string()),
        username: Some("admin".to_string()),
        password_plaintext: None,
        password_encrypted: Some("v2:some_encrypted_blob".to_string()),
        private_key_plaintext: None,
        private_key_encrypted: None,
        domain: None,
    };

    let profile = database::create_credential_profile(&conn, req).expect("create failed");
    assert!(!profile.id.is_empty());
    assert_eq!(profile.name, "SSH Profile");
    assert_eq!(profile.r#type, "ssh");
    assert_eq!(profile.username.as_deref(), Some("admin"));
    assert_eq!(profile.description.as_deref(), Some("My SSH credential"));
    assert_eq!(
        profile.password_encrypted.as_deref(),
        Some("v2:some_encrypted_blob")
    );

    let profiles = database::get_credential_profiles(&conn).expect("get failed");
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].id, profile.id);
}

#[test]
fn test_update_credential_profile() {
    let conn = setup_db();

    let req = CreateCredentialProfileRequest {
        name: "Old Name".to_string(),
        r#type: "generic".to_string(),
        description: None,
        username: Some("olduser".to_string()),
        password_plaintext: None,
        password_encrypted: None,
        private_key_plaintext: None,
        private_key_encrypted: None,
        domain: None,
    };

    let profile = database::create_credential_profile(&conn, req).expect("create failed");

    let update_req = UpdateCredentialProfileRequest {
        id: profile.id.clone(),
        name: "New Name".to_string(),
        r#type: "generic".to_string(),
        description: Some("Updated desc".to_string()),
        username: Some("newuser".to_string()),
        password_plaintext: None,
        password_encrypted: None,
        private_key_plaintext: None,
        private_key_encrypted: None,
        domain: None,
    };

    database::update_credential_profile(&conn, update_req).expect("update failed");

    let profiles = database::get_credential_profiles(&conn).expect("get failed");
    assert_eq!(profiles.len(), 1);
    assert_eq!(profiles[0].name, "New Name");
    assert_eq!(profiles[0].username.as_deref(), Some("newuser"));
    assert_eq!(profiles[0].description.as_deref(), Some("Updated desc"));
}

#[test]
fn test_delete_credential_profile() {
    let conn = setup_db();

    let req = CreateCredentialProfileRequest {
        name: "To Delete".to_string(),
        r#type: "rdp".to_string(),
        description: None,
        username: None,
        password_plaintext: None,
        password_encrypted: None,
        private_key_plaintext: None,
        private_key_encrypted: None,
        domain: None,
    };

    let profile = database::create_credential_profile(&conn, req).expect("create failed");
    database::delete_credential_profile(&conn, &profile.id).expect("delete failed");

    let profiles = database::get_credential_profiles(&conn).expect("get failed");
    assert!(profiles.is_empty(), "profile should be gone after deletion");
}

// ── SSH Key tests ─────────────────────────────────────────────

#[test]
fn test_create_ssh_key() {
    let conn = setup_db();

    let req = CreateSshKeyRequest {
        name: "My Ed25519 Key".to_string(),
        key_type: "ed25519".to_string(),
        public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest".to_string(),
        private_key_encrypted: "v2:encrypted_private_key_blob".to_string(),
        fingerprint: "SHA256:testfingerprint123".to_string(),
        comment: Some("test key".to_string()),
    };

    let key = database::ssh_key_create(&conn, req).expect("ssh_key_create failed");
    assert!(!key.id.is_empty());
    assert_eq!(key.name, "My Ed25519 Key");
    assert_eq!(key.key_type, "ed25519");
    assert_eq!(key.fingerprint, "SHA256:testfingerprint123");
    assert_eq!(key.comment.as_deref(), Some("test key"));

    let keys = database::ssh_key_list(&conn).expect("ssh_key_list failed");
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].id, key.id);
}

#[test]
fn test_delete_ssh_key() {
    let conn = setup_db();

    let req = CreateSshKeyRequest {
        name: "Key To Delete".to_string(),
        key_type: "rsa".to_string(),
        public_key: "ssh-rsa AAAABTest".to_string(),
        private_key_encrypted: "v2:encrypted_blob".to_string(),
        fingerprint: "SHA256:abc123".to_string(),
        comment: None,
    };

    let key = database::ssh_key_create(&conn, req).expect("create failed");
    database::ssh_key_delete(&conn, &key.id).expect("delete failed");

    let keys = database::ssh_key_list(&conn).expect("list failed");
    assert!(keys.is_empty(), "SSH key should be gone after deletion");
}

// ── Audit Log tests ───────────────────────────────────────────

#[test]
fn test_audit_log_insert_and_retrieve() {
    let conn = setup_db();

    database::audit_log_insert(
        &conn,
        "connect",
        "connection",
        "conn-id-001",
        "My Server",
        "ok",
        "SSH session started",
    )
    .expect("audit_log_insert failed");

    let entries = database::audit_log_list(&conn, 10, 0).expect("audit_log_list failed");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].action, "connect");
    assert_eq!(entries[0].entity_type, "connection");
    assert_eq!(entries[0].entity_id, "conn-id-001");
    assert_eq!(entries[0].entity_name, "My Server");
    assert_eq!(entries[0].outcome, "ok");
    assert_eq!(entries[0].details, "SSH session started");
    assert!(entries[0].timestamp > 0);
    assert!(!entries[0].id.is_empty());
}

// ── Saved Command tests ────────────────────────────────────────

#[test]
fn test_saved_commands_crud() {
    let conn = setup_db();

    // Create
    let create_req = CreateSavedCommandRequest {
        name: "List Files".to_string(),
        command: "ls -la".to_string(),
        description: Some("List directory contents".to_string()),
        tags: Some("linux,files".to_string()),
    };
    let cmd = database::create_saved_command(&conn, create_req).expect("create failed");
    assert!(!cmd.id.is_empty());
    assert_eq!(cmd.name, "List Files");
    assert_eq!(cmd.command, "ls -la");

    // Read
    let cmds = database::get_saved_commands(&conn).expect("get failed");
    assert_eq!(cmds.len(), 1);
    assert_eq!(cmds[0].id, cmd.id);

    // Update
    let update_req = UpdateSavedCommandRequest {
        id: cmd.id.clone(),
        name: "List All Files".to_string(),
        command: "ls -lah".to_string(),
        description: Some("List with human readable sizes".to_string()),
        tags: Some("linux,files,updated".to_string()),
    };
    let updated = database::update_saved_command(&conn, update_req).expect("update failed");
    assert_eq!(updated.name, "List All Files");
    assert_eq!(updated.command, "ls -lah");

    // Delete
    database::delete_saved_command(&conn, &cmd.id).expect("delete failed");
    let cmds_after_delete = database::get_saved_commands(&conn).expect("get after delete failed");
    assert!(
        cmds_after_delete.is_empty(),
        "command should be gone after deletion"
    );
}

// ── Schema Version tests ───────────────────────────────────────

#[test]
fn test_schema_version_is_correct() {
    let conn = setup_db();

    let version: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .expect("could not query schema_version");

    // Current schema is v11 per database.rs CURRENT_SCHEMA_VERSION
    assert_eq!(version, 11, "schema version should be 11 after migrations");
}

#[test]
fn test_downgrade_guard() {
    // Uses a real file so initialize_database can open it
    let tmp = tempfile::NamedTempFile::new().expect("tempfile");
    let path = tmp.path().to_str().unwrap().to_string();

    // Initialize the DB at the current schema version
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        test_helpers::run_migrations_test(&conn);
    }

    // Artificially bump schema_version to simulate a future release DB:
    // Delete all existing version rows and insert only 9999 so that
    // `SELECT version FROM schema_version LIMIT 1` always returns 9999.
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute("DELETE FROM schema_version", []).unwrap();
        conn.execute("INSERT INTO schema_version (version) VALUES (9999)", [])
            .unwrap();
    }

    // initialize_database should refuse to open a DB with schema > supported
    let result = remote_manager_lib::database::initialize_database(&path);
    assert!(
        result.is_err(),
        "opening a DB with schema version 9999 must fail"
    );
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("9999") || msg.contains("newer"),
        "error message should mention the version: {}",
        msg
    );
}

// ── Edge case tests ────────────────────────────────────────────

#[test]
fn test_connection_with_ssh_tunnels() {
    let conn = setup_db();

    let tunnels = vec![
        SshTunnel {
            id: "tunnel-1".to_string(),
            r#type: "Local".to_string(),
            local_port: 8080,
            destination_host: Some("internal.server.local".to_string()),
            destination_port: Some(80),
        },
        SshTunnel {
            id: "tunnel-2".to_string(),
            r#type: "Dynamic".to_string(),
            local_port: 1080,
            destination_host: None,
            destination_port: None,
        },
    ];

    let mut req = test_helpers::make_test_connection("tunnel-host", "SSH");
    req.ssh_tunnels = Some(tunnels.clone());

    let created = database::create_connection(&conn, req).expect("create failed");
    assert!(
        created.ssh_tunnels.is_some(),
        "ssh_tunnels should round-trip"
    );

    let stored_tunnels = created.ssh_tunnels.unwrap();
    assert_eq!(stored_tunnels.len(), 2);
    assert_eq!(stored_tunnels[0].id, "tunnel-1");
    assert_eq!(stored_tunnels[0].r#type, "Local");
    assert_eq!(stored_tunnels[0].local_port, 8080);
    assert_eq!(
        stored_tunnels[0].destination_host.as_deref(),
        Some("internal.server.local")
    );
    assert_eq!(stored_tunnels[0].destination_port, Some(80));
    assert_eq!(stored_tunnels[1].id, "tunnel-2");
    assert_eq!(stored_tunnels[1].r#type, "Dynamic");
    assert_eq!(stored_tunnels[1].local_port, 1080);
    assert!(stored_tunnels[1].destination_host.is_none());
    assert!(stored_tunnels[1].destination_port.is_none());
}

#[test]
fn test_connection_tags_and_notes() {
    let conn = setup_db();

    let mut req = test_helpers::make_test_connection("tagged-host", "SSH");
    req.tags = Some("production,linux,web".to_string());
    req.notes = Some("This is a production web server. Handle with care.".to_string());

    let created = database::create_connection(&conn, req).expect("create failed");
    assert_eq!(created.tags.as_deref(), Some("production,linux,web"));
    assert_eq!(
        created.notes.as_deref(),
        Some("This is a production web server. Handle with care.")
    );

    let all = database::get_connections(&conn).expect("get failed");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].tags.as_deref(), Some("production,linux,web"));
    assert_eq!(
        all[0].notes.as_deref(),
        Some("This is a production web server. Handle with care.")
    );
}

#[test]
fn test_favorite_toggle() {
    let conn = setup_db();

    let req = test_helpers::make_test_connection("favorite-host", "SSH");
    let created = database::create_connection(&conn, req).expect("create failed");

    // Initially not a favorite
    assert!(!created.is_favorite);

    // Toggle to favorite
    let is_fav = database::toggle_favorite(&conn, &created.id).expect("toggle failed");
    assert!(is_fav, "should now be a favorite");

    let all = database::get_connections(&conn).expect("get failed");
    assert!(all[0].is_favorite, "is_favorite should be true in DB");

    // Toggle back to not favorite
    let is_fav2 = database::toggle_favorite(&conn, &created.id).expect("toggle 2 failed");
    assert!(!is_fav2, "should no longer be a favorite");

    let all2 = database::get_connections(&conn).expect("get failed 2");
    assert!(!all2[0].is_favorite, "is_favorite should be false in DB");
}
