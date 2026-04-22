import { invoke } from '@tauri-apps/api/core';
import type {
    ServerConnection,
    Group,
    CreateConnectionRequest,
    UpdateConnectionRequest,
    VaultStatus,
    RdpAvailability,
    VncAvailability,
    ExportData,
    NetworkScanResult,
    ToolResult,
    FileListResult,
    SavedCommand,
    CreateSavedCommandRequest,
    UpdateSavedCommandRequest,
    SshTunnel,
    ProxmoxAuthResponse,
    ProxmoxResource,
    DockerContainer,
    CredentialProfile,
    CreateCredentialProfileRequest,
    UpdateCredentialProfileRequest,
    ResolvedCredentials
} from '../types';

// ── Vault ────────────────────────────────────────────────

export const isVaultUnlocked = () => invoke<VaultStatus>('is_vault_unlocked');

export const setMasterPassword = (password: string) =>
    invoke('set_master_password', { request: { password } });

export const unlockVault = (password: string) =>
    invoke('unlock_vault', { request: { password } });

export const lockVault = () => invoke('lock_vault');

// ── Encryption ───────────────────────────────────────────

export const encryptValue = (plaintext: string) =>
    invoke<string>('encrypt_value', { plaintext });

export const decryptValue = (ciphertext: string) =>
    invoke<string>('decrypt_value', { ciphertext });

// ── Connections ──────────────────────────────────────────

export const getConnections = () => invoke<ServerConnection[]>('get_connections');

export const createConnection = (request: CreateConnectionRequest) =>
    invoke<ServerConnection>('create_connection', { request });

export const updateConnection = (request: UpdateConnectionRequest) =>
    invoke('update_connection', { request });

export const deleteConnection = (id: string) => invoke('delete_connection', { id });

// ── Groups ───────────────────────────────────────────────

export const getGroups = () => invoke<Group[]>('get_groups');

export const createGroup = (name: string, parentId?: string | null) =>
    invoke<Group>('create_group', { name, parentId: parentId ?? null });

export const updateGroup = (id: string, name: string) =>
    invoke('update_group', { id, name });

export const deleteGroup = (id: string) => invoke('delete_group', { id });

// ── Credential Profiles ──────────────────────────────────

export const getCredentialProfiles = () => invoke<CredentialProfile[]>('get_credential_profiles');

export const createCredentialProfile = (request: CreateCredentialProfileRequest) =>
    invoke<CredentialProfile>('create_credential_profile', { request });

export const updateCredentialProfile = (request: UpdateCredentialProfileRequest) =>
    invoke('update_credential_profile', { request });

export const deleteCredentialProfile = (id: string) => invoke('delete_credential_profile', { id });

export const resolveCredentials = (connectionId: string) =>
    invoke<ResolvedCredentials>('resolve_credentials', { connectionId });

// ── Export / Import ──────────────────────────────────────

export const exportConnections = () => invoke<ExportData>('export_connections');

export const importConnections = (data: ExportData) =>
    invoke('import_connections', { data });

// ── SSH ──────────────────────────────────────────────────

export const sshConnect = (
    sessionId: string,
    host: string,
    port: number,
    username: string,
    password?: string | null,
    privateKeyPath?: string | null,
    sshTunnels?: SshTunnel[] | null,
) =>
    invoke('ssh_connect', {
        sessionId,
        host,
        port,
        username,
        password: password ?? null,
        privateKeyPath: privateKeyPath ?? null,
        sshTunnels: sshTunnels ?? null,
    });

export const sshSendInput = (sessionId: string, data: string) =>
    invoke('ssh_send_input', { sessionId, data });

export const sshDisconnect = (sessionId: string) =>
    invoke('ssh_disconnect', { sessionId });

// ── Local Shell ──────────────────────────────────────────

export const shellSpawn = (sessionId: string) =>
    invoke('shell_spawn', { sessionId });

