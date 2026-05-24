/**
 * MED-5: useConnectionFormState
 *
 * Splits ConnectionForm's previously monolithic useState<CreateConnectionRequest>
 * (30+ fields) into domain-specific slices so that typing in the "Name" field
 * only re-renders components that depend on the common slice — not the RDP or
 * SSH advanced panels.
 *
 * Each slice is a plain object; the `toRequest()` helper merges them back into
 * a full CreateConnectionRequest for submission.
 */

import { useCallback, useState } from 'react';
import type { CreateConnectionRequest, ServerConnection, SshTunnel } from '../types';

// ── Common fields (shared by all protocols) ─────────────────────────────────

export interface CommonFields {
    name: string;
    host: string;
    port: number;
    protocol: 'SSH' | 'RDP' | 'VNC' | 'SFTP' | 'FTP' | 'PROXMOX' | 'DOCKER';
    username: string;
    group_id: string | null;
    credential_profile_id: string | null;
    override_credentials: boolean;
    tags: string | null;
    notes: string | null;
}

// ── SSH-specific fields ──────────────────────────────────────────────────────

export interface SshFields {
    use_private_key: boolean;
    ssh_tunnels: SshTunnel[];
    jump_host_id: string | null;
    ssh_key_id: string | null;
    use_ssh_agent: boolean;
}

// ── RDP-specific fields ──────────────────────────────────────────────────────

export interface RdpFields {
    rdp_width: number;
    rdp_height: number;
    rdp_fullscreen: boolean;
    domain: string;
    rdp_color_depth: number;
    rdp_redirect_audio: boolean;
    rdp_redirect_printers: boolean;
    rdp_redirect_drives: boolean;
    rdp_nla: boolean;
}

// ── FTP-specific fields ──────────────────────────────────────────────────────

export interface FtpFields {
    use_ftps: boolean;
}

// ── Docker-specific fields ───────────────────────────────────────────────────

export interface DockerFields {
    docker_transport: string;
    docker_socket_path: string | null;
    docker_tls_ca_path: string | null;
    docker_tls_cert_path: string | null;
    docker_tls_key_path: string | null;
}

// ── Proxmox-specific fields ──────────────────────────────────────────────────

export interface ProxmoxFields {
    proxmox_api_token_id: string | null;
    proxmox_api_token_secret_encrypted: string | null;
}

// ── Default values ────────────────────────────────────────────────────────────

const DEFAULT_COMMON: CommonFields = {
    name: '',
    host: '',
    port: 22,
    protocol: 'SSH',
    username: '',
    group_id: null,
    credential_profile_id: null,
    override_credentials: false,
    tags: null,
    notes: null,
};

const DEFAULT_SSH: SshFields = {
    use_private_key: false,
    ssh_tunnels: [],
    jump_host_id: null,
    ssh_key_id: null,
    use_ssh_agent: false,
};

const DEFAULT_RDP: RdpFields = {
    rdp_width: 1920,
    rdp_height: 1080,
    rdp_fullscreen: false,
    domain: '',
    rdp_color_depth: 24,
    rdp_redirect_audio: false,
    rdp_redirect_printers: false,
    rdp_redirect_drives: false,
    rdp_nla: false,
};

const DEFAULT_FTP: FtpFields = { use_ftps: false };

const DEFAULT_DOCKER: DockerFields = {
    docker_transport: 'tcp',
    docker_socket_path: null,
    docker_tls_ca_path: null,
    docker_tls_cert_path: null,
    docker_tls_key_path: null,
};

