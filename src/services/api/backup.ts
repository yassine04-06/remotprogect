import { invoke as tauriInvoke } from '@tauri-apps/api/core';

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── Vault backup / restore (MED-A10) ─────────────────────

// Returns the number of files written into the backup archive.
export const vaultBackup = (target: string) =>
    invoke<number>('vault_backup', { target });

// Returns the number of files restored. App must be restarted afterwards.
export const vaultRestore = (source: string) =>
    invoke<number>('vault_restore', { source });
