import { useState } from 'react';
import { useTabStore, useConnectionStore, useUIStore } from '../store';
import * as api from '../services/api';
import { Zap, ChevronRight } from 'lucide-react';

export function QuickConnectBar() {
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const openTab = useTabStore(s => s.openTab);
    const setConnections = useConnectionStore(s => s.setConnections);
    const addToast = useUIStore(s => s.addToast);

    const handleConnect = async () => {
        if (!input || busy) return;

        let protocol: 'SSH' | 'RDP' | 'VNC' = 'SSH';
        let host: string;
        let username = 'root';
        let port: number;

        // Simple parser for quick connect strings: [proto://][user@]host[:port]
        let remaining = input;

        if (remaining.includes('://')) {
            const parts = remaining.split('://');
            const p = parts[0].toUpperCase();
            if (p === 'SSH' || p === 'RDP' || p === 'VNC') protocol = p as 'SSH' | 'RDP' | 'VNC';
            remaining = parts[1];
        }

        if (remaining.includes('@')) {
            const parts = remaining.split('@');
            username = parts[0];
            remaining = parts[1];
        }

        if (remaining.includes(':')) {
            const parts = remaining.split(':');
            host = parts[0];
            port =
                parseInt(parts[1]) || (protocol === 'SSH' ? 22 : protocol === 'RDP' ? 3389 : 5900);
        } else {
            host = remaining;
            port = protocol === 'SSH' ? 22 : protocol === 'RDP' ? 3389 : 5900;
        }

        if (!host) {
            addToast({ type: 'error', title: 'Quick Connect', description: 'Invalid host.' });
            return;
        }

        // CRIT-A4: the backend resolves all session params from the DB by
        // connectionId. A purely in-memory transient connection would fail with
        // "Connection not found". So we persist the ad-hoc connection first, then
        // open a tab with the real DB-backed connection.
        setBusy(true);
        try {
            const conn = await api.createConnection({
                name: `Quick: ${host}`,
                host,
                port,
                protocol,
                username,
                group_id: null,
                use_private_key: false,
                rdp_width: protocol === 'RDP' ? 1920 : null,
                rdp_height: protocol === 'RDP' ? 1080 : null,
                rdp_fullscreen: null,
                domain: null,
                rdp_color_depth: null,
                rdp_redirect_audio: null,
                rdp_redirect_printers: null,
                rdp_redirect_drives: null,
                ssh_tunnels: null,
                credential_profile_id: null,
                override_credentials: null,
                jump_host_id: null,
                ssh_key_id: null,
                use_ssh_agent: null,
                tags: null,
                notes: null,
                use_ftps: null,
                rdp_nla: null,
                docker_transport: null,
                docker_socket_path: null,
                docker_tls_ca_path: null,
                docker_tls_cert_path: null,
                docker_tls_key_path: null,
                proxmox_api_token_id: null,
                proxmox_api_token_secret_encrypted: null,
            });
            const fresh = await api.getConnections();
            setConnections(fresh);
            openTab(conn);
            setInput('');
        } catch (e) {
            addToast({ type: 'error', title: 'Quick Connect failed', description: String(e) });
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="h-12 bg-surface/50 border-b border-border flex items-center px-4 gap-3">
            <Zap className="w-4 h-4 text-yellow-500" />
            <div className="flex-1 max-w-xl relative">
                <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleConnect()}
                    placeholder="Quick Connect: [ssh://][user@]host[:port]"
                    className="w-full h-8 bg-base border border-border rounded-md px-3 text-sm focus:outline-none focus:border-accent/50 placeholder:text-text-muted"
                />
                <button
                    onClick={handleConnect}
                    className="absolute right-1 top-1 w-6 h-6 flex items-center justify-center text-text-muted hover:text-accent transition-colors"
                >
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>
            <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                Ad-hoc Session
            </div>
        </div>
    );
}
