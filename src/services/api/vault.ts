import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { VaultStatus, ExportData } from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── Vault ────────────────────────────────────────────────

export const isVaultUnlocked = () => invoke<VaultStatus>('is_vault_unlocked');
// MED-A7: separated from VaultStatus so each call has a single clear purpose
export const isFirstRun = () => invoke<boolean>('is_first_run');

export const setMasterPassword = (password: string) =>
    invoke('set_master_password', { request: { password } });

export const unlockVault = (password: string) => invoke('unlock_vault', { request: { password } });

export const lockVault = () => invoke('lock_vault');

export const changeMasterPassword = (oldPassword: string, newPassword: string) =>
    invoke('change_master_password', { request: { old_password: oldPassword, new_password: newPassword } });

/**
 * Configure the idle auto-lock timeout.
 * @param secs Seconds of inactivity before the vault locks automatically. 0 = disabled.
 */
export const setAutoLockTimeout = (secs: number) => invoke('set_auto_lock_timeout', { secs });

// MED-A11: allow-multiple-instances setting (requires restart to take effect)
export const getAllowMultipleInstances = () =>
    invoke<boolean>('get_allow_multiple_instances');

export const setAllowMultipleInstances = (allow: boolean) =>
    invoke<void>('set_allow_multiple_instances', { allow });

// ── Export / Import ──────────────────────────────────────

export const exportConnections = () => invoke<ExportData>('export_connections');

export const importConnections = (data: ExportData) => invoke('import_connections', { data });

// 90-23: Filesystem-based vault export/import
export const vaultExportFile = (path: string) => invoke<void>('vault_export_file', { path });
export const vaultImportFile = (path: string) => invoke<void>('vault_import_file', { path });

// Export connection metadata as CSV (no passwords)
export const exportConnectionsCsv = (path: string) =>
    invoke<void>('export_connections_csv', { path });
