import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { SshKey, CreateSshKeyRequest } from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── SSH Key Manager (90-1) ───────────────────────────────

export const sshKeyList = () => invoke<SshKey[]>('ssh_key_list');

export const sshKeyCreate = (request: CreateSshKeyRequest) =>
    invoke<SshKey>('ssh_key_create', { request });

export const sshKeyDelete = (id: string) => invoke<void>('ssh_key_delete', { id });

export const sshKeyGenerate = (name: string, keyType: 'ed25519' | 'rsa', comment?: string) =>
    invoke<SshKey>('ssh_key_generate', { name, keyType, comment: comment ?? null });

export const sshKeyImport = (
    name: string,
    privateKey: string,
    passphrase?: string | null
) => invoke<SshKey>('ssh_key_import', { name, privateKey, passphrase: passphrase ?? null });
