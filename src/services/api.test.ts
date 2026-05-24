/**
 * api.ts unit tests
 *
 * Strategy: mock @tauri-apps/api/core so `invoke` never touches a real IPC
 * channel. Each test verifies that:
 *   1. The correct Tauri command name is passed
 *   2. The correct arguments object is forwarded
 *   3. The resolved value is returned as-is
 *
 * We test a representative sample from each domain group (vault, connections,
 * groups, credentials, SSH keys, scanning, etc.) rather than all 93 functions,
 * since every exported function has the same thin-wrapper shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock @tauri-apps/api/core before importing api.ts ─────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import * as api from './api';

const mockInvoke = vi.mocked(tauriInvoke);

beforeEach(() => {
    vi.clearAllMocks();
});

// ── Helper ────────────────────────────────────────────────────────────────────

/** Set up the mock to resolve with `value` and return the invocation promise. */
function resolveWith<T>(value: T): void {
    mockInvoke.mockResolvedValueOnce(value as never);
}

// ── Vault ─────────────────────────────────────────────────────────────────────

describe('Vault commands', () => {
    it('isVaultUnlocked calls is_vault_unlocked with no args', async () => {
        resolveWith({ unlocked: true, first_run: false });
        const result = await api.isVaultUnlocked();
        expect(mockInvoke).toHaveBeenCalledWith('is_vault_unlocked', undefined);
        expect(result).toEqual({ unlocked: true, first_run: false });
    });

    it('unlockVault passes the password in the request object', async () => {
        resolveWith(undefined);
        await api.unlockVault('hunter2');
        expect(mockInvoke).toHaveBeenCalledWith('unlock_vault', { request: { password: 'hunter2' } });
    });

    it('lockVault calls lock_vault with no args', async () => {
        resolveWith(undefined);
        await api.lockVault();
        expect(mockInvoke).toHaveBeenCalledWith('lock_vault', undefined);
    });

    it('setMasterPassword forwards the password correctly', async () => {
        resolveWith(undefined);
        await api.setMasterPassword('s3cr3t');
        expect(mockInvoke).toHaveBeenCalledWith('set_master_password', { request: { password: 's3cr3t' } });
    });

    it('changeMasterPassword forwards both old and new passwords', async () => {
        resolveWith(undefined);
        await api.changeMasterPassword('old', 'new');
        expect(mockInvoke).toHaveBeenCalledWith('change_master_password', {
            request: { old_password: 'old', new_password: 'new' },
        });
    });

    it('setAutoLockTimeout passes secs correctly', async () => {
        resolveWith(undefined);
        await api.setAutoLockTimeout(300);
        expect(mockInvoke).toHaveBeenCalledWith('set_auto_lock_timeout', { secs: 300 });
    });
});

// ── Connections ───────────────────────────────────────────────────────────────

describe('Connection commands', () => {
    it('getConnections calls get_connections', async () => {
        resolveWith([]);
        await api.getConnections();
        expect(mockInvoke).toHaveBeenCalledWith('get_connections', undefined);
    });

    it('getConnectionsSummary calls get_connections_summary', async () => {
        resolveWith([]);
        await api.getConnectionsSummary();
        expect(mockInvoke).toHaveBeenCalledWith('get_connections_summary', undefined);
    });

    it('createConnection forwards the request object', async () => {
        resolveWith('conn-abc');
        const req = {
            name: 'Test', host: '1.2.3.4', port: 22,
            protocol: 'SSH' as const, username: 'root',
            password_encrypted: null, private_key_encrypted: null,
            group_id: null, use_private_key: false,
            rdp_width: null, rdp_height: null, rdp_fullscreen: null,
            domain: null, rdp_color_depth: null, rdp_redirect_audio: null,
            rdp_redirect_printers: null, rdp_redirect_drives: null,
            ssh_tunnels: null, credential_profile_id: null,
            override_credentials: null, jump_host_id: null,
            ssh_key_id: null, use_ssh_agent: null, tags: null, notes: null,
            use_ftps: null, rdp_nla: null, docker_transport: null,
            docker_socket_path: null,
            docker_tls_ca_path: null, docker_tls_cert_path: null, docker_tls_key_path: null,
            proxmox_api_token_id: null,
            proxmox_api_token_secret_encrypted: null,
        };
        await api.createConnection(req);
        expect(mockInvoke).toHaveBeenCalledWith('create_connection', { request: req });
    });

    it('deleteConnection passes the id', async () => {
        resolveWith(undefined);
        await api.deleteConnection('conn-42');
        expect(mockInvoke).toHaveBeenCalledWith('delete_connection', { id: 'conn-42' });
    });

    it('toggleFavorite passes the id', async () => {
        resolveWith(undefined);
        await api.toggleFavorite('conn-7');
        expect(mockInvoke).toHaveBeenCalledWith('toggle_favorite', { id: 'conn-7' });
    });
});

// ── Groups ────────────────────────────────────────────────────────────────────

describe('Group commands', () => {
    it('getGroups calls get_groups', async () => {
        resolveWith([]);
        await api.getGroups();
        expect(mockInvoke).toHaveBeenCalledWith('get_groups', undefined);
    });

    it('createGroup forwards name and parent_id', async () => {
        resolveWith('grp-1');
        await api.createGroup('Production', 'parent-0');
        expect(mockInvoke).toHaveBeenCalledWith('create_group', {
            name: 'Production', parentId: 'parent-0',
        });
    });

    it('deleteGroup passes the id', async () => {
        resolveWith(undefined);
        await api.deleteGroup('grp-42');
        expect(mockInvoke).toHaveBeenCalledWith('delete_group', { id: 'grp-42' });
    });
});

