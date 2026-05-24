import { useEffect, useState, useRef, useCallback } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useConnectionStore, useTabStore, useUIStore } from '../store';
import * as api from '../services/api';
import type { Tab } from '../types';
import {
    Monitor,
    RefreshCw,
    Loader2,
    Maximize2,
    X,
    Wifi,
    WifiOff,
} from 'lucide-react';
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

    // Derive connection at render level so redirect flags are available in JSX
    const conn = tab.connection ?? connections.find(c => c.id === tab.connectionId);
    const [errorMsg, setErrorMsg] = useState('');
    const [disconnectCode, setDisconnectCode] = useState<number | null>(null);

    // Always-mounted wrapper — never null, so syncPosition works at any point in the lifecycle
    const wrapperRef = useRef<HTMLDivElement>(null);

    const isEmbeddedRef = useRef(false);

    // ── Position sync ───────────────────────────────────────────────────────

    const syncPosition = useCallback(async () => {
        if (!wrapperRef.current || !isEmbeddedRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        // Guard: skip if the container reports near-zero dimensions.
        // This happens when the OS window is minimized (client area → 0×0) or
        // during brief intermediate layout frames.  Sending a RESIZE command with
        // tiny dimensions would trigger UpdateSessionDisplaySettings(1,1) on the
        // C# side which the RDP server may treat as a fatal display error and
        // disconnect the session.
        if (rect.width < 100 || rect.height < 100) return;
        // Pass devicePixelRatio explicitly: it is already correct for the current
        // monitor the moment this function runs, whereas Rust's window.scale_factor()
        // can lag by several frames when the Tauri window crosses monitor boundaries.
        const dpr = window.devicePixelRatio || 1;
        await api
            .rdpResizeEmbedded(tab.id, rect.x, rect.y, rect.width, rect.height, dpr)
            .catch(() => {});
    }, [tab.id]);

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

            // Read actual container dimensions so the RDP desktop resolution matches
            // the container exactly — avoids black bars from SmartSizing aspect-ratio mismatch.
            //
            // IMPORTANT: we pass PHYSICAL pixel dimensions (logical × devicePixelRatio).
            // The C# helper receives these as the initial Win32 form size via MoveWindow
            // (which always uses physical pixels under Per-Monitor V2 DPI awareness).
            // Using logical CSS pixels here causes the remote desktop to be set at half
            // resolution on high-DPI displays, leaving unfilled grey areas inside the form.
            const dpr = window.devicePixelRatio || 1;
            const containerRect = wrapperRef.current?.getBoundingClientRect();
            const desktopW =
                containerRect && containerRect.width > 100
                    ? Math.round(containerRect.width * dpr)
                    : Math.round((conn?.rdp_width ?? 1920) * dpr);
            const desktopH =
                containerRect && containerRect.height > 100
                    ? Math.round(containerRect.height * dpr)
                    : Math.round((conn?.rdp_height ?? 1080) * dpr);

            setEmbedStatus('embedding');

            // CRIT-A4: backend resolves host/port/username/password/domain from connectionId.
            await api.rdpConnect(
                tab.id,
                tab.connectionId,
                desktopW,
                desktopH,
                conn?.rdp_fullscreen,
                conn?.rdp_color_depth,
                conn?.rdp_redirect_audio,
                conn?.rdp_redirect_printers,
                conn?.rdp_redirect_drives
            );

            const embedded = await api.rdpEmbedWindow(tab.id);

            if (embedded) {
                isEmbeddedRef.current = true;
                setEmbedStatus('embedded');
                updateTabStatus(tab.id, 'connected');
                addToast({
                    type: 'success',
                    title: 'RDP Connected',
                    description: `Connected to ${conn?.name ?? tab.connectionId}`,
                });

                // wrapperRef is always mounted, so this is reliable even before React commits
                syncPosition();

                if (isActive) {
                    api.rdpFocus(tab.id).catch(() => {});
                }
            } else {
                isEmbeddedRef.current = false;
                setEmbedStatus('external');
                updateTabStatus(tab.id, 'connected');
                addToast({
                    type: 'info',
                    title: 'RDP Launched',
                    description: 'Running in external window.',
                });
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setEmbedStatus('error');
            setErrorMsg(msg);
            updateTabStatus(tab.id, 'error');
            addToast({ type: 'error', title: 'RDP Failed', description: msg });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab, connections, updateTabStatus, addToast, isActive, syncPosition]);

    // ── Mount / unmount ─────────────────────────────────────────────────────

    useEffect(() => {
        startConnection();

        return () => {
            isEmbeddedRef.current = false;
            api.rdpDisconnect(tab.id).catch(() => {});
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Real-time event listener ────────────────────────────────────────────

    useEffect(() => {
        if (embedStatus !== 'embedded') return;

        let unlisten: UnlistenFn | undefined;

        const setupListener = async () => {
            unlisten = await listen<string>(`rdp-event-${tab.id}`, ({ payload }) => {
                const line = payload.trim();

                if (line === 'EVENT:connected') {
                    setEmbedStatus('auth');
                    setTimeout(() => {
                        setEmbedStatus('embedded');
                        updateTabStatus(tab.id, 'connected');
                    }, 500);
                } else if (line.startsWith('EVENT:warning:')) {
                    // ignore generic warnings
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
                    if (embedStatus === 'embedded') {
                        isEmbeddedRef.current = false;
                        setEmbedStatus('disconnected');
                        updateTabStatus(tab.id, 'disconnected');
                    }
                }
            });
        };

        setupListener();
        return () => {
            unlisten?.();
        };
    }, [embedStatus, tab.id, updateTabStatus]);

    // ── Resize observer + Tauri window move/resize events ──────────────────

    useEffect(() => {
        if (embedStatus !== 'embedded' || !wrapperRef.current) return;

        let rafId: number | null = null;
        let showTimer: number | null = null;
        let resizingActive = false;

        // ── Size change: hide → sync → show after server settles ────────────
        //
        // Hiding the Win32 overlay while the remote resolution is updating
        // means the user never sees the intermediate SmartSizing distortion.
        // Instead they see the neutral dark background for ~220 ms, then the
        // RDP content snaps back at the correct 1:1 resolution.
        //
        // Timeline:
        //   t=0   last resize event → overlay hidden, syncPosition queued
        //   t=80  C# debounce fires → UpdateSessionDisplaySettings sent
        //   t=80+ server processes → new frames arrive (LAN: ~10 ms extra)
        //   t=220 React shows overlay — content is already correct
        const handleResize = () => {
            // Cancel a pending "re-show" from an earlier resize burst.
            if (showTimer !== null) { clearTimeout(showTimer); showTimer = null; }

            // Hide the overlay only on the FIRST event of a resize sequence
            // to avoid redundant IPC calls during rapid drag events.
            if (!resizingActive && isEmbeddedRef.current) {
                resizingActive = true;
                api.rdpSetVisibility(tab.id, false).catch(() => {});
            }

            // Throttle geometry sync to one IPC call per animation frame.
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                rafId = null;

                // If the container has near-zero dimensions the OS window is
                // minimized (or mid-transition).  Don't send a RESIZE command —
                // UpdateSessionDisplaySettings(1,1) would disconnect the session —
                // and don't schedule a re-show.  The next handleResize fired when
                // the window is restored will have a proper rect and start the
                // show timer then.
                const rect = wrapperRef.current?.getBoundingClientRect();
                if (!rect || rect.width < 100 || rect.height < 100) return;

                syncPosition();

                // Schedule re-show: 220 ms = 80 ms C# debounce
                //                            + 140 ms generous network buffer.
                showTimer = window.setTimeout(() => {
                    showTimer = null;
                    resizingActive = false;
                    if (isEmbeddedRef.current) {
                        api.rdpSetVisibility(tab.id, true)
                            .then(() => syncPosition())
                            .then(() => api.rdpFocus(tab.id))
                            .catch(() => {});
                    }
                }, 220);
            });
        };

        // ── Position-only change: pure sync, no hide/show ────────────────────
        //
        // Window moves are already tracked at 8 ms by the C# TrackParent thread.
        // The Tauri onMoved event is just a backup sync — no need to flash the
        // overlay for a position-only change.
        const handleMove = () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => { rafId = null; syncPosition(); });
        };

        const observer = new ResizeObserver(handleResize);
        observer.observe(wrapperRef.current);
        window.addEventListener('resize', handleResize);

        let unlistenMove: UnlistenFn | undefined;
        let unlistenResized: UnlistenFn | undefined;
        let unlistenScale: UnlistenFn | undefined;

        const setupTauriListeners = async () => {
            const win = getCurrentWindow();
            unlistenMove    = await win.onMoved(handleMove);      // position only
            unlistenResized = await win.onResized(handleResize);  // size change

            // DPI change: same hide/show strategy as resize, with extra checkpoints
            // because the Tauri layout takes a few frames to settle after a
            // monitor crossing.
            unlistenScale = await win.onScaleChanged(() => {
                handleResize(); // immediate hide + sync
                const t1 = setTimeout(() => syncPosition(), 200);
                const t2 = setTimeout(() => syncPosition(), 600);
                return () => { clearTimeout(t1); clearTimeout(t2); };
            });
        };
        setupTauriListeners();

        syncPosition();

        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            if (showTimer !== null) clearTimeout(showTimer);
            observer.disconnect();
            window.removeEventListener('resize', handleResize);
            unlistenMove?.();
            unlistenResized?.();
            unlistenScale?.();
        };
    }, [embedStatus, syncPosition, tab.id]);

    // ── Tab switch + modal overlay: HIDE/SHOW + FOCUS ──────────────────────
    //
    // The RDP window is a Win32 overlay (WS_POPUP) that sits above the WebView
    // — it cannot be covered by CSS/React elements.  We must imperatively hide it
    // whenever any application modal is open so the modal is not occluded.

    const anyModalOpen = useUIStore(s =>
        s.showConnectionDialog ||
        s.showSettingsDialog   ||
        s.showPortScanner      ||
        s.showGroupDialog      ||
        s.showCredentialManager||
        s.showCommandPalette   ||
        s.showAuditLog         ||
        s.showRecordings
    );

    useEffect(() => {
        if (!isEmbeddedRef.current) return;

        // Hide if: tab is not active OR any modal is covering the workspace.
        const shouldShow = isActive && !anyModalOpen;

        if (shouldShow) {
            api.rdpSetVisibility(tab.id, true)
                .then(() => syncPosition())
                .then(() => api.rdpFocus(tab.id))
                .catch(() => {});
        } else {
            api.rdpSetVisibility(tab.id, false).catch(() => {});
        }
    }, [isActive, anyModalOpen, tab.id, syncPosition]);

    // ── Reconnect handler ───────────────────────────────────────────────────

    const handleReconnect = useCallback(() => {
        setEmbedStatus('idle');
        setErrorMsg('');
        setDisconnectCode(null);
        startConnection();
    }, [startConnection]);

    // ── Render ─────────────────────────────────────────────────────────────
    //
    // wrapperRef sits on the outer div which is always mounted, so syncPosition
    // can read the correct container rect at any point — even before React commits
    // the embedded content into the DOM.

    return (
        <div ref={wrapperRef} className="w-full h-full bg-base overflow-hidden">
            {embedStatus === 'embedded' || embedStatus === 'auth' ? (
                // The RDP Win32 window is overlaid at wrapperRef's screen coordinates.
                // bg-[#1a1a1a] is the fallback visible while the Win32 window repositions.
                <div
                    className="w-full h-full relative"
                    style={{ background: '#1a1a1a' }}
                    onMouseEnter={() => api.rdpFocus(tab.id).catch(() => {})}
                >
                    <RdpToolbar
                        sessionId={tab.id}
                        connectionName={tab.connectionName}
                        onDisconnect={() => closeTab(tab.id)}
                        onReconnect={handleReconnect}
                        embedStatus={embedStatus}
                        redirectDrives={conn?.rdp_redirect_drives}
                        redirectPrinters={conn?.rdp_redirect_printers}
                        redirectAudio={conn?.rdp_redirect_audio}
                    />
                </div>
            ) : (
                <div className="w-full h-full flex items-center justify-center bg-base">
                    <div className="bg-surface border border-border rounded-xl p-8 max-w-md w-full text-center shadow-xl">
                        {/* Icon */}
                        <div
                            className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-6 ${
                                embedStatus === 'error' || embedStatus === 'disconnected'
                                    ? 'bg-red-500/10'
                                    : 'bg-blue-500/10'
                            }`}
                        >
                            {embedStatus === 'disconnected' ? (
                                <WifiOff className="w-8 h-8 text-red-400" />
                            ) : (
                                <Monitor
                                    className={`w-8 h-8 ${embedStatus === 'error' ? 'text-red-400' : 'text-blue-400'}`}
                                />
                            )}
                        </div>

                        <h2 className="text-xl font-bold text-text-primary mb-2">
                            {tab.connectionName}
                        </h2>

                        {/* Status messages */}
                        <div className="mb-8">
                            {(embedStatus === 'launching' || embedStatus === 'embedding') && (
                                <div className="flex flex-col items-center gap-3">
                                    <Loader2 className="w-8 h-8 text-accent animate-spin" />
                                    <div className="text-center space-y-1">
                                        <p className="text-accent font-medium">
                                            {embedStatus === 'launching' && 'Spawning Client...'}
                                            {embedStatus === 'embedding' &&
                                                'Negotiating Connection...'}
                                        </p>
                                        <p className="text-text-muted text-xs">
                                            {embedStatus === 'launching' &&
                                                'Initializing proxy wrapper'}
                                            {embedStatus === 'embedding' &&
                                                'Exchanging certificates'}
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
                                        Embedding unavailable. The session opened as a separate
                                        mstsc window.
                                    </p>
                                </div>
                            )}

                            {embedStatus === 'disconnected' && (
                                <div className="space-y-2">
                                    <p className="text-text-muted">The RDP session has ended.</p>
                                    {disconnectCode !== null && disconnectCode !== 0 && (
                                        <p className="text-text-muted text-xs">
                                            Disconnect code:{' '}
                                            <span className="font-mono text-accent">
                                                {disconnectCode}
                                            </span>
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

                        {/* Connection progress indicator */}
                        {(embedStatus === 'launching' || embedStatus === 'embedding') && (
                            <div className="mt-6 flex items-center justify-center gap-2 text-text-muted text-xs bg-black/20 py-2 px-4 rounded-full">
                                <Wifi className="w-3 h-3 animate-pulse text-accent" />
                                <span>Connecting to {tab.connectionName}</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

