import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { VncAvailability } from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── VNC ──────────────────────────────────────────────────

export const vncCheckAvailable = () => invoke<VncAvailability>('vnc_check_availability');

export const vncConnect = (sessionId: string, host: string, port: number, password?: string) =>
    invoke<string>('vnc_connect', {
        sessionId,
        host,
        port,
        password: password ?? null,
    });

// 90-11: native VNC (RFB 3.8 in-process, streams vnc:* events)
// CRIT-A4: `connectionId` replaces `host`, `port`, `password` — resolved server-side.
export const vncNativeConnect = (sessionId: string, connectionId: string) =>
    invoke<void>('vnc_native_connect', { sessionId, connectionId });

export const vncNativeDisconnect = (sessionId: string) =>
    invoke<void>('vnc_native_disconnect', { sessionId });

export const vncNativeKeyEvent = (sessionId: string, key: number, down: boolean) =>
    invoke<void>('vnc_native_key_event', { sessionId, key, down });
