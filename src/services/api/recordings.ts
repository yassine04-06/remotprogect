import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { RecordingInfo } from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── Session Recording (90-3) ─────────────────────────────

export const sshRecordingStart = (sessionId: string, cols: number, rows: number) =>
    invoke<void>('ssh_recording_start', { sessionId, cols, rows });

export const sshRecordingStop = (sessionId: string) =>
    invoke<string>('ssh_recording_stop', { sessionId });

export const sshRecordingList = () => invoke<RecordingInfo[]>('ssh_recording_list');

// LOW-9: Read raw asciinema v2 content of a recording file
export const sshRecordingRead = (filename: string) =>
    invoke<string>('ssh_recording_read', { filename });
