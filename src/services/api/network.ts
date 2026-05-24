import { invoke as tauriInvoke } from '@tauri-apps/api/core';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── Network ──────────────────────────────────────────────

// Fire-and-forget — results stream via `network:progress:{scanId}` Tauri events.
export const scanNetwork = (
    scanId: string,
    startIp: string,
    endIp: string,
    ports: number[],
    timeoutMs: number
) => invoke<void>('scan_network', { scanId, startIp, endIp, ports, timeoutMs });

// LOW-A8: pass scan_id so only the targeted scan is cancelled (concurrent scans allowed)
export const cancelNetworkScan = (scanId: string) =>
    invoke<void>('cancel_network_scan', { scanId });

export const pingServer = (host: string, port: number) =>
    invoke<number>('ping_server', { host, port });
