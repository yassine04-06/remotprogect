import { invoke as tauriInvoke } from '@tauri-apps/api/core';

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── Telnet ───────────────────────────────────────────────

export const telnetConnect = (sessionId: string, host: string, port: number) =>
    invoke<void>('telnet_connect', { sessionId, host, port });

export const telnetSend = (sessionId: string, data: string) =>
    invoke<void>('telnet_send', { sessionId, data });

export const telnetDisconnect = (sessionId: string) =>
    invoke<void>('telnet_disconnect', { sessionId });
