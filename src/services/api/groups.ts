import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { Group } from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── Groups ───────────────────────────────────────────────

export const getGroups = () => invoke<Group[]>('get_groups');

export const createGroup = (name: string, parentId?: string | null) =>
    invoke<Group>('create_group', { name, parentId: parentId ?? null });

export const updateGroup = (id: string, name: string) => invoke('update_group', { id, name });

export const deleteGroup = (id: string) => invoke('delete_group', { id });
