import { useEffect, useState, useRef, useCallback } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useConnectionStore, useTabStore, useUIStore } from '../store';
import * as api from '../services/api';
import type { Tab } from '../types';
import { Monitor, RefreshCw, Loader2, Maximize2, X, Wifi, WifiOff, ShieldCheck } from 'lucide-react';
import { RdpToolbar } from './RdpToolbar';

interface RdpViewProps {
    tab: Tab;
    isActive: boolean;
}

type EmbedStatus =
    | 'idle'
    | 'launching'
    | 'embedding'
    | 'auth'
    | 'embedded'
    | 'external'
    | 'disconnected'
    | 'error';

export function RdpView({ tab, isActive }: RdpViewProps) {
    const connections = useConnectionStore(s => s.connections);
    const closeTab = useTabStore(s => s.closeTab);
    const updateTabStatus = useTabStore(s => s.updateTabStatus);
    const addToast = useUIStore(s => s.addToast);
    const [embedStatus, setEmbedStatus] = useState<EmbedStatus>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [disconnectCode, setDisconnectCode] = useState<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Track whether the session is currently embedded (for resize logic)
    const isEmbeddedRef = useRef(false);

    // ── Core: start a fresh RDP session ────────────────────────────────────

    const startConnection = useCallback(async () => {
        setEmbedStatus('launching');
        setErrorMsg('');
        setDisconnectCode(null);
        updateTabStatus(tab.id, 'connecting');

        try {
            const avail = await api.rdpCheckAvailable();
            if (!avail.available) {
                setEmbedStatus('error');
                setErrorMsg('No RDP client found on your system.');
                updateTabStatus(tab.id, 'error');
                return;
            }

            const conn = tab.connection ?? connections.find(c => c.id === tab.connectionId);
            if (!conn) {
                setEmbedStatus('error');
                setErrorMsg('Connection details not found.');
                updateTabStatus(tab.id, 'error');
                return;
            }

            const creds = await api.resolveCredentials(conn.id);

            setEmbedStatus('embedding');

            // Launch the C# helper (hidden off-screen) and wait for HWND handshake
            await api.rdpConnect(
                tab.id,
                conn.host,
                conn.port,
                creds.username || conn.username,
                creds.password_decrypted || '',
                conn.rdp_width,
                conn.rdp_height,
                conn.rdp_fullscreen,
                creds.domain || conn.domain,
                conn.rdp_color_depth,
                conn.rdp_redirect_audio,
                conn.rdp_redirect_printers,
                conn.rdp_redirect_drives,
            );

            // Confirm the session is tracked
            const embedded = await api.rdpEmbedWindow(tab.id);

            if (embedded) {
                isEmbeddedRef.current = true;
                setEmbedStatus('embedded');
                updateTabStatus(tab.id, 'connected');
                addToast({ type: 'success', title: 'RDP Connected', description: `Connected to ${conn.name}` });

                // Position the window correctly right away
                await syncPosition();

                // If this tab is active, also give focus
                if (isActive) {
                    api.rdpFocus(tab.id).catch(() => {});
                }
            } else {
                // mstsc fallback — no embedding available
                isEmbeddedRef.current = false;
                setEmbedStatus('external');
                updateTabStatus(tab.id, 'connected');
                addToast({ type: 'info', title: 'RDP Launched', description: 'Running in external window.' });
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setEmbedStatus('error');
            setErrorMsg(msg);
            updateTabStatus(tab.id, 'error');
            addToast({ type: 'error', title: 'RDP Failed', description: msg });
        }
    }, [tab, connections, updateTabStatus, addToast, isActive]);

    // ── Position sync (DPI-aware, via Rust backend) ─────────────────────────

    const syncPosition = useCallback(async () => {
        if (!containerRef.current || !isEmbeddedRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        // Rust backend converts logical px → physical px using window.scale_factor()
        await api.rdpResizeEmbedded(
            tab.id,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
        ).catch(() => {});
    }, [tab.id]);

    // ── Mount / unmount ─────────────────────────────────────────────────────

    useEffect(() => {
        startConnection();

        return () => {
            isEmbeddedRef.current = false;
            api.rdpDisconnect(tab.id).catch(() => {});
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Real-time event listener (replaces polling) ─────────────────────────
    //
    // The C# helper emits structured lines on stdout → Rust re-emits them as
    // Tauri events named "rdp-event-<session_id>".
    // We listen here and react: connected / disconnected / fatal / warning.

    useEffect(() => {
        if (embedStatus !== 'embedded') return;

        let unlisten: UnlistenFn | undefined;

        const setupListener = async () => {
            unlisten = await listen<string>(`rdp-event-${tab.id}`, ({ payload }) => {
                const line = payload.trim();

                if (line === 'EVENT:connected') {
                    // Start auth state phase
                    setEmbedStatus('auth');
                    setTimeout(() => {
                        setEmbedStatus('embedded');
                        updateTabStatus(tab.id, 'connected');
                    }, 500); // Small cinematic delay to show "Securing connection"
                } else if (line.startsWith('EVENT:warning:')) {
                    // ignore generic warnings unless tracking them
                } else if (line.startsWith('EVENT:disconnected:')) {
                    const code = parseInt(line.split(':')[2] ?? '0', 10);
                    setDisconnectCode(code);
                    isEmbeddedRef.current = false;
                    setEmbedStatus('disconnected');
                    updateTabStatus(tab.id, 'disconnected');
                } else if (line.startsWith('EVENT:fatal:')) {
                    const code = parseInt(line.split(':')[2] ?? '0', 10);
                    isEmbeddedRef.current = false;
                    setEmbedStatus('error');
                    setErrorMsg(`RDP fatal error (code ${code}). The session ended unexpectedly.`);
                    updateTabStatus(tab.id, 'error');
                } else if (line === 'CLOSED') {
                    // Process exited
                    if (embedStatus === 'embedded') {
                        isEmbeddedRef.current = false;
                        setEmbedStatus('disconnected');
                        updateTabStatus(tab.id, 'disconnected');
                    }
                }
            });
        };

        setupListener();
        return () => { unlisten?.(); };
    }, [embedStatus, tab.id, updateTabStatus]);

    // ── Resize observer + Tauri window move/resize events ──────────────────

    useEffect(() => {
        if (embedStatus !== 'embedded' || !containerRef.current) return;

        const handleResize = () => syncPosition();

        const observer = new ResizeObserver(handleResize);
        observer.observe(containerRef.current);
        window.addEventListener('resize', handleResize);

        let unlistenMove: UnlistenFn | undefined;
        let unlistenResized: UnlistenFn | undefined;

        const setupTauriListeners = async () => {
            const win = getCurrentWindow();
            unlistenMove    = await win.onMoved(handleResize);
            unlistenResized = await win.onResized(handleResize);
        };
        setupTauriListeners();

        // Sync immediately
        syncPosition();

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', handleResize);
            unlistenMove?.();
            unlistenResized?.();
        };
    }, [embedStatus, syncPosition]);

    // ── Tab switch: HIDE/SHOW + FOCUS via native Win32 ─────────────────────

    useEffect(() => {
        if (!isEmbeddedRef.current) return;

        if (isActive) {
            // Show the window then sync position, then send keyboard focus
            api.rdpSetVisibility(tab.id, true)
                .then(() => syncPosition())
                .then(() => api.rdpFocus(tab.id))
                .catch(() => {});
        } else {
            // Hide natively — no off-screen hack
            api.rdpSetVisibility(tab.id, false).catch(() => {});
        }
    }, [isActive, tab.id, syncPosition]);

    // ── Reconnect handler ───────────────────────────────────────────────────

    const handleReconnect = useCallback(() => {
        setEmbedStatus('idle');
        setErrorMsg('');
        setDisconnectCode(null);
        startConnection();
    }, [startConnection]);

    // ── Render: embedded state ─────────────────────────────────────────────

    if (embedStatus === 'embedded') {
        return (
            <div
                ref={containerRef}
                className="w-full h-full bg-black flex flex-col relative"
                onMouseEnter={() => api.rdpFocus(tab.id).catch(() => {})}
            >
                <RdpToolbar 
                    sessionId={tab.id}
                    connectionName={tab.connectionName}
                    onDisconnect={() => closeTab(tab.id)}
                    onReconnect={handleReconnect}
                    embedStatus={embedStatus}
                />
                
                {/* The ActiveX will be overlaid here by Rust, so we just provide the bounding box */}
                <div className="flex-1 w-full" />
            </div>
        );
    }

    // ── Render: all other states — status card ──────────────────────────────

    return (
        <div
            className={`w-full h-full flex items-center justify-center bg-base ${isActive ? 'flex' : 'hidden'}`}
        >
            <div className="bg-surface border border-border rounded-xl p-8 max-w-md w-full text-center shadow-xl">
                {/* Icon */}
                <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-6 ${
                    embedStatus === 'error' || embedStatus === 'disconnected'
                        ? 'bg-red-500/10'
                        : 'bg-blue-500/10'
                }`}>
                    {embedStatus === 'disconnected'
                        ? <WifiOff className="w-8 h-8 text-red-400" />
                        : <Monitor className={`w-8 h-8 ${embedStatus === 'error' ? 'text-red-400' : 'text-blue-400'}`} />
                    }
                </div>

                <h2 className="text-xl font-bold text-text-primary mb-2">{tab.connectionName}</h2>

                {/* Status messages */}
                <div className="mb-8">
                    {(embedStatus === 'launching' || embedStatus === 'embedding' || embedStatus === 'auth') && (
                        <div className="flex flex-col items-center gap-3">
                            <div className="relative">
                                <Loader2 className="w-8 h-8 text-accent animate-spin" />
                                {embedStatus === 'auth' && (
                                    <ShieldCheck className="w-4 h-4 text-green-400 absolute bottom-0 -right-1 bg-surface rounded-full" />
                                )}
                            </div>
                            
                            <div className="text-center space-y-1">
                                <p className="text-accent font-medium">
                                    {embedStatus === 'launching' && 'Spawning Client...'}
                                    {embedStatus === 'embedding' && 'Negotiating Connection...'}
                                    {embedStatus === 'auth' && 'Securing Connection...'}
                                </p>
                                <p className="text-text-muted text-xs">
                                    {embedStatus === 'launching' && 'Initializing proxy wrapper'}
                                    {embedStatus === 'embedding' && 'Exchanging certificates'}
                                    {embedStatus === 'auth' && 'Validating credentials'}
                                </p>
                            </div>
                        </div>
                    )}

                    {embedStatus === 'external' && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-center gap-2 text-green-400">
                                <Maximize2 className="w-4 h-4" />
                                <p>RDP session running in external window.</p>
                            </div>
                            <p className="text-text-muted text-xs">
                                Embedding unavailable. The session opened as a separate mstsc window.
                            </p>
                        </div>
                    )}

                    {embedStatus === 'disconnected' && (
                        <div className="space-y-2">
                            <p className="text-text-muted">The RDP session has ended.</p>
                            {disconnectCode !== null && disconnectCode !== 0 && (
                                <p className="text-text-muted text-xs">
                                    Disconnect code: <span className="font-mono text-accent">{disconnectCode}</span>
                                </p>
                            )}
                        </div>
                    )}

                    {embedStatus === 'error' && (
                        <div className="text-red-400 text-sm p-3 bg-red-500/10 rounded-md border border-red-500/20 text-left">
                            {errorMsg || 'An unexpected connection error occurred.'}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex gap-3 justify-center">
                    {(embedStatus === 'disconnected' || embedStatus === 'error') && (
                        <button
                            id={`rdp-reconnect-${tab.id}`}
                            onClick={handleReconnect}
                            className="px-4 py-2 bg-accent text-white rounded-md font-medium hover:bg-accent/90 transition-colors inline-flex items-center gap-2"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Reconnect
                        </button>
                    )}
                    <button
                        id={`rdp-close-${tab.id}`}
                        onClick={() => closeTab(tab.id)}
                        className="px-4 py-2 bg-surface border border-border rounded-md font-medium text-text-primary hover:bg-white/5 transition-colors inline-flex items-center gap-2"
                    >
                        <X className="w-4 h-4" />
                        Close Tab
                    </button>
                </div>

                {/* Connection info row */}
                {(embedStatus === 'launching' || embedStatus === 'embedding' || embedStatus === 'auth') && (
                    <div className="mt-6 flex items-center justify-center gap-2 text-text-muted text-xs bg-black/20 py-2 px-4 rounded-full">
                        <Wifi className="w-3 h-3 animate-pulse text-accent" />
                        <span>Connecting to {tab.connectionName}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