// ── Credential profiles ───────────────────────────────────────────────────────

describe('Credential profile commands', () => {
    it('getCredentialProfiles calls get_credential_profiles', async () => {
        resolveWith([]);
        await api.getCredentialProfiles();
        expect(mockInvoke).toHaveBeenCalledWith('get_credential_profiles', undefined);
    });

    // CRIT-A4: resolveCredentials removed from IPC — credentials are now
    // resolved server-side inside each *_connect Tauri command.
});

// ── SSH Keys ──────────────────────────────────────────────────────────────────

describe('SSH key commands', () => {
    it('sshKeyList calls ssh_key_list', async () => {
        resolveWith([]);
        await api.sshKeyList();
        expect(mockInvoke).toHaveBeenCalledWith('ssh_key_list', undefined);
    });

    it('sshKeyDelete passes the id', async () => {
        resolveWith(undefined);
        await api.sshKeyDelete('key-5');
        expect(mockInvoke).toHaveBeenCalledWith('ssh_key_delete', { id: 'key-5' });
    });

    it('sshKeyGenerate forwards name, keyType and comment', async () => {
        resolveWith({ id: 'k', name: 'n', key_type: 'ed25519', public_key: '', private_key_encrypted: '', fingerprint: '', comment: null, created_at: 0 });
        await api.sshKeyGenerate('my key', 'ed25519', 'work laptop');
        expect(mockInvoke).toHaveBeenCalledWith('ssh_key_generate', { name: 'my key', keyType: 'ed25519', comment: 'work laptop' });
    });
});

// ── SSH session ───────────────────────────────────────────────────────────────

describe('SSH session commands', () => {
    it('sshConnect forwards sessionId and connectionId', async () => {
        // CRIT-A4: sshConnect now takes only sessionId + connectionId;
        // host/port/credentials are resolved server-side.
        resolveWith(undefined);
        await api.sshConnect('sess-1', 'conn-abc');
        expect(mockInvoke).toHaveBeenCalledWith('ssh_connect', expect.objectContaining({
            sessionId: 'sess-1',
            connectionId: 'conn-abc',
        }));
    });

    it('sshSendInput passes sessionId and data', async () => {
        resolveWith(undefined);
        await api.sshSendInput('sess-1', 'ls -la\n');
        expect(mockInvoke).toHaveBeenCalledWith('ssh_send_input', { sessionId: 'sess-1', data: 'ls -la\n' });
    });

    it('sshDisconnect passes the sessionId', async () => {
        resolveWith(undefined);
        await api.sshDisconnect('sess-1');
        expect(mockInvoke).toHaveBeenCalledWith('ssh_disconnect', { sessionId: 'sess-1' });
    });
});

// ── RDP ───────────────────────────────────────────────────────────────────────

describe('RDP commands', () => {
    it('rdpCheckAvailable calls rdp_check_available', async () => {
        resolveWith({ available: true, binary: 'mstsc', message: '' });
        await api.rdpCheckAvailable();
        expect(mockInvoke).toHaveBeenCalledWith('rdp_check_available', undefined);
    });

    it('rdpSendInput passes sessionId and the command string', async () => {
        resolveWith(undefined);
        await api.rdpSendInput('sess-2', 'CMD:CTRLALTDEL');
        expect(mockInvoke).toHaveBeenCalledWith('rdp_send_command', { sessionId: 'sess-2', command: 'CMD:CTRLALTDEL' });
    });
});

// ── Saved commands ────────────────────────────────────────────────────────────

describe('Saved command commands', () => {
    it('getSavedCommands calls get_saved_commands', async () => {
        resolveWith([]);
        await api.getSavedCommands();
        expect(mockInvoke).toHaveBeenCalledWith('get_saved_commands', undefined);
    });

    it('deleteSavedCommand passes the id', async () => {
        resolveWith(undefined);
        await api.deleteSavedCommand('cmd-9');
        expect(mockInvoke).toHaveBeenCalledWith('delete_saved_command', { id: 'cmd-9' });
    });
});

// ── Network scan ──────────────────────────────────────────────────────────────

describe('Network scan commands', () => {
    it('scanNetwork passes all required args', async () => {
        resolveWith(undefined);
        await api.scanNetwork('scan-1', '192.168.1.1', '192.168.1.254', [22, 80, 443], 500);
        expect(mockInvoke).toHaveBeenCalledWith('scan_network', {
            scanId: 'scan-1',
            startIp: '192.168.1.1',
            endIp: '192.168.1.254',
            ports: [22, 80, 443],
            timeoutMs: 500,
        });
    });
});

// ── Invoke safety wrapper ─────────────────────────────────────────────────────

describe('invoke safety wrapper', () => {
    it('propagates resolved values correctly', async () => {
        resolveWith({ unlocked: false, first_run: true });
        const result = await api.isVaultUnlocked();
        expect(result).toEqual({ unlocked: false, first_run: true });
    });

    it('propagates rejections from the underlying invoke', async () => {
        mockInvoke.mockRejectedValueOnce({ code: 'AUTH_FAILED', message: 'bad password' });
        await expect(api.unlockVault('wrong')).rejects.toEqual({ code: 'AUTH_FAILED', message: 'bad password' });
    });
});
