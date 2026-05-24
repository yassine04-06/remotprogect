import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { DockerContainer } from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── Docker ───────────────────────────────────────────────
// H-3: optional TLS paths are forwarded so the backend can build a
// mutual-TLS client for the 'https' transport. They are ignored for tcp/socket.

export const dockerGetContainers = (
    host: string,
    port: number,
    transport?: 'tcp' | 'socket' | 'https' | null,
    socketPath?: string | null,
    tlsCaPath?: string | null,
    tlsCertPath?: string | null,
    tlsKeyPath?: string | null,
) =>
    invoke<DockerContainer[]>('docker_get_containers', {
        host,
        port,
        transport: transport ?? null,
        socketPath: socketPath ?? null,
        tlsCaPath: tlsCaPath ?? null,
        tlsCertPath: tlsCertPath ?? null,
        tlsKeyPath: tlsKeyPath ?? null,
    });

export const dockerContainerAction = (
    host: string,
    port: number,
    containerId: string,
    action: string,
    transport?: 'tcp' | 'socket' | 'https' | null,
    socketPath?: string | null,
    tlsCaPath?: string | null,
    tlsCertPath?: string | null,
    tlsKeyPath?: string | null,
) =>
    invoke<string>('docker_container_action', {
        host,
        port,
        containerId,
        action,
        transport: transport ?? null,
        socketPath: socketPath ?? null,
        tlsCaPath: tlsCaPath ?? null,
        tlsCertPath: tlsCertPath ?? null,
        tlsKeyPath: tlsKeyPath ?? null,
    });

export const dockerGetLogs = (
    host: string,
    port: number,
    containerId: string,
    tail?: number,
    transport?: 'tcp' | 'socket' | 'https' | null,
    socketPath?: string | null,
    tlsCaPath?: string | null,
    tlsCertPath?: string | null,
    tlsKeyPath?: string | null,
) =>
    invoke<string>('docker_get_logs', {
        host,
        port,
        containerId,
        tail,
        transport: transport ?? null,
        socketPath: socketPath ?? null,
        tlsCaPath: tlsCaPath ?? null,
        tlsCertPath: tlsCertPath ?? null,
        tlsKeyPath: tlsKeyPath ?? null,
    });

// Returns the exec_id (needed for resize requests)
export const dockerExecStart = (
    host: string,
    port: number,
    containerId: string,
    sessionId: string,
    transport?: 'tcp' | 'socket' | 'https' | null,
    tlsCaPath?: string | null,
    tlsCertPath?: string | null,
    tlsKeyPath?: string | null,
) =>
    invoke<string>('docker_exec_start', {
        host,
        port,
        containerId,
        sessionId,
        transport: transport ?? null,
        tlsCaPath: tlsCaPath ?? null,
        tlsCertPath: tlsCertPath ?? null,
        tlsKeyPath: tlsKeyPath ?? null,
    });

export const dockerExecInput = (sessionId: string, data: string) =>
    invoke<void>('docker_exec_input', { sessionId, data });

export const dockerExecResize = (
    host: string,
    port: number,
    execId: string,
    rows: number,
    cols: number,
    transport?: 'tcp' | 'socket' | 'https' | null,
    tlsCaPath?: string | null,
    tlsCertPath?: string | null,
    tlsKeyPath?: string | null,
) =>
    invoke<void>('docker_exec_resize', {
        host,
        port,
        execId,
        rows,
        cols,
        transport: transport ?? null,
        tlsCaPath: tlsCaPath ?? null,
        tlsCertPath: tlsCertPath ?? null,
        tlsKeyPath: tlsKeyPath ?? null,
    });

export const dockerExecStop = (sessionId: string) =>
    invoke<void>('docker_exec_stop', { sessionId });
