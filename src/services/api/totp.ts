import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { TotpCode } from '../../types';

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── 2FA / TOTP (M5) ──────────────────────────────────────

export const totpAdd = (label: string, secretB32: string) =>
    invoke<void>('totp_add', { label, secretB32 });

export const totpList = () => invoke<TotpCode[]>('totp_list');

export const totpDelete = (id: string) => invoke<void>('totp_delete', { id });
