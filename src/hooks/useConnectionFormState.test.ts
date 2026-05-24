import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConnectionFormState } from './useConnectionFormState';
import type { ServerConnection } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal ServerConnection fixture for edit tests. */
function makeConnection(overrides: Partial<ServerConnection> = {}): ServerConnection {
    return {
        id: 'conn-1',
        name: 'My Server',
        host: '192.168.1.10',
        port: 22,
        protocol: 'SSH',
        username: 'admin',
        password_encrypted: null,
        private_key_encrypted: null,
        group_id: null,
        use_private_key: true,
        rdp_width: 1280,
        rdp_height: 800,
        rdp_fullscreen: true,
        domain: 'CORP',
        rdp_color_depth: 32,
        rdp_redirect_audio: true,
        rdp_redirect_printers: false,
        rdp_redirect_drives: false,
        ssh_tunnels: [],
        credential_profile_id: null,
        override_credentials: false,
        jump_host_id: null,
        use_ssh_agent: true,
        ssh_key_id: 'key-42',
        tags: 'prod,linux',
        last_connected_at: null,
        is_favorite: false,
        notes: 'primary server',
        use_ftps: true,
        rdp_nla: true,
        docker_transport: 'socket',
        docker_socket_path: '/var/run/docker.sock',
        docker_tls_ca_path: null,
        docker_tls_cert_path: null,
        docker_tls_key_path: null,
        proxmox_api_token_id: 'user@pam!tok',
        proxmox_api_token_secret_encrypted: 'enc-secret',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        ...overrides,
    };
}

// ── Default state (no editConnection) ────────────────────────────────────────

describe('useConnectionFormState — defaults', () => {
    it('initialises common fields to sensible defaults', () => {
        const { result } = renderHook(() => useConnectionFormState());
        expect(result.current.common.name).toBe('');
        expect(result.current.common.host).toBe('');
        expect(result.current.common.port).toBe(22);
        expect(result.current.common.protocol).toBe('SSH');
        expect(result.current.common.username).toBe('');
        expect(result.current.common.group_id).toBeNull();
        expect(result.current.common.override_credentials).toBe(false);
    });

    it('initialises SSH fields to sensible defaults', () => {
        const { result } = renderHook(() => useConnectionFormState());
        expect(result.current.ssh.use_private_key).toBe(false);
        expect(result.current.ssh.ssh_tunnels).toEqual([]);
        expect(result.current.ssh.jump_host_id).toBeNull();
        expect(result.current.ssh.use_ssh_agent).toBe(false);
    });

    it('initialises RDP fields to 1920×1080 by default', () => {
        const { result } = renderHook(() => useConnectionFormState());
        expect(result.current.rdp.rdp_width).toBe(1920);
        expect(result.current.rdp.rdp_height).toBe(1080);
        expect(result.current.rdp.rdp_color_depth).toBe(24);
    });

    it('initialises Docker transport to tcp', () => {
        const { result } = renderHook(() => useConnectionFormState());
        expect(result.current.docker.docker_transport).toBe('tcp');
        expect(result.current.docker.docker_socket_path).toBeNull();
    });
});

// ── Slice setters ─────────────────────────────────────────────────────────────

describe('useConnectionFormState — setters', () => {
    it('setCommon updates only the targeted key', () => {
        const { result } = renderHook(() => useConnectionFormState());

        act(() => result.current.setCommon('name', 'Prod DB'));
        expect(result.current.common.name).toBe('Prod DB');
        // Other fields unchanged
        expect(result.current.common.host).toBe('');
        expect(result.current.common.port).toBe(22);
    });

    it('setSsh updates ssh_key_id without touching other SSH fields', () => {
        const { result } = renderHook(() => useConnectionFormState());

        act(() => result.current.setSsh('ssh_key_id', 'key-99'));
        expect(result.current.ssh.ssh_key_id).toBe('key-99');
        expect(result.current.ssh.use_private_key).toBe(false);
    });

    it('setRdp updates rdp_width without touching rdp_height', () => {
        const { result } = renderHook(() => useConnectionFormState());

        act(() => result.current.setRdp('rdp_width', 2560));
        expect(result.current.rdp.rdp_width).toBe(2560);
        expect(result.current.rdp.rdp_height).toBe(1080);
    });

    it('setFtp toggles use_ftps', () => {
        const { result } = renderHook(() => useConnectionFormState());

        act(() => result.current.setFtp('use_ftps', true));
        expect(result.current.ftp.use_ftps).toBe(true);
    });

    it('setDocker updates transport type', () => {
        const { result } = renderHook(() => useConnectionFormState());

        act(() => result.current.setDocker('docker_transport', 'socket'));
        expect(result.current.docker.docker_transport).toBe('socket');
    });

    it('setProxmox updates token id', () => {
        const { result } = renderHook(() => useConnectionFormState());

        act(() => result.current.setProxmox('proxmox_api_token_id', 'root@pam!mytoken'));
        expect(result.current.proxmox.proxmox_api_token_id).toBe('root@pam!mytoken');
    });

    it('consecutive setCommon calls accumulate correctly', () => {
        const { result } = renderHook(() => useConnectionFormState());

        act(() => {
            result.current.setCommon('name', 'first');
            result.current.setCommon('host', '10.0.0.1');
            result.current.setCommon('port', 2222);
        });
        expect(result.current.common.name).toBe('first');
        expect(result.current.common.host).toBe('10.0.0.1');
        expect(result.current.common.port).toBe(2222);
    });
});

// ── toRequest ─────────────────────────────────────────────────────────────────

