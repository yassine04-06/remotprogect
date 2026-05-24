import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type {
    SavedCommand,
    CreateSavedCommandRequest,
    UpdateSavedCommandRequest,
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

// ── Saved Commands ───────────────────────────────────────

export const createSavedCommand = (request: CreateSavedCommandRequest) =>
    invoke<SavedCommand>('create_saved_command', { request });

export const getSavedCommands = () => invoke<SavedCommand[]>('get_saved_commands');

export const updateSavedCommand = (request: UpdateSavedCommandRequest) =>
    invoke<SavedCommand>('update_saved_command', { request });

export const deleteSavedCommand = (id: string) => invoke<void>('delete_saved_command', { id });
