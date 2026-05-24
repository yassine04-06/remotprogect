import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { RdpAvailability } from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── RDP ──────────────────────────────────────────────────

export const rdpCheckAvailable = () => invoke<RdpAvailability>('rdp_check_available');

/**
 * CRIT-A4: `connectionId` replaces `host`, `port`, `username`, `password`, `domain`.
 * Credentials are resolved server-side; plaintext passwords never cross the IPC boundary.
 */
export const rdpConnect = (
    sessionId: string,
    connectionId: string,
    width?: number,
    height?: number,
    fullscreen?: boolean,
    color_depth?: number,
    audio?: boolean,
    printers?: boolean,
    drives?: boolean
) =>
    invoke<string>('rdp_connect', {
        sessionId,
        connectionId,
        width: width ?? 1920,
        height: height ?? 1080,
        fullscreen: fullscreen ?? false,
        colorDepth: color_depth ?? 24,
        audio: audio ?? false,
        printers: printers ?? false,
        drives: drives ?? false,
    });

export const rdpDisconnect = (sessionId: string) => invoke('rdp_disconnect', { sessionId });

export const rdpEmbedWindow = (sessionId: string) =>
    invoke<boolean>('rdp_embed_window', { sessionId });

/**
 * @param dpr  Pass `window.devicePixelRatio` here — JS already has the updated
 *             value when onScaleChanged fires, whereas Rust's window.scale_factor()
 *             may still return the old value for a few frames after a monitor switch.
 *             Rust uses this value to convert logical CSS coords → physical px.
 */
export const rdpResizeEmbedded = (
    sessionId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    dpr: number,
) => invoke('rdp_resize_embedded', { sessionId, x, y, width, height, dpr });

export const rdpSetVisibility = (sessionId: string, visible: boolean) =>
    invoke('rdp_set_visibility', { sessionId, visible });

export const rdpFocus = (sessionId: string) => invoke('rdp_focus', { sessionId });

export const rdpSendInput = (sessionId: string, command: string) =>
    invoke('rdp_send_command', { sessionId, command });

export const rdpIsWindowAlive = (sessionId: string) =>
    invoke<boolean>('rdp_is_window_alive', { sessionId });