const DEFAULT_PROXMOX: ProxmoxFields = {
    proxmox_api_token_id: null,
    proxmox_api_token_secret_encrypted: null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface ConnectionFormState {
    common: CommonFields;
    ssh: SshFields;
    rdp: RdpFields;
    ftp: FtpFields;
    docker: DockerFields;
    proxmox: ProxmoxFields;

    setCommon: <K extends keyof CommonFields>(key: K, value: CommonFields[K]) => void;
    setSsh: <K extends keyof SshFields>(key: K, value: SshFields[K]) => void;
    setRdp: <K extends keyof RdpFields>(key: K, value: RdpFields[K]) => void;
    setFtp: <K extends keyof FtpFields>(key: K, value: FtpFields[K]) => void;
    setDocker: <K extends keyof DockerFields>(key: K, value: DockerFields[K]) => void;
    setProxmox: <K extends keyof ProxmoxFields>(key: K, value: ProxmoxFields[K]) => void;

    /** Merge all slices into a CreateConnectionRequest for submission. */
    toRequest: () => CreateConnectionRequest;

    /**
     * Populate all slices from an existing ServerConnection when editing.
     * Call this once in a useEffect that depends on the connection.
     */
    loadFromConnection: (c: ServerConnection) => void;
}

/** Hydrate the form slices from an existing ServerConnection record. */
function fromConnection(c: ServerConnection): {
    common: CommonFields;
    ssh: SshFields;
    rdp: RdpFields;
    ftp: FtpFields;
    docker: DockerFields;
    proxmox: ProxmoxFields;
} {
    return {
        common: {
            name: c.name,
            host: c.host,
            port: c.port,
            protocol: c.protocol as CommonFields['protocol'],
            username: c.username,
            group_id: c.group_id ?? null,
            credential_profile_id: c.credential_profile_id ?? null,
            override_credentials: c.override_credentials,
            tags: c.tags ?? null,
            notes: c.notes ?? null,
        },
        ssh: {
            use_private_key: c.use_private_key,
            ssh_tunnels: c.ssh_tunnels ?? [],
            jump_host_id: c.jump_host_id ?? null,
            ssh_key_id: c.ssh_key_id ?? null,
            use_ssh_agent: c.use_ssh_agent ?? false,
        },
        rdp: {
            rdp_width: c.rdp_width ?? 1920,
            rdp_height: c.rdp_height ?? 1080,
            rdp_fullscreen: c.rdp_fullscreen ?? false,
            domain: c.domain ?? '',
            rdp_color_depth: c.rdp_color_depth ?? 24,
            rdp_redirect_audio: c.rdp_redirect_audio ?? false,
            rdp_redirect_printers: c.rdp_redirect_printers ?? false,
            rdp_redirect_drives: c.rdp_redirect_drives ?? false,
            rdp_nla: c.rdp_nla ?? false,
        },
        ftp: { use_ftps: c.use_ftps ?? false },
        docker: {
            docker_transport: c.docker_transport ?? 'tcp',
            docker_socket_path: c.docker_socket_path ?? null,
            docker_tls_ca_path: c.docker_tls_ca_path ?? null,
            docker_tls_cert_path: c.docker_tls_cert_path ?? null,
            docker_tls_key_path: c.docker_tls_key_path ?? null,
        },
        proxmox: {
            proxmox_api_token_id: c.proxmox_api_token_id ?? null,
            proxmox_api_token_secret_encrypted: c.proxmox_api_token_secret_encrypted ?? null,
        },
    };
}

export function useConnectionFormState(editConnection?: ServerConnection | null): ConnectionFormState {
    const initial = editConnection ? fromConnection(editConnection) : null;

    const [common, setCommonState] = useState<CommonFields>(initial?.common ?? DEFAULT_COMMON);
    const [ssh, setSshState] = useState<SshFields>(initial?.ssh ?? DEFAULT_SSH);
    const [rdp, setRdpState] = useState<RdpFields>(initial?.rdp ?? DEFAULT_RDP);
    const [ftp, setFtpState] = useState<FtpFields>(initial?.ftp ?? DEFAULT_FTP);
    const [docker, setDockerState] = useState<DockerFields>(initial?.docker ?? DEFAULT_DOCKER);
    const [proxmox, setProxmoxState] = useState<ProxmoxFields>(initial?.proxmox ?? DEFAULT_PROXMOX);

    const setCommon = useCallback(<K extends keyof CommonFields>(key: K, value: CommonFields[K]) => {
        setCommonState(prev => ({ ...prev, [key]: value }));
    }, []);

    const setSsh = useCallback(<K extends keyof SshFields>(key: K, value: SshFields[K]) => {
        setSshState(prev => ({ ...prev, [key]: value }));
    }, []);

    const setRdp = useCallback(<K extends keyof RdpFields>(key: K, value: RdpFields[K]) => {
        setRdpState(prev => ({ ...prev, [key]: value }));
    }, []);

    const setFtp = useCallback(<K extends keyof FtpFields>(key: K, value: FtpFields[K]) => {
        setFtpState(prev => ({ ...prev, [key]: value }));
    }, []);

    const setDocker = useCallback(<K extends keyof DockerFields>(key: K, value: DockerFields[K]) => {
        setDockerState(prev => ({ ...prev, [key]: value }));
    }, []);

    const setProxmox = useCallback(<K extends keyof ProxmoxFields>(key: K, value: ProxmoxFields[K]) => {
        setProxmoxState(prev => ({ ...prev, [key]: value }));
    }, []);

    const toRequest = useCallback((): CreateConnectionRequest => ({
        ...common,
        ...ssh,
        ...rdp,
        ...ftp,
        ...docker,
        ...proxmox,
        // Preserve the legacy encrypted fields as null (actual values come via *_plaintext in submit)
        password_encrypted: null,
        private_key_encrypted: null,
    }), [common, ssh, rdp, ftp, docker, proxmox]);

    const loadFromConnection = useCallback((c: ServerConnection) => {
        const slices = fromConnection(c);
        setCommonState(slices.common);
        setSshState(slices.ssh);
        setRdpState(slices.rdp);
        setFtpState(slices.ftp);
        setDockerState(slices.docker);
        setProxmoxState(slices.proxmox);
    }, []);

    return {
        common, ssh, rdp, ftp, docker, proxmox,
        setCommon, setSsh, setRdp, setFtp, setDocker, setProxmox,
        toRequest,
        loadFromConnection,
    };
}
