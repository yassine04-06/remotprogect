import { useState } from 'react';
import { useTabStore } from '../store';
import { Zap, ChevronRight } from 'lucide-react';

export function QuickConnectBar() {
    const [input, setInput] = useState('');
    const openTab = useTabStore(s => s.openTab);

    const handleConnect = () => {
        if (!input) return;

        let protocol: 'SSH' | 'RDP' | 'VNC' = 'SSH';
        let host = input;
        let username = 'root';
        let port = 22;

        // Simple parser for quick connect strings: [proto://][user@]host[:port]
        let remaining = input;

        if (remaining.includes('://')) {
            const parts = remaining.split('://');
            const p = parts[0].toUpperCase();
            if (p === 'SSH' || p === 'RDP' || p === 'VNC') protocol = p as any;
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
            port = parseInt(parts[1]) || (protocol === 'SSH' ? 22 : protocol === 'RDP' ? 3389 : 5900);
        } else {
            host = remaining;
            port = protocol === 'SSH' ? 22 : protocol === 'RDP' ? 3389 : 5900;
        }

        const tempId = `quick-${Date.now()}`;
        // For MVP, we treat this as a transient connection object
        openTab({
            id: tempId,
            name: `Quick: ${host}`,
            host,
            port,
            protocol,
            username,
            group_id: null,
            use_private_key: false,
            password_encrypted: null,
            private_key_encrypted: null,
            rdp_width: 1920,
            rdp_height: 1080,
            rdp_fullscreen: false,
            domain: null,
            rdp_color_depth: 32,
            rdp_redirect_audio: true,
            rdp_redirect_printers: false,
            rdp_redirect_drives: false,
        } as any); // Ad-hoc connection casting to satisfy complex interface requirements

        setInput('');
    };

    return (
        <div className="h-12 bg-surface/50 border-b border-border flex items-center px-4 gap-3">
            <Zap className="w-4 h-4 text-yellow-500" />
            <div className="flex-1 max-w-xl relative">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
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