export const shellSendInput = (sessionId: string, data: string) =>
    invoke('shell_send_input', { sessionId, data });

export const shellDisconnect = (sessionId: string) =>
    invoke('shell_disconnect', { sessionId });

export const shellResize = (sessionId: string, rows: number, cols: number) =>
    invoke('shell_resize', { sessionId, rows, cols });

// ── RDP ──────────────────────────────────────────────────

export const rdpCheckAvailable = () =>
    invoke<RdpAvailability>('rdp_check_available');

export const rdpConnect = (
    sessionId: string,
    host: string,
    port: number,
    username: string,
    password?: string,
    width?: number,
    height?: number,
    fullscreen?: boolean,
    domain?: string,
    color_depth?: number,
    audio?: boolean,
    printers?: boolean,
    drives?: boolean,
) =>
    invoke<string>('rdp_connect', {
        sessionId,
        host,
        port,
        username,
        password: password ?? "",
        width: width ?? 1920,
        height: height ?? 1080,
        fullscreen: fullscreen ?? false,
        domain: domain ?? "",
        colorDepth: color_depth ?? 24,
        audio: audio ?? false,
        printers: printers ?? false,
        drives: drives ?? false,
    });

export const rdpDisconnect = (sessionId: string) =>
    invoke('rdp_disconnect', { sessionId });

export const rdpEmbedWindow = (sessionId: string) =>
    invoke<boolean>('rdp_embed_window', { sessionId });

export const rdpResizeEmbedded = (sessionId: string, x: number, y: number, width: number, height: number) =>
    invoke('rdp_resize_embedded', { sessionId, x, y, width, height });

export const rdpSetVisibility = (sessionId: string, visible: boolean) =>
    invoke('rdp_set_visibility', { sessionId, visible });

export const rdpFocus = (sessionId: string) =>
    invoke('rdp_focus', { sessionId });

export const rdpSendInput = (sessionId: string, command: string) =>
    invoke('rdp_send_command', { sessionId, command });

export const rdpIsWindowAlive = (sessionId: string) =>
    invoke<boolean>('rdp_is_window_alive', { sessionId });

// ── VNC ──────────────────────────────────────────────────

export const vncCheckAvailable = () =>
    invoke<VncAvailability>('vnc_check_availability');

export const vncConnect = (
    sessionId: string,
    host: string,
    port: number,
    password?: string,
) =>
    invoke<string>('vnc_connect', {
        sessionId,
        host,
        port,
        password: password ?? null,
    });

// ── External Tools ──────────────────────────────────────

export const runExternalTool = (command: string, args: string[]) =>
    invoke<ToolResult>('run_external_tool', { command, args });

// ── Network ──────────────────────────────────────────────

export const scanNetwork = (startIp: string, endIp: string, ports: number[], timeoutMs: number) =>
    invoke<NetworkScanResult[]>('scan_network', { startIp, endIp, ports, timeoutMs });

export const pingServer = (host: string, port: number) =>
    invoke<number>('ping_server', { host, port });

// ── Proxmox ──────────────────────────────────────────────

export const proxmoxAuth = (host: string, port: number, username: string, password_encrypted: string, password?: string | null) =>
    invoke<ProxmoxAuthResponse>('proxmox_auth', { host, port, username, passwordEncrypted: password_encrypted, password: password ?? null });

export const proxmoxGetResources = (host: string, port: number, ticket: string) =>
    invoke<ProxmoxResource[]>('proxmox_get_resources', { host, port, ticket });

export const proxmoxVmAction = (host: string, port: number, ticket: string, csrf: string, node: string, vmid: string, vmType: string, action: string) =>
    invoke<string>('proxmox_vm_action', { host, port, ticket, csrf, node, vmid, vmType, action });

// ── Docker ───────────────────────────────────────────────

export const dockerGetContainers = (host: string, port: number) =>
    invoke<DockerContainer[]>('docker_get_containers', { host, port });

