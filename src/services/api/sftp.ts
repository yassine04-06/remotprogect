import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { FileListResult } from '../../types';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── SFTP ─────────────────────────────────────────────────
// CRIT-A4: all commands take `connectionId` instead of explicit auth params.
// The backend resolves host/port/credentials server-side.

export const sftpListDir = (connectionId: string, path: string = '/') =>
    invoke<FileListResult>('sftp_list_dir', { connectionId, path });

export const sftpUpload = (
    connectionId: string,
    remote_path: string = '',
    local_path: string = '',
    transfer_id: string = '',
    resume: boolean = true
) =>
    invoke('sftp_upload', {
        connectionId,
        remotePath: remote_path,
        localPath: local_path,
        transferId: transfer_id,
        resume,
    });

export const sftpDownload = (
    connectionId: string,
    remote_path: string = '',
    local_path: string = '',
    transfer_id: string = '',
    resume: boolean = true
) =>
    invoke('sftp_download', {
        connectionId,
        remotePath: remote_path,
        localPath: local_path,
        transferId: transfer_id,
        resume,
    });

export const sftpDelete = (
    connectionId: string,
    path: string = '',
    is_dir: boolean = false
) =>
    invoke('sftp_delete', { connectionId, path, isDir: is_dir });

export const sftpRename = (
    connectionId: string,
    old_path: string = '',
    new_path: string = ''
) =>
    invoke('sftp_rename', { connectionId, oldPath: old_path, newPath: new_path });

export const sftpMkdir = (connectionId: string, path: string = '') =>
    invoke('sftp_mkdir', { connectionId, path });

/** MED-A3: explicitly evict the SFTP pool entry for `connectionId`.
 *  Call this when the FileManagerView unmounts so the idle TCP socket is
 *  closed immediately instead of waiting for the 60-minute TTL sweep. */
export const sftpDisconnect = (connectionId: string) =>
    invoke('sftp_disconnect', { connectionId });

// ── FTP ──────────────────────────────────────────────────
// CRIT-A4: all commands take `connectionId` instead of explicit auth params.
// `use_ftps` is now read from the connection record server-side.

export const ftpListDir = (connectionId: string, path: string = '/') =>
    invoke<FileListResult>('ftp_list_dir', { connectionId, path });

export const ftpUpload = (
    connectionId: string,
    remote_path: string = '',
    local_path: string = '',
    transfer_id: string = '',
    resume: boolean = true
) =>
    invoke('ftp_upload', {
        connectionId,
        remotePath: remote_path,
        localPath: local_path,
        transferId: transfer_id,
        resume,
    });

export const ftpDownload = (
    connectionId: string,
    remote_path: string = '',
    local_path: string = '',
    transfer_id: string = '',
    resume: boolean = true
) =>
    invoke('ftp_download', {
        connectionId,
        remotePath: remote_path,
        localPath: local_path,
        transferId: transfer_id,
        resume,
    });

export const ftpDelete = (
    connectionId: string,
    path: string = '',
    is_dir: boolean = false
) =>
    invoke('ftp_delete', { connectionId, path, isDir: is_dir });

export const ftpRename = (
    connectionId: string,
    old_path: string = '',
    new_path: string = ''
) =>
    invoke('ftp_rename', { connectionId, oldPath: old_path, newPath: new_path });

export const ftpMkdir = (connectionId: string, path: string = '') =>
    invoke('ftp_mkdir', { connectionId, path });
