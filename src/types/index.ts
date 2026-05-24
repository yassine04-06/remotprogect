// All backend-mirrored types are auto-generated from Rust structs.
// Run `npm run generate-types` to refresh after changing Rust structs.
export * from './generated';

import type { ServerConnection } from './generated';

// ── Frontend-only types (no Rust equivalent) ──────────────────────────────

export type TabStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface Tab {
    id: string;
    connectionId: string;
    connectionName: string;
    protocol: 'SSH' | 'RDP' | 'VNC' | 'LOCAL' | 'SFTP' | 'FTP' | 'PROXMOX' | 'DOCKER';
    status: TabStatus;
    connection?: ServerConnection;
}
