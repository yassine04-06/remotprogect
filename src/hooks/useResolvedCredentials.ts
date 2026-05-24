/**
 * CRIT-A4: this hook is intentionally removed.
 *
 * Credentials are now resolved server-side inside each *_connect Tauri command
 * (ssh_connect, vnc_native_connect, rdp_connect, sftp_*, ftp_*).
 * The frontend never receives plaintext passwords.
 *
 * This file is kept as an empty stub so that any stale imports surface as
 * TypeScript errors rather than silent runtime failures during the migration.
 */

// No exports — all callers must be updated to pass only `connectionId`.
