import { invoke } from '@tauri-apps/api/core';
import type { ImportedConnection } from '../../types/generated';

/** Open a native file-picker dialog (runs on the Rust side). */
export const pickImportFile = (filterName: string, extensions: string[]) =>
    invoke<string | null>('import_pick_file', { filterName, extensions });

/** Parse a single .rdp file. Returns an array with one entry on success. */
export const importRdpFile = (path: string) =>
    invoke<ImportedConnection[]>('import_rdp_file', { path });

/** Scan the Windows registry for PuTTY sessions (no-op on non-Windows). */
export const importPuttySessions = () =>
    invoke<ImportedConnection[]>('import_putty_sessions');

/**
 * Parse a mRemoteNG confCons.xml file.
 * @param password Master password (default "mR3m" if omitted).
 */
export const importMremoteng = (path: string, password?: string) =>
    invoke<ImportedConnection[]>('import_mremoteng', {
        path,
        password: password ?? null,
    });

/**
 * Parse an OpenSSH `~/.ssh/config` file (or a custom path).
 * Pass `undefined` to use the default location.
 */
export const importSshConfig = (path?: string) =>
    invoke<ImportedConnection[]>('import_ssh_config', {
        path: path ?? null,
    });

/**
 * Parse a Devolutions Remote Desktop Manager XML export (.rdm).
 * Supports RdpVersion*, SSHShell, SSH2Shell, VNC, SFTP, FTP connection types.
 */
export const importRdm = (path: string) =>
    invoke<ImportedConnection[]>('import_rdm', { path });

/**
 * Parse a RoyalTS export (.rtsx plain XML or .rtsz ZIP-compressed XML).
 * Supports RoyalRDSConnection, RoyalSSHConnection, RoyalVNCConnection,
 * RoyalSFTPConnection, RoyalFTPConnection.
 */
export const importRoyalts = (path: string) =>
    invoke<ImportedConnection[]>('import_royalts', { path });

/** Persist a pre-filtered list of ImportedConnection to the vault database. */
export const bulkImportConnections = (connections: ImportedConnection[]) =>
    invoke<number>('bulk_import_connections', { connections });

/**
 * Parse a NexoRC vault JSON export and return connections as ImportedConnection[].
 * Passwords are NOT transferred — user must re-enter them after import.
 */
export const importNexorcJson = (path: string) =>
    invoke<ImportedConnection[]>('import_nexorc_json', { path });
