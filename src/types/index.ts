export interface SshTunnel {
    id: string;
    type: 'Local' | 'Remote' | 'Dynamic';
    localPort: number;
    destinationHost?: string;
    destinationPort?: number;
}

export type CredentialType = 'ssh' | 'rdp' | 'ftp' | 'generic';

export interface CredentialProfile {
    id: string;
    name: string;
    type: CredentialType;
    description: string | null;
    username: string | null;
    password_encrypted?: string | null;
    private_key_encrypted?: string | null;
    domain: string | null;
    created_at: number;
    updated_at: number;
}

export interface CreateCredentialProfileRequest {
    name: string;
    type: CredentialType;
    description: string | null;
    username: string | null;
    password_encrypted?: string | null;
    private_key_encrypted?: string | null;
    domain: string | null;
}

export interface UpdateCredentialProfileRequest extends CreateCredentialProfileRequest {
    id: string;
}

export interface ResolvedCredentials {
    username: string | null;
    password_decrypted: string | null;
    private_key_decrypted: string | null;
    domain: string | null;
}

export interface ServerConnection {
    id: string;
    name: string;
    host: string;
    port: number;
    protocol: 'SSH' | 'RDP' | 'VNC' | 'SFTP' | 'FTP' | 'PROXMOX' | 'DOCKER';
    username: string;
    password_encrypted?: string | null;
    private_key_encrypted?: string | null;
    group_id?: string | null;
    use_private_key: boolean;
    rdp_width: number;
    rdp_height: number;
    rdp_fullscreen: boolean;
    domain: string;
    rdp_color_depth: number;
    rdp_redirect_audio: boolean;
    rdp_redirect_printers: boolean;
    rdp_redirect_drives: boolean;
    ssh_tunnels?: SshTunnel[];
    credential_profile_id?: string | null;
    override_credentials: boolean;
    created_at: string;
    updated_at: string;
}

export interface Group {
    id: string;
    name: string;
    parent_id?: string | null;
    sort_order: number;
}

export interface CreateConnectionRequest {
    name: string;
    host: string;
    port: number;
    protocol: 'SSH' | 'RDP' | 'VNC' | 'SFTP' | 'FTP' | 'PROXMOX' | 'DOCKER';
    username: string;
    password_encrypted?: string | null;
    private_key_encrypted?: string | null;
    group_id?: string | null;
    use_private_key: boolean;
    rdp_width?: number | null;
    rdp_height?: number | null;
    rdp_fullscreen?: boolean | null;
    domain?: string | null;
    rdp_color_depth?: number | null;
    rdp_redirect_audio?: boolean | null;
    rdp_redirect_printers?: boolean | null;
    rdp_redirect_drives?: boolean | null;
    ssh_tunnels?: SshTunnel[] | null;
    credential_profile_id?: string | null;
    override_credentials?: boolean | null;
}

export interface UpdateConnectionRequest extends CreateConnectionRequest {
    id: string;
}

export interface ExportData {
    version: number;
    connections: ServerConnection[];
    groups: Group[];
    credential_profiles: CredentialProfile[];
}

export interface SavedCommand {
    id: string;
    name: string;
    command: string;
    description: string | null;
    tags: string | null;
    created_at: string;
    updated_at: string;
}

export interface CreateSavedCommandRequest {
    name: string;
    command: string;
    description: string | null;
    tags: string | null;
}

export interface UpdateSavedCommandRequest {
    id: string;
    name: string;
    command: string;
    description: string | null;
    tags: string | null;
}

export interface VaultStatus {
    unlocked: boolean;
    first_run: boolean;
}

export interface RdpAvailability {
    available: boolean;
    binary_path: string | null;
    error: string | null;
}

export interface VncAvailability {
    available: boolean;
    binary_path: string | null;
    error: string | null;
}

export interface NetworkScanResult {
    ip: string;
    hostname: string;
    ssh: boolean;
    telnet: boolean;
    http: boolean;
    https: boolean;
    rlogin: boolean;
    rdp: boolean;
    vnc: boolean;
    open_ports: number[];
    closed_ports: number[];
}

export interface ToolResult {
    stdout: string;
    stderr: string;
    success: boolean;
    code: number | null;
}

// ── Proxmox ──────────────────────────────────────────────

export interface ProxmoxAuthResponse {
    CSRFPreventionToken: string;
    ticket: string;
    username: string;
}

export interface ProxmoxResource {
    id: string;
    type: string; // "qemu" or "lxc"
    node: string;
    status: string;
    name: string;
    uptime: number;
    cpu: number;
    maxcpu: number;
    mem: number;
    maxmem: number;
}

// ── Docker ───────────────────────────────────────────────

export interface DockerContainer {
    Id: string;
    Names: string[];
    Image: string;
    State: string;
    Status: string;
}

// Frontend types (Tabs, Status, etc)

export type TabStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface Tab {
    id: string; // Unique tab ID
    connectionId: string;
    connectionName: string;
    protocol: 'SSH' | 'RDP' | 'VNC' | 'LOCAL' | 'SFTP' | 'FTP' | 'PROXMOX' | 'DOCKER';
    status: TabStatus;
    connection?: ServerConnection;
}

export interface SshDataEvent {
    session_id: string;
    data: string;
}

export interface SshStatusEvent {
    session_id: string;
    status: string;
    message: string;
}

export interface FileNode {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
    modified_at?: number | null;
}

export interface FileListResult {
    files: FileNode[];
    current_path: string;
}

