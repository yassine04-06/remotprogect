/**
 * M-1: useTabStore unit tests
 *
 * Covers the tab model + M-2 MRU tracking:
 *   - addTab / openTab / closeTab semantics
 *   - activeTabId updates correctly on close
 *   - lastActiveAt timestamp is updated on every activation
 *     (drives App.tsx's MRU-mount decision)
 *   - lastActiveAt is pruned when a tab closes
 *   - closeAllTabs clears everything
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useTabStore } from './useTabStore';
import type { ServerConnection } from '../types';

function makeConnection(id: string, name = 'srv'): ServerConnection {
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
        proxmox_api_token_id: null, proxmox_api_token_secret_encrypted: null, mac_address: null,
        created_at: '', updated_at: '',
    };
}

beforeEach(() => {
    // Reset the store between tests so state doesn't leak across cases.
    useTabStore.setState({
        tabs: [], activeTabId: null, splitTabId: null, splitDirection: 'h',
        lastActiveAt: {}, isBroadcastMode: false,
    });
});

describe('useTabStore — basic flow', () => {
    it('starts empty', () => {
        const s = useTabStore.getState();
        expect(s.tabs).toEqual([]);
        expect(s.activeTabId).toBeNull();
        expect(s.lastActiveAt).toEqual({});
    });

    it('openTab adds a tab and activates it', () => {
        useTabStore.getState().openTab(makeConnection('c1', 'Alpha'));
        const s = useTabStore.getState();
        expect(s.tabs).toHaveLength(1);
        expect(s.tabs[0].connectionName).toBe('Alpha');
        expect(s.activeTabId).toBe(s.tabs[0].id);
        // M-2: lastActiveAt populated for the new tab
        expect(s.lastActiveAt[s.tabs[0].id]).toBeGreaterThan(0);
    });

    it('openTab is idempotent — same connection re-activates the existing tab', () => {
        const conn = makeConnection('c1');
        useTabStore.getState().openTab(conn);
        const firstTabId = useTabStore.getState().tabs[0].id;
        useTabStore.getState().openTab(conn);
        const s = useTabStore.getState();
        expect(s.tabs).toHaveLength(1);
        expect(s.activeTabId).toBe(firstTabId);
    });

    it('closeTab removes the tab, activates a sibling, and prunes lastActiveAt', () => {
        const store = useTabStore.getState();
        store.openTab(makeConnection('c1', 'A'));
        store.openTab(makeConnection('c2', 'B'));
        store.openTab(makeConnection('c3', 'C'));
        const ids = useTabStore.getState().tabs.map(t => t.id);
        store.closeTab(ids[1]);                       // close the middle one
        const s = useTabStore.getState();
        expect(s.tabs.map(t => t.id)).toEqual([ids[0], ids[2]]);
        expect(s.lastActiveAt[ids[1]]).toBeUndefined();  // pruned
    });

    it('closeAllTabs wipes everything including lastActiveAt', () => {
        const store = useTabStore.getState();
        store.openTab(makeConnection('c1'));
        store.openTab(makeConnection('c2'));
        store.closeAllTabs();
        const s = useTabStore.getState();
        expect(s.tabs).toEqual([]);
        expect(s.activeTabId).toBeNull();
        expect(s.lastActiveAt).toEqual({});
    });
});

describe('useTabStore — MRU lastActiveAt (M-2)', () => {
    it('setActiveTab refreshes the timestamp of the activated tab', async () => {
        const store = useTabStore.getState();
        store.openTab(makeConnection('c1'));
        store.openTab(makeConnection('c2'));
        const [t1, t2] = useTabStore.getState().tabs;
        const initial = useTabStore.getState().lastActiveAt[t1.id];

        // Give Date.now() a tick so the new timestamp is strictly greater.
        await new Promise(r => setTimeout(r, 5));
        store.setActiveTab(t1.id);
        const updated = useTabStore.getState().lastActiveAt[t1.id];
        expect(updated).toBeGreaterThan(initial);
        // t2 is untouched
        expect(useTabStore.getState().lastActiveAt[t2.id]).toBeDefined();
    });

    it('setActiveTabId also bumps the activity timestamp', async () => {
        const store = useTabStore.getState();
        store.openTab(makeConnection('c1'));
        const id = useTabStore.getState().tabs[0].id;
        const before = useTabStore.getState().lastActiveAt[id];
        await new Promise(r => setTimeout(r, 5));
        store.setActiveTabId(id);
        expect(useTabStore.getState().lastActiveAt[id]).toBeGreaterThan(before);
    });

    it('lastActiveAt order matches activation order — newest tabs come first', async () => {
        const store = useTabStore.getState();
        store.openTab(makeConnection('c1'));
        await new Promise(r => setTimeout(r, 5));
        store.openTab(makeConnection('c2'));
        await new Promise(r => setTimeout(r, 5));
        store.openTab(makeConnection('c3'));

        const { tabs, lastActiveAt } = useTabStore.getState();
        const sorted = [...tabs].sort(
            (a, b) => (lastActiveAt[b.id] ?? 0) - (lastActiveAt[a.id] ?? 0)
        );
        expect(sorted.map(t => t.connectionId)).toEqual(['c3', 'c2', 'c1']);
    });

    it('after closing the active tab, the sibling that takes over gets a fresh timestamp', async () => {
        const store = useTabStore.getState();
        store.openTab(makeConnection('c1'));
        await new Promise(r => setTimeout(r, 5));
        store.openTab(makeConnection('c2'));
        const [t1, t2] = useTabStore.getState().tabs;
        // t2 is currently active. Close it and ensure t1 (the sibling) gets a refreshed timestamp.
        const oldT1Ts = useTabStore.getState().lastActiveAt[t1.id];
        await new Promise(r => setTimeout(r, 5));
        store.closeTab(t2.id);
        const s = useTabStore.getState();
        expect(s.activeTabId).toBe(t1.id);
        expect(s.lastActiveAt[t1.id]).toBeGreaterThan(oldT1Ts);
    });
});

describe('useTabStore — broadcast & split', () => {
    it('toggles broadcast mode', () => {
        useTabStore.getState().setBroadcastMode(true);
        expect(useTabStore.getState().isBroadcastMode).toBe(true);
        useTabStore.getState().setBroadcastMode(false);
        expect(useTabStore.getState().isBroadcastMode).toBe(false);
    });

    it('setSplitTab stores the partner and direction', () => {
        useTabStore.getState().setSplitTab('tab-x', 'v');
        const s = useTabStore.getState();
        expect(s.splitTabId).toBe('tab-x');
        expect(s.splitDirection).toBe('v');
    });

    it('updateTabStatus changes only the targeted tab', () => {
        const store = useTabStore.getState();
        store.openTab(makeConnection('c1'));
        store.openTab(makeConnection('c2'));
        const [t1, t2] = useTabStore.getState().tabs;
        store.updateTabStatus(t1.id, 'connected');
        const s = useTabStore.getState();
        expect(s.tabs.find(t => t.id === t1.id)?.status).toBe('connected');
        expect(s.tabs.find(t => t.id === t2.id)?.status).toBe('idle');
    });
});
