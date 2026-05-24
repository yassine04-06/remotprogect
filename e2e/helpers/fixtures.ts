/**
 * Shared mock data used across E2E specs.
 *
 * Shapes mirror the Rust types from src/types/generated.ts so that the React
 * components receive well-formed objects from the mocked IPC layer.
 */

import type { MockResponses } from './tauri-mock';
import { mockError } from './tauri-mock';

// ── Sample connection objects ─────────────────────────────────────────────────

export const SSH_CONNECTION = {
    id: 'conn-ssh-1',
    name: 'Test SSH Server',
    host: '10.0.0.1',
    port: 22,
    protocol: 'SSH',
    username: 'admin',
    password_encrypted: null,
    private_key_encrypted: null,
    use_private_key: false,
    group_id: null,
    use_ftps: false,
    rdp_nla: false,
    docker_transport: 'tcp',
    docker_socket_path: null,
    docker_tls_ca_path: null,
    docker_tls_cert_path: null,
    docker_tls_key_path: null,
    proxmox_api_token_id: null,
    proxmox_api_token_secret_encrypted: null,
    is_favorite: false,
    last_connected_at: null,
    tags: null,
    notes: null,
    rdp_width: null,
    rdp_height: null,
    rdp_fullscreen: false,
    domain: null,
    rdp_color_depth: null,
    rdp_redirect_audio: false,
    rdp_redirect_printers: false,
    rdp_redirect_drives: false,
    ssh_tunnels: null,
    credential_profile_id: null,
    override_credentials: null,
    jump_host_id: null,
    ssh_key_id: null,
    use_ssh_agent: false,
};

export const RDP_CONNECTION = {
    ...SSH_CONNECTION,
    id: 'conn-rdp-1',
    name: 'Test RDP Server',
    host: '192.168.1.100',
    port: 3389,
    protocol: 'RDP',
};

/** Minimal summary shape returned by get_connections_summary */
export const SSH_SUMMARY = {
    id: 'conn-ssh-1',
    name: 'Test SSH Server',
    host: '10.0.0.1',
    port: 22,
    protocol: 'SSH',
    username: 'admin',
    is_favorite: false,
    last_connected_at: null,
    tags: null,
    group_id: null,
};

export const RDP_SUMMARY = {
    ...SSH_SUMMARY,
    id: 'conn-rdp-1',
    name: 'Test RDP Server',
    host: '192.168.1.100',
    port: 3389,
    protocol: 'RDP',
};

// ── Sample imported connections (for Import dialog tests) ─────────────────────

export const IMPORTED_SSH: Record<string, unknown> = {
    name: 'Imported SSH',
    host: '10.1.1.1',
    port: 22,
    protocol: 'SSH',
    username: 'root',
    password: null,
    domain: null,
    group_path: null,
    rdp_width: null,
    rdp_height: null,
    rdp_color_depth: null,
    rdp_redirect_drives: false,
    rdp_redirect_printers: false,
    rdp_redirect_audio: false,
    ssh_key_path: null,
    source: 'putty',
    warning: null,
};

export const IMPORTED_RDP: Record<string, unknown> = {
    ...IMPORTED_SSH,
    name: 'Imported RDP',
    host: '192.168.0.5',
    port: 3389,
    protocol: 'RDP',
    source: 'rdm',
};

// ── Common response bundles ───────────────────────────────────────────────────

/** Responses used when the vault starts in a locked state. */
export const LOCKED_VAULT_RESPONSES: MockResponses = {
    is_vault_unlocked: { unlocked: false },
    is_first_run: false,
};

/** Responses used when the vault starts already unlocked with one SSH connection. */
export const UNLOCKED_VAULT_RESPONSES: MockResponses = {
    is_vault_unlocked: { unlocked: true },
    is_first_run: false,
    // useConnectionStore.fetchConnections calls api.getConnections() → get_connections
    // (NOT get_connections_summary — that's a separate, unused API).
    get_connections: [SSH_CONNECTION],
    get_connections_summary: [SSH_SUMMARY],
    get_groups: [],
    get_saved_commands: [],
    audit_log_list: [],
    // ssh keys: real command is ssh_key_list (NOT get_ssh_keys).
    ssh_key_list: [],
    get_ssh_keys: [],
    get_credential_profiles: [],
};

/** Successful unlock response (resolves to null = no return value). */
export const UNLOCK_SUCCESS: MockResponses = {
    unlock_vault: null,
    get_connections: [SSH_CONNECTION],
    get_connections_summary: [SSH_SUMMARY],
    get_groups: [],
    get_saved_commands: [],
    audit_log_list: [],
    ssh_key_list: [],
    get_ssh_keys: [],
    get_credential_profiles: [],
};

/** Failed unlock — wrong password. */
export const UNLOCK_FAILURE: MockResponses = {
    unlock_vault: mockError('Invalid master password', 'AUTH_FAILED'),
};

export { mockError };