describe('useConnectionFormState — toRequest', () => {
    it('merges all slices into a flat CreateConnectionRequest', () => {
        const { result } = renderHook(() => useConnectionFormState());

        act(() => {
            result.current.setCommon('name', 'Staging');
            result.current.setCommon('host', '10.0.0.5');
            result.current.setCommon('port', 2222);
            result.current.setSsh('use_private_key', true);
            result.current.setRdp('rdp_width', 2560);
            result.current.setFtp('use_ftps', true);
            result.current.setDocker('docker_transport', 'socket');
            result.current.setProxmox('proxmox_api_token_id', 'tok');
        });

        const req = result.current.toRequest();

        // Common fields present
        expect(req.name).toBe('Staging');
        expect(req.host).toBe('10.0.0.5');
        expect(req.port).toBe(2222);

        // SSH fields merged
        expect(req.use_private_key).toBe(true);

        // RDP fields merged
        expect(req.rdp_width).toBe(2560);

        // FTP fields merged
        expect(req.use_ftps).toBe(true);

        // Docker fields merged
        expect(req.docker_transport).toBe('socket');

        // Proxmox fields merged
        expect(req.proxmox_api_token_id).toBe('tok');

        // Encrypted fields are always null from toRequest (sent separately)
        expect(req.password_encrypted).toBeNull();
        expect(req.private_key_encrypted).toBeNull();
    });

    it('toRequest with defaults produces null encrypted fields', () => {
        const { result } = renderHook(() => useConnectionFormState());
        const req = result.current.toRequest();
        expect(req.password_encrypted).toBeNull();
        expect(req.private_key_encrypted).toBeNull();
    });
});

// ── loadFromConnection ────────────────────────────────────────────────────────

describe('useConnectionFormState — loadFromConnection', () => {
    it('hydrates all slices from a ServerConnection', () => {
        const { result } = renderHook(() => useConnectionFormState());
        const conn = makeConnection();

        act(() => result.current.loadFromConnection(conn));

        // Common
        expect(result.current.common.name).toBe('My Server');
        expect(result.current.common.host).toBe('192.168.1.10');
        expect(result.current.common.port).toBe(22);
        expect(result.current.common.tags).toBe('prod,linux');
        expect(result.current.common.notes).toBe('primary server');

        // SSH
        expect(result.current.ssh.use_private_key).toBe(true);
        expect(result.current.ssh.use_ssh_agent).toBe(true);
        expect(result.current.ssh.ssh_key_id).toBe('key-42');

        // RDP
        expect(result.current.rdp.rdp_width).toBe(1280);
        expect(result.current.rdp.rdp_height).toBe(800);
        expect(result.current.rdp.rdp_fullscreen).toBe(true);
        expect(result.current.rdp.domain).toBe('CORP');
        expect(result.current.rdp.rdp_color_depth).toBe(32);
        expect(result.current.rdp.rdp_nla).toBe(true);

        // FTP
        expect(result.current.ftp.use_ftps).toBe(true);

        // Docker
        expect(result.current.docker.docker_transport).toBe('socket');
        expect(result.current.docker.docker_socket_path).toBe('/var/run/docker.sock');

        // Proxmox
        expect(result.current.proxmox.proxmox_api_token_id).toBe('user@pam!tok');
    });

    it('handles null optional fields with safe defaults', () => {
        const { result } = renderHook(() => useConnectionFormState());
        const conn = makeConnection({
            ssh_tunnels: null,
            jump_host_id: undefined as unknown as null,
            use_ssh_agent: undefined as unknown as boolean,
            rdp_width: undefined as unknown as number,
        });

        act(() => result.current.loadFromConnection(conn));

        expect(result.current.ssh.ssh_tunnels).toEqual([]);
        expect(result.current.ssh.jump_host_id).toBeNull();
        expect(result.current.ssh.use_ssh_agent).toBe(false);
        expect(result.current.rdp.rdp_width).toBe(1920); // fallback default
    });

    it('initialised with editConnection pre-populates slices without calling loadFromConnection', () => {
        const conn = makeConnection({ name: 'Pre-loaded' });
        const { result } = renderHook(() => useConnectionFormState(conn));

        // No act needed — initial state
        expect(result.current.common.name).toBe('Pre-loaded');
        expect(result.current.ssh.use_private_key).toBe(true);
    });

    it('loadFromConnection overrides any previous manual edits', () => {
        const { result } = renderHook(() => useConnectionFormState());

        act(() => result.current.setCommon('name', 'Manually typed'));
        expect(result.current.common.name).toBe('Manually typed');

        const conn = makeConnection({ name: 'Loaded from DB' });
        act(() => result.current.loadFromConnection(conn));
        expect(result.current.common.name).toBe('Loaded from DB');
    });
});

// ── Setter stability (useCallback memoisation) ────────────────────────────────

describe('useConnectionFormState — setter reference stability', () => {
    it('setCommon reference does not change across re-renders', () => {
        const { result, rerender } = renderHook(() => useConnectionFormState());
        const ref1 = result.current.setCommon;
        act(() => result.current.setCommon('name', 'new name'));
        rerender();
        expect(result.current.setCommon).toBe(ref1);
    });

    it('setSsh reference does not change across re-renders', () => {
        const { result, rerender } = renderHook(() => useConnectionFormState());
        const ref1 = result.current.setSsh;
        act(() => result.current.setCommon('name', 'trigger'));
        rerender();
        expect(result.current.setSsh).toBe(ref1);
    });

    it('loadFromConnection reference is stable', () => {
        const { result, rerender } = renderHook(() => useConnectionFormState());
        const ref1 = result.current.loadFromConnection;
        act(() => result.current.setCommon('name', 'x'));
        rerender();
        expect(result.current.loadFromConnection).toBe(ref1);
    });
});
