import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../store/useAppStore';
import * as api from '../services/api';
import type { Tab } from '../types';
import { Monitor, RefreshCw } from 'lucide-react';

interface RdpViewProps {
    tab: Tab;
    isActive: boolean;
}

export function RdpView({ tab, isActive }: RdpViewProps) {
    const { connections, closeTab, updateTabStatus, addToast } = useAppStore();
    const [status, setStatus] = useState(tab.status);
    const [availability, setAvailability] = useState<{ available: boolean; binary: string; message: string } | null>(null);

    useEffect(() => {
        let isMounted = true;

        const init = async () => {
            try {
                const avail = await api.rdpCheckAvailable();
                if (isMounted) {
                    setAvailability({ available: avail.available, binary: 'mstsc', message: avail.available ? 'Available' : 'RDP client not found' });

                    if (avail.available) {
                        setStatus('connecting');
                        updateTabStatus(tab.id, 'connecting');

                        const conn = tab.connection || connections.find(c => c.id === tab.connectionId);
                        if (conn) {
                            let pwd = undefined;
                            if (conn.password_encrypted) {
                                pwd = await api.decryptValue(conn.password_encrypted);
                            }
                            await api.rdpConnect(
                                tab.id,
                                conn.host,
                                conn.port,
                                conn.username,
                                pwd,
                                conn.rdp_width,
                                conn.rdp_height,
                                conn.rdp_fullscreen,
                                conn.domain,
                                conn.rdp_color_depth,
                                conn.rdp_redirect_audio,
                                conn.rdp_redirect_printers,
                                conn.rdp_redirect_drives
                            );
                            if (isMounted) {
                                setStatus('connected');
                                updateTabStatus(tab.id, 'connected');
                                addToast({ type: 'info', title: 'RDP Launched', description: 'Remote Desktop is running in a separate window.' });
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
                    addToast({ type: 'error', title: 'RDP Launch Failed', description: String(err) });
                }
            }
        };

        const setupListener = async () => {
            const unlisten = await listen<{ session_id: string; status: string; message: string }>(`rdp:status:${tab.id}`, (e) => {
                if (!isMounted) return;

                setStatus(e.payload.status as any);
                updateTabStatus(tab.id, e.payload.status as any);

                if (e.payload.status === 'error') {
                    addToast({ type: 'error', title: 'RDP Error', description: e.payload.message });
                } else if (e.payload.status === 'disconnected') {
                    addToast({ type: 'info', title: 'RDP Session Ended', description: e.payload.message });
                }
            });
            return unlisten;
        };

        let unlistenFn: (() => void) | null = null;
        setupListener().then(unlisten => { unlistenFn = unlisten; });

        init();

        return () => {
            isMounted = false;
            if (unlistenFn) unlistenFn();
            api.rdpDisconnect(tab.id).catch(() => { });
        };
    }, []);

    const handleReconnect = async () => {
        setStatus('connecting');
        updateTabStatus(tab.id, 'connecting');

        const conn = tab.connection || connections.find(c => c.id === tab.connectionId);
        if (conn) {
            try {
                let pwd = undefined;
                if (conn.password_encrypted) {
                    pwd = await api.decryptValue(conn.password_encrypted);
                }
                await api.rdpConnect(
                    tab.id,
                    conn.host,
                    conn.port,
                    conn.username,
                    pwd,
                    conn.rdp_width,
                    conn.rdp_height,
                    conn.rdp_fullscreen,
                    conn.domain,
                    conn.rdp_color_depth,
                    conn.rdp_redirect_audio,
                    conn.rdp_redirect_printers,
                    conn.rdp_redirect_drives
                );
                setStatus('connected');
                updateTabStatus(tab.id, 'connected');
                addToast({ type: 'info', title: 'RDP Launched', description: 'Remote Desktop is running in a separate window.' });
            } catch (err: any) {
                setStatus('error');
                updateTabStatus(tab.id, 'error');
            }
        }
    };

    return (
        <div className={`w-full h-full flex items-center justify-center bg-base ${isActive ? 'block' : 'hidden'}`}>
            <div className="bg-surface border border-border rounded-xl p-8 max-w-md w-full text-center shadow-xl">
                <div className="w-16 h-16 mx-auto bg-blue-500/10 rounded-2xl flex items-center justify-center mb-6">
                    <Monitor className="w-8 h-8 text-blue-400" />
                </div>

                <h2 className="text-xl font-bold text-text-primary mb-2">
                    {tab.connectionName}
                </h2>

                <div className="mb-8">
                    {status === 'connecting' && (
                        <p className="text-blue-400 animate-pulse flex items-center justify-center gap-2">
                            <RefreshCw className="w-4 h-4 animate-spin" /> Launching RDP Client...
                        </p>
                    )}
                    {status === 'connected' && (
                        <p className="text-green-400">RDP session is active in a separate window.</p>
                    )}
                    {status === 'disconnected' && (
                        <p className="text-text-muted">The RDP session has ended.</p>
                    )}
                    {status === 'error' && (
                        <div className="text-red-400 text-sm p-3 bg-red-500/10 rounded-md border border-red-500/20">
                            Connection error occurred.
                        </div>
                    )}

                    {availability && !availability.available && (
                        <div className="mt-4 text-yellow-500 text-sm p-3 bg-yellow-500/10 rounded-md text-left">
                            <p className="font-semibold mb-1">System Requirement Missing</p>
                            <p>No compatible RDP client was found on your system.</p>
                        </div>
                    )}
                </div>

                <div className="flex gap-3 justify-center">
                    {(status === 'disconnected' || status === 'error') && availability?.available && (
                        <button
                            onClick={handleReconnect}
                            className="px-4 py-2 bg-accent text-white rounded-md font-medium hover:bg-accent/90 transition-colors inline-flex items-center gap-2"
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
