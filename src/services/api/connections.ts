import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type {
    ConnectionSummary,
    ServerConnection,
    CreateConnectionRequest,
    UpdateConnectionRequest,
} from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── Connections ──────────────────────────────────────────

export const getConnections = () => invoke<ServerConnection[]>('get_connections');

/** Lightweight summary for sidebar rendering. No credentials or RDP config. */
export const getConnectionsSummary = () => invoke<ConnectionSummary[]>('get_connections_summary');

export const createConnection = (request: CreateConnectionRequest) =>
    invoke<ServerConnection>('create_connection', { request });

export const updateConnection = (request: UpdateConnectionRequest) =>
    invoke('update_connection', { request });

export const deleteConnection = (id: string) => invoke('delete_connection', { id });

// ── 90-7: Favorites & recently used ──────────────────────

export const toggleFavorite = (id: string) => invoke<boolean>('toggle_favorite', { id });
export const updateLastConnected = (id: string) => invoke<void>('update_last_connected', { id });

// ── 90-9: Drag & drop group assignment ───────────────────

export const updateConnectionGroup = (connectionId: string, groupId: string | null) =>
    invoke<void>('update_connection_group', { connectionId, groupId });
