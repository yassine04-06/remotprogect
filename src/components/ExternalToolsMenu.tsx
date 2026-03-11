import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import * as api from '../services/api';
import { Terminal, Activity, Zap, Play, Loader2 } from 'lucide-react';
import type { ServerConnection } from '../types';

export function ExternalToolsMenu({ connection, onClose }: { connection: ServerConnection, onClose: () => void }) {
    const { addToast } = useAppStore();
    const [isRunning, setIsRunning] = useState<string | null>(null);

    const tools = [
        { name: 'Ping', command: 'ping', icon: <Activity className="w-3.5 h-3.5" /> },
        { name: 'Traceroute', command: 'tracert', icon: <Zap className="w-3.5 h-3.5" /> },
        { name: 'DNS Lookup', command: 'nslookup', icon: <Terminal className="w-3.5 h-3.5" /> },
    ];

    const runTool = async (toolName: string, command: string) => {
        setIsRunning(toolName);
        try {
            const result = await api.runExternalTool(command, [connection.host]);
            if (result.success) {
                addToast({
                    type: 'info',
                    title: `${toolName} Result`,
                    description: result.stdout.slice(0, 500) // Toast only likes strings in our type definition
                });
            } else {
                addToast({ type: 'error', title: `${toolName} Failed`, description: result.stderr || 'Command failed' });
            }
        } catch (err) {
            addToast({ type: 'error', title: 'Execution Error', description: String(err) });
        } finally {
            setIsRunning(null);
            onClose();
        }
    };

    return (
        <div className="py-1 min-w-[160px]">
            <div className="px-3 py-1.5 text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-border/50 mb-1">
                External Tools
            </div>
            {tools.map((tool) => (
                <button
                    key={tool.name}
                    disabled={isRunning !== null}
                    onClick={() => runTool(tool.name, tool.command)}
                    className="w-full px-3 py-2 flex items-center gap-3 text-sm text-text-primary hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
                >
                    {isRunning === tool.name ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : tool.icon}
                    <span>{tool.name}</span>
                    <Play className="w-3 h-3 ml-auto opacity-30" />
                </button>
            ))}
        </div>
    );
}