export const dockerContainerAction = (host: string, port: number, containerId: string, action: string) =>
    invoke<string>('docker_container_action', { host, port, containerId, action });

// ── Saved Commands ───────────────────────────────────────

export const createSavedCommand = (request: CreateSavedCommandRequest) =>
    invoke<SavedCommand>('create_saved_command', { request });

export const getSavedCommands = () =>
    invoke<SavedCommand[]>('get_saved_commands');

export const updateSavedCommand = (request: UpdateSavedCommandRequest) =>
    invoke<SavedCommand>('update_saved_command', { request });

export const deleteSavedCommand = (id: string) =>
    invoke<void>('delete_saved_command', { id });

// ── SFTP ─────────────────────────────────────────────────

export const sftpListDir = (host: string, port: number, username: string, password?: string | null, private_key_path?: string | null, path: string = '/') =>
    invoke<FileListResult>('sftp_list_dir', { host, port, username, password: password ?? null, privateKeyPath: private_key_path ?? null, path });

export const sftpUpload = (host: string, port: number, username: string, password?: string | null, private_key_path?: string | null, remote_path: string = '', local_path: string = '') =>
    invoke('sftp_upload', { host, port, username, password: password ?? null, privateKeyPath: private_key_path ?? null, remotePath: remote_path, localPath: local_path });

export const sftpDownload = (host: string, port: number, username: string, password?: string | null, private_key_path?: string | null, remote_path: string = '', local_path: string = '') =>
    invoke('sftp_download', { host, port, username, password: password ?? null, privateKeyPath: private_key_path ?? null, remotePath: remote_path, localPath: local_path });

export const sftpDelete = (host: string, port: number, username: string, password?: string | null, private_key_path?: string | null, path: string = '', is_dir: boolean = false) =>
    invoke('sftp_delete', { host, port, username, password: password ?? null, privateKeyPath: private_key_path ?? null, path, isDir: is_dir });

export const sftpRename = (host: string, port: number, username: string, password?: string | null, private_key_path?: string | null, old_path: string = '', new_path: string = '') =>
    invoke('sftp_rename', { host, port, username, password: password ?? null, privateKeyPath: private_key_path ?? null, oldPath: old_path, newPath: new_path });

export const sftpMkdir = (host: string, port: number, username: string, password?: string | null, private_key_path?: string | null, path: string = '') =>
    invoke('sftp_mkdir', { host, port, username, password: password ?? null, privateKeyPath: private_key_path ?? null, path });

// ── FTP ──────────────────────────────────────────────────

export const ftpListDir = (host: string, port: number, username: string, password?: string | null, path: string = '/') =>
    invoke<FileListResult>('ftp_list_dir', { host, port, username, password: password ?? null, path });

export const ftpUpload = (host: string, port: number, username: string, password?: string | null, remote_path: string = '', local_path: string = '') =>
    invoke('ftp_upload', { host, port, username, password: password ?? null, remotePath: remote_path, localPath: local_path });

export const ftpDownload = (host: string, port: number, username: string, password?: string | null, remote_path: string = '', local_path: string = '') =>
    invoke('ftp_download', { host, port, username, password: password ?? null, remotePath: remote_path, localPath: local_path });

export const ftpDelete = (host: string, port: number, username: string, password?: string | null, path: string = '', is_dir: boolean = false) =>
    invoke('ftp_delete', { host, port, username, password: password ?? null, path, isDir: is_dir });

export const ftpRename = (host: string, port: number, username: string, password?: string | null, old_path: string = '', new_path: string = '') =>
    invoke('ftp_rename', { host, port, username, password: password ?? null, oldPath: old_path, newPath: new_path });

export const ftpMkdir = (host: string, port: number, username: string, password?: string | null, path: string = '') =>
    invoke('ftp_mkdir', { host, port, username, password: password ?? null, path });

export const proxmoxOpenConsole = (url: string, label: string, title: string, ticket: string) =>
    invoke('proxmox_open_console', { url, label, title, ticket });
