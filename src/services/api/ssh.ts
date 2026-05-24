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

// ── SSH ──────────────────────────────────────────────────

/**
 * CRIT-A4: `connectionId` replaces all explicit auth params.
 * The backend looks up host/port/credentials server-side;
 * plaintext passwords never cross the Tauri IPC boundary.
 *
 * `passphrase` is optional.  Omit it (or pass undefined) on the first call.
 * If the backend returns `{ code: "KEY_ENCRYPTED" }`, show a passphrase prompt
 * and call this function again with the user-supplied passphrase.
 */
export const sshConnect = (
    sessionId: string,
    connectionId: string,
    passphrase?: string,
) =>
    invoke('ssh_connect', {
        sessionId,
        connectionId,
        passphrase: passphrase ?? null,
    });

export const sshSendInput = (sessionId: string, data: string) =>
    invoke('ssh_send_input', { sessionId, data });

// H-1: propagate terminal window size to the remote PTY so vim/htop/tmux render correctly.
export const sshResize = (sessionId: string, rows: number, cols: number) =>
    invoke('ssh_resize', { sessionId, rows, cols });

export const sshDisconnect = (sessionId: string) => invoke('ssh_disconnect', { sessionId });

// ── SSH host-key TOFU (NXS-001) ──────────────────────────
// Three-step flow that callers should follow BEFORE ssh_connect / sftp_*:
//   1. probe → returns { key_type, raw_key_b64, verify: VerifyResult }
//   2. if verify.outcome === 'unknown' → user accepts fingerprint → trust(...)
//   3. if verify.outcome === 'mismatch' → REFUSE to connect, surface MITM warning
//   4. if verify.outcome === 'trusted' → proceed with the actual connection

export type HostKeyVerifyResult =
    | { outcome: 'trusted' }
    | { outcome: 'unknown'; fingerprint_sha256: string; key_type: string }
    | {
          outcome: 'mismatch';
          fingerprint_sha256: string;
          key_type: string;
          stored_fingerprint_sha256: string;
          stored_key_type: string;
      };

export interface ProbedHostKey {
    key_type: string;
    raw_key_b64: string;
    verify: HostKeyVerifyResult;
}

export const sshProbeHostKey = (host: string, port: number) =>
    invoke<ProbedHostKey>('ssh_probe_host_key', { host, port });

export const sshTrustHostKey = (
    host: string,
    port: number,
    keyType: string,
    rawKeyB64: string
) => invoke<void>('ssh_trust_host_key', { host, port, keyType, rawKeyB64 });

export const sshForgetHostKey = (host: string, port: number) =>
    invoke<void>('ssh_forget_host_key', { host, port });
