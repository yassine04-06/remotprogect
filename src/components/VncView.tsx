import { useEffect, useState } from 'react';
import { useConnectionStore, useTabStore, useUIStore } from '../store';
import * as api from '../services/api';
import type { Tab } from '../types';
import { Monitor, RefreshCw } from 'lucide-react';

interface VncViewProps {
    tab: Tab;
    isActive: boolean;
}

export function VncView({ tab, isActive }: VncViewProps) {
    const connections = useConnectionStore(s => s.connections);
    const closeTab = useTabStore(s => s.closeTab);
    const updateTabStatus = useTabStore(s => s.updateTabStatus);
    const addToast = useUIStore(s => s.addToast);
    const [status, setStatus] = useState(tab.status);
    const [availability, setAvailability] = useState<{ available: boolean; message: string } | null>(null);

    useEffect(() => {
        let isMounted = true;

        const init = async () => {
            try {
                const avail = await api.vncCheckAvailable();
                if (isMounted) {
                    setAvailability({ available: avail.available, message: avail.available ? 'Available' : 'VNC client not found' });

                    if (avail.available) {
                        setStatus('connecting');
                        updateTabStatus(tab.id, 'connecting');

                        const conn = tab.connection || connections.find(c => c.id === tab.connectionId);
                        if (conn) {
                            const creds = await api.resolveCredentials(conn.id);
                            await api.vncConnect(
                                tab.id,
                                conn.host,
                                conn.port,
                                creds.password_decrypted || undefined
                            );
                            if (isMounted) {
                                setStatus('connected');
                                updateTabStatus(tab.id, 'connected');
                                addToast({ type: 'info', title: 'VNC Launched', description: 'VNC is running in a separate window.' });
                            }
                        }
                    } else {
                        setStatus('error');
                        updateTabStatus(tab.id, 'error');
                    }
                }
            } catch (err: any) {
                if (isMounted) {
                    setStatus('error');
                    updateTabStatus(tab.id, 'error');
                    addToast({ type: 'error', title: 'VNC Launch Failed', description: String(err) });
                }
            }
        };

        init();

        return () => {
            isMounted = false;
            // VNC sessions are handled via rdpDisconnect as they reuse the same process map in backend
            api.rdpDisconnect(tab.id).catch(() => { });
        };
    }, []);

    const handleReconnect = async () => {
        setStatus('connecting');
        updateTabStatus(tab.id, 'connecting');

        const conn = tab.connection || connections.find(c => c.id === tab.connectionId);
        if (conn) {
            try {
                const creds = await api.resolveCredentials(conn.id);
                await api.vncConnect(
                    tab.id,
                    conn.host,
                    conn.port,
                    creds.password_decrypted || undefined
                );
                setStatus('connected');
                updateTabStatus(tab.id, 'connected');
                addToast({ type: 'info', title: 'VNC Launched', description: 'VNC is running in a separate window.' });
            } catch (err: any) {
                setStatus('error');
                updateTabStatus(tab.id, 'error');
            }
        }
    };

    return (
        <div className={`w-full h-full flex items-center justify-center bg-base ${isActive ? 'block' : 'hidden'}`}>
            <div className="bg-surface border border-border rounded-xl p-8 max-w-md w-full text-center shadow-xl">
                <div className="w-16 h-16 mx-auto bg-purple-500/10 rounded-2xl flex items-center justify-center mb-6">
                    <Monitor className="w-8 h-8 text-purple-400" />
                </div>

                <h2 className="text-xl font-bold text-text-primary mb-2">
                    {tab.connectionName} (VNC)
                </h2>

                <div className="mb-8">
                    {status === 'connecting' && (
                        <p className="text-purple-400 animate-pulse flex items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin" /> Launching VNC Client...
                        </p>
                    )}
                    {status === 'connected' && (
                        <p className="text-green-400">VNC session is active in a separate window.</p>
                    )}
                    {status === 'disconnected' && (
                        <p className="text-text-muted">The VNC session has ended.</p>
                    )}
                    {status === 'error' && (
                        <div className="text-red-400 text-sm p-3 bg-red-500/10 rounded-md border border-red-500/20">
                            Connection error occurred.
                        </div>
                    )}

                    {availability && !availability.available && (
                        <div className="mt-4 text-yellow-500 text-sm p-3 bg-yellow-500/10 rounded-md text-left">
                            <p className="font-semibold mb-1">System Requirement Missing</p>
                            <p>No compatible VNC client (vncviewer) was found on your system.</p>
                        </div>
                    )}
                </div>

                <div className="flex gap-3 justify-center">
                    {(status === 'disconnected' || status === 'error') && availability?.available && (
                        <button
                            onClick={handleReconnect}
                            className="px-4 py-2 bg-purple-600 text-white rounded-md font-medium hover:bg-purple-700 transition-colors inline-flex items-center gap-2"
                        >
                            <RefreshCw className="w-4 h-4" /> Reconnect
                        </button>
                    )}
                    <button
                        onClick={() => closeTab(tab.id)}
                        className="px-4 py-2 bg-surface border border-border rounded-md font-medium text-text-primary hover:bg-white/5 transition-colors"
                    >
                        Close Tab
                    </button>
                </div>
            </div>
        </div>
    );
}
