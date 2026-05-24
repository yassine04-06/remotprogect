/**
 * M-1: useConnectionStore unit tests
 *
 * The store delegates every CRUD action to the api module and refreshes
 * its local list afterwards. Mocking the api module lets us verify the
 * delegation, the refresh-after-write, and the resetForLock behaviour
 * without going through Tauri.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerConnection, Group, CreateConnectionRequest, UpdateConnectionRequest } from '../types';

// ── Mock the api module BEFORE importing the store ───────────────────────────
vi.mock('../services/api', () => ({
    getConnections:     vi.fn(),
    getGroups:          vi.fn(),
    createConnection:   vi.fn(),
    updateConnection:   vi.fn(),
    deleteConnection:   vi.fn(),
    createGroup:        vi.fn(),
    updateGroup:        vi.fn(),
    deleteGroup:        vi.fn(),
}));

import * as api from '../services/api';
import { useConnectionStore } from './useConnectionStore';

const mockedApi = vi.mocked(api);

function makeConn(id: string, name = `srv-${id}`): ServerConnection {
    return {
        id, name, host: '127.0.0.1', port: 22, protocol: 'SSH', username: 'u',
        password_encrypted: null, private_key_encrypted: null, group_id: null,
        use_private_key: false, rdp_width: 1920, rdp_height: 1080, rdp_fullscreen: false,
        domain: '', rdp_color_depth: 24, rdp_redirect_audio: false,
        rdp_redirect_printers: false, rdp_redirect_drives: false, ssh_tunnels: null,
        credential_profile_id: null, override_credentials: false, jump_host_id: null,
        use_ssh_agent: false, ssh_key_id: null, tags: null, last_connected_at: null,
        is_favorite: false, notes: null, use_ftps: false, rdp_nla: false,
        docker_transport: 'tcp', docker_socket_path: null,
        docker_tls_ca_path: null, docker_tls_cert_path: null, docker_tls_key_path: null,
        proxmox_api_token_id: null, proxmox_api_token_secret_encrypted: null,
        created_at: '', updated_at: '',
    };
}

function makeGroup(id: string, name = `grp-${id}`): Group {
    return { id, name, parent_id: null, sort_order: 0 };
}

function makeCreateReq(name: string): CreateConnectionRequest {
    return {
        name, host: '1.1.1.1', port: 22, protocol: 'SSH', username: 'u',
        password_encrypted: null, private_key_encrypted: null, group_id: null,
        use_private_key: false, rdp_width: null, rdp_height: null,
        rdp_fullscreen: null, domain: null, rdp_color_depth: null,
        rdp_redirect_audio: null, rdp_redirect_printers: null, rdp_redirect_drives: null,
        ssh_tunnels: null, credential_profile_id: null, override_credentials: null,
        jump_host_id: null, ssh_key_id: null, use_ssh_agent: null, tags: null,
        notes: null, use_ftps: null, rdp_nla: null, docker_transport: null,
        docker_socket_path: null, docker_tls_ca_path: null,
        docker_tls_cert_path: null, docker_tls_key_path: null,
        proxmox_api_token_id: null, proxmox_api_token_secret_encrypted: null,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
        connections: [], groups: [], searchQuery: '',
        editingConnection: null, editingGroup: null, loaded: false,
    });
});

// ── fetchConnections ─────────────────────────────────────────────────────────

describe('useConnectionStore — fetchConnections', () => {
    it('loads connections + groups in parallel and marks the store as loaded', async () => {
        mockedApi.getConnections.mockResolvedValueOnce([makeConn('a'), makeConn('b')]);
        mockedApi.getGroups.mockResolvedValueOnce([makeGroup('g1')]);

        await useConnectionStore.getState().fetchConnections();

        const s = useConnectionStore.getState();
        expect(s.connections).toHaveLength(2);
        expect(s.groups).toHaveLength(1);
        expect(s.loaded).toBe(true);
        expect(mockedApi.getConnections).toHaveBeenCalledTimes(1);
        expect(mockedApi.getGroups).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when the store is already loaded', async () => {
        mockedApi.getConnections.mockResolvedValue([]);
        mockedApi.getGroups.mockResolvedValue([]);
        await useConnectionStore.getState().fetchConnections();
        vi.clearAllMocks();
        await useConnectionStore.getState().fetchConnections();
        expect(mockedApi.getConnections).not.toHaveBeenCalled();
        expect(mockedApi.getGroups).not.toHaveBeenCalled();
    });
});

// ── CRUD: connections ────────────────────────────────────────────────────────

describe('useConnectionStore — connection CRUD', () => {
    it('createConnection calls the api and refreshes the connection list', async () => {
        mockedApi.createConnection.mockResolvedValueOnce('conn-new' as never);
        mockedApi.getConnections.mockResolvedValueOnce([makeConn('conn-new', 'New')]);
        const req = makeCreateReq('New');

        await useConnectionStore.getState().createConnection(req);

        expect(mockedApi.createConnection).toHaveBeenCalledWith(req);
        expect(useConnectionStore.getState().connections).toHaveLength(1);
        expect(useConnectionStore.getState().connections[0].name).toBe('New');
    });

    it('updateConnection refreshes the list and clears editingConnection', async () => {
        useConnectionStore.setState({ editingConnection: makeConn('a') });
        mockedApi.updateConnection.mockResolvedValueOnce(undefined as never);
        mockedApi.getConnections.mockResolvedValueOnce([makeConn('a', 'Renamed')]);

        const updateReq = { ...makeCreateReq('Renamed'), id: 'a' } as UpdateConnectionRequest;
        await useConnectionStore.getState().updateConnection(updateReq);

        expect(mockedApi.updateConnection).toHaveBeenCalledWith(updateReq);
        const s = useConnectionStore.getState();
        expect(s.editingConnection).toBeNull();
        expect(s.connections[0].name).toBe('Renamed');
    });

    it('deleteConnection refreshes the list', async () => {
        useConnectionStore.setState({
            connections: [makeConn('a'), makeConn('b')], loaded: true,
        });
        mockedApi.deleteConnection.mockResolvedValueOnce(undefined as never);
        mockedApi.getConnections.mockResolvedValueOnce([makeConn('b')]);

        await useConnectionStore.getState().deleteConnection('a');

        expect(mockedApi.deleteConnection).toHaveBeenCalledWith('a');
        expect(useConnectionStore.getState().connections).toHaveLength(1);
        expect(useConnectionStore.getState().connections[0].id).toBe('b');
    });
});

// ── CRUD: groups ─────────────────────────────────────────────────────────────

describe('useConnectionStore — group CRUD', () => {
    it('createGroup refreshes the group list', async () => {
        mockedApi.createGroup.mockResolvedValueOnce(makeGroup('g1') as never);
        mockedApi.getGroups.mockResolvedValueOnce([makeGroup('g1', 'Production')]);

        await useConnectionStore.getState().createGroup('Production', null);

        expect(mockedApi.createGroup).toHaveBeenCalledWith('Production', null);
        expect(useConnectionStore.getState().groups[0].name).toBe('Production');
    });

    it('updateGroup refreshes the list and clears editingGroup', async () => {
        useConnectionStore.setState({ editingGroup: makeGroup('g1') });
        mockedApi.updateGroup.mockResolvedValueOnce(undefined as never);
        mockedApi.getGroups.mockResolvedValueOnce([makeGroup('g1', 'Renamed')]);

        await useConnectionStore.getState().updateGroup('g1', 'Renamed');

        expect(useConnectionStore.getState().editingGroup).toBeNull();
        expect(useConnectionStore.getState().groups[0].name).toBe('Renamed');
    });

    it('deleteGroup refreshes the list', async () => {
        mockedApi.deleteGroup.mockResolvedValueOnce(undefined as never);
        mockedApi.getGroups.mockResolvedValueOnce([]);
        await useConnectionStore.getState().deleteGroup('g1');
        expect(mockedApi.deleteGroup).toHaveBeenCalledWith('g1');
        expect(useConnectionStore.getState().groups).toEqual([]);
    });
});

// ── resetForLock ─────────────────────────────────────────────────────────────

describe('useConnectionStore — resetForLock', () => {
    it('clears every piece of vault-bound state', () => {
        useConnectionStore.setState({
            connections: [makeConn('a')],
            groups: [makeGroup('g')],
            editingConnection: makeConn('a'),
            editingGroup: makeGroup('g'),
            loaded: true,
        });
        useConnectionStore.getState().resetForLock();
        const s = useConnectionStore.getState();
        expect(s.connections).toEqual([]);
        expect(s.groups).toEqual([]);
        expect(s.editingConnection).toBeNull();
        expect(s.editingGroup).toBeNull();
        expect(s.loaded).toBe(false);
    });
});

// ── Plain setters ────────────────────────────────────────────────────────────

describe('useConnectionStore — setters', () => {
    it('setSearchQuery, setEditingConnection, setEditingGroup are stored verbatim', () => {
        useConnectionStore.getState().setSearchQuery('prod');
        expect(useConnectionStore.getState().searchQuery).toBe('prod');

        const c = makeConn('a');
        useConnectionStore.getState().setEditingConnection(c);
        expect(useConnectionStore.getState().editingConnection).toBe(c);

        const g = makeGroup('g');
        useConnectionStore.getState().setEditingGroup(g);
        expect(useConnectionStore.getState().editingGroup).toBe(g);
    });

    it('setConnections / setGroups replace the lists', () => {
        useConnectionStore.getState().setConnections([makeConn('x')]);
        useConnectionStore.getState().setGroups([makeGroup('y')]);
        const s = useConnectionStore.getState();
        expect(s.connections).toHaveLength(1);
        expect(s.groups).toHaveLength(1);
    });
});
