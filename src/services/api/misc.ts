import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { ToolResult, AuditEntry, AuditVerifyResult } from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── 30-18: Update check ──────────────────────────────────

export interface UpdateInfo {
    available: boolean;
    version?: string;
    notes?: string;
    date?: string;
}

export const checkForUpdate = () => invoke<UpdateInfo>('check_for_update');

// ── External Tools (whitelisted, NXS-002) ────────────────
// Only the tool IDs hardcoded in the Rust backend are accepted:
//   "ping" | "traceroute" | "dns_lookup"
// The target string is validated server-side (hostname / IP only).

export type PredefinedToolId = 'ping' | 'traceroute' | 'dns_lookup';

export const runPredefinedTool = (toolId: PredefinedToolId, target: string) =>
    invoke<ToolResult>('run_predefined_tool', { toolId, target });

// ── Local Shell ──────────────────────────────────────────

export const shellSpawn = (sessionId: string) => invoke('shell_spawn', { sessionId });

export const shellSendInput = (sessionId: string, data: string) =>
    invoke('shell_send_input', { sessionId, data });

export const shellDisconnect = (sessionId: string) => invoke('shell_disconnect', { sessionId });

export const shellResize = (sessionId: string, rows: number, cols: number) =>
    invoke('shell_resize', { sessionId, rows, cols });

// ── 90-10: Audit log ─────────────────────────────────────

export const auditLogList = (limit?: number, offset?: number) =>
    invoke<AuditEntry[]>('audit_log_list', { limit: limit ?? 200, offset: offset ?? 0 });

/** CRIT-A3: verify hash-chain integrity of the entire audit log. */
export const auditLogVerify = () =>
    invoke<AuditVerifyResult>('audit_log_verify');
