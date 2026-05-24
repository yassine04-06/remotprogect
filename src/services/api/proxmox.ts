import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { ProxmoxAuthResponse, ProxmoxResource, ProxmoxPinnedCert } from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── Proxmox ──────────────────────────────────────────────

// CRIT-A4: host/port/username/password resolved server-side from connectionId.
export const proxmoxAuth = (connectionId: string) =>
    invoke<ProxmoxAuthResponse>('proxmox_auth', { connectionId });

export const proxmoxGetResources = (host: string, port: number, ticket: string) =>
    invoke<ProxmoxResource[]>('proxmox_get_resources', { host, port, ticket });

// 90-15: Proxmox API token auth — CRIT-A4: token secret decrypted server-side.
export const proxmoxAuthToken = (connectionId: string) =>
    invoke<ProxmoxResource[]>('proxmox_auth_token', { connectionId });

export const proxmoxGetFingerprint = (host: string, port: number) =>
    invoke<string>('proxmox_get_fingerprint', { host, port });

export const proxmoxVmAction = (
    host: string,
    port: number,
    ticket: string,
    csrf: string,
    node: string,
    vmid: string,
    vmType: string,
    action: string
) => invoke<string>('proxmox_vm_action', { host, port, ticket, csrf, node, vmid, vmType, action });

export const proxmoxOpenConsole = (url: string, label: string, title: string, ticket: string) =>
    invoke('proxmox_open_console', { url, label, title, ticket });

// MED-A8: TOFU cert management — list and forget pinned Proxmox server certs.
export const proxmoxListPinnedCerts = () =>
    invoke<ProxmoxPinnedCert[]>('proxmox_list_pinned_certs');

export const proxmoxForgetCert = (hostKey: string) =>
    invoke<void>('proxmox_forget_cert', { hostKey });
