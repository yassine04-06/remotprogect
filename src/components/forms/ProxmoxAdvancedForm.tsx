// MED-5: Updated to accept typed ProxmoxFields slice instead of full CreateConnectionRequest
import type { ServerConnection } from '../../types';
import type { ProxmoxFields } from '../../hooks/useConnectionFormState';

interface Props {
    proxmox: ProxmoxFields;
    setProxmox: <K extends keyof ProxmoxFields>(k: K, v: ProxmoxFields[K]) => void;
    editConnection?: ServerConnection | null;
}

export function ProxmoxAdvancedForm({ proxmox, setProxmox, editConnection }: Props) {
    return (
        <div className="space-y-3">
            <label className="text-[10px] font-bold text-text-muted uppercase ml-1">
                API Token Auth (optional, overrides password)
            </label>
            <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-bold text-text-muted ml-1 uppercase">
                    Token ID (user@realm!tokenname)
                </label>
                <input
                    type="text"
                    className="h-9 bg-base border border-border rounded-lg px-3 text-xs font-mono focus:outline-none focus:border-accent/50"
                    value={proxmox.proxmox_api_token_id ?? ''}
                    onChange={e => setProxmox('proxmox_api_token_id', e.target.value || null)}
                    placeholder="root@pam!mytoken"
                    aria-label="Proxmox API token ID"
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <label className="text-[9px] font-bold text-text-muted ml-1 uppercase">
                    Token Secret (UUID)
                </label>
                <input
                    type="password"
                    className="h-9 bg-base border border-border rounded-lg px-3 text-xs font-mono focus:outline-none focus:border-accent/50"
                    value={proxmox.proxmox_api_token_secret_encrypted ?? ''}
                    onChange={e => setProxmox('proxmox_api_token_secret_encrypted', e.target.value || null)}
                    placeholder={editConnection?.proxmox_api_token_secret_encrypted ? '(stored)' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
                    aria-label="Proxmox API token secret"
                />
            </div>
        </div>
    );
}
