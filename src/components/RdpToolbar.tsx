import { useState, useEffect } from 'react';
import { Maximize2, Minimize2, MonitorPlay, X, RefreshCw, Power, HardDrive, Printer, Volume2 } from 'lucide-react';
import { useUIStore } from '../store';
import * as api from '../services/api';

interface RdpToolbarProps {
    sessionId: string;
    connectionName: string;
    onDisconnect: () => void;
    onReconnect: () => void;
    embedStatus: string;
    redirectDrives?: boolean;
    redirectPrinters?: boolean;
    redirectAudio?: boolean;
}

export function RdpToolbar({
    sessionId,
    connectionName,
    onDisconnect,
    onReconnect,
    embedStatus,
    redirectDrives,
    redirectPrinters,
    redirectAudio,
}: RdpToolbarProps) {
    const isFullscreen = useUIStore(s => s.isFullscreen);
    const setIsFullscreen = useUIStore(s => s.setIsFullscreen);
    const addToast = useUIStore(s => s.addToast);
    const [isVisible, setIsVisible] = useState(true);
    const [scalingFit, setScalingFit] = useState(true);

    // Auto-hide: show when mouse is within the top 80 px, hide 3 s after leaving
    useEffect(() => {
        let hideTimer: ReturnType<typeof setTimeout> | null = null;

        const onMove = (e: MouseEvent) => {
            if (e.clientY < 80) {
                // Mouse is near the top — cancel any pending hide and show toolbar
                if (hideTimer !== null) {
                    clearTimeout(hideTimer);
                    hideTimer = null;
                }
                setIsVisible(true);
            } else {
                // Mouse moved away — start hide timer if not already running
                if (hideTimer === null) {
                    hideTimer = setTimeout(() => {
                        setIsVisible(false);
                        hideTimer = null;
                    }, 3000);
                }
            }
        };

        window.addEventListener('mousemove', onMove);
        // Start initial hide timer (toolbar visible on mount for 3 s)
        hideTimer = setTimeout(() => {
            setIsVisible(false);
            hideTimer = null;
        }, 3000);

        return () => {
            window.removeEventListener('mousemove', onMove);
            if (hideTimer !== null) clearTimeout(hideTimer);
        };
    }, []);

    const handleSendCtrlAltDel = () => {
        // Send a custom standard input command that the C# helper interepts
        api.rdpSendInput(sessionId, 'CMD:CTRLALTDEL').catch(e =>
            addToast({ type: 'warning', title: 'RDP command failed', description: String(e) })
        );
    };

    const handleToggleScaling = () => {
        const next = !scalingFit;
        setScalingFit(next);
        api.rdpSendInput(sessionId, `CMD:SCALING:${next ? 'FIT' : '1'}`).catch(e =>
            addToast({ type: 'warning', title: 'RDP command failed', description: String(e) })
        );
    };

    // Keyboard shortcuts for F11
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'F11') {
                e.preventDefault();
                setIsFullscreen(!isFullscreen);
            }
            if (e.key === 'Escape' && isFullscreen) {
                setIsFullscreen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFullscreen, setIsFullscreen]);

    return (
        <div
            className="absolute top-0 left-0 right-0 h-16 z-50 flex justify-center"
        >
            <div
                className={`transition-all duration-300 ease-in-out transform flex items-center gap-4 bg-surface/90 backdrop-blur-md border border-border border-t-0 shadow-2xl rounded-b-xl px-4 py-2 ${
                    isVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
                }`}
            >
                {/* Connection Info */}
                <div className="flex items-center gap-2 pr-4 border-r border-border">
                    <div className="relative flex h-3 w-3">
                        {embedStatus === 'embedded' && (
                            <>
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                            </>
                        )}
                        {(embedStatus === 'launching' ||
                            embedStatus === 'embedding' ||
                            embedStatus === 'auth') && (
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500 animate-pulse"></span>
                        )}
                        {(embedStatus === 'error' || embedStatus === 'disconnected') && (
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                        )}
                    </div>
                    <span className="font-bold text-sm tracking-wide text-text-primary">
                        {connectionName}
                    </span>

                    {/* Redirect-active badges */}
                    {(redirectDrives || redirectPrinters || redirectAudio) && (
                        <div className="flex items-center gap-1 ml-1">
                            {redirectDrives && (
                                <span
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[10px] font-medium"
                                    title="Drive redirection active"
                                >
                                    <HardDrive className="w-2.5 h-2.5" />
                                    <span>Drives</span>
                                </span>
                            )}
                            {redirectPrinters && (
                                <span
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-400 text-[10px] font-medium"
                                    title="Printer redirection active"
                                >
                                    <Printer className="w-2.5 h-2.5" />
                                    <span>Print</span>
                                </span>
                            )}
                            {redirectAudio && (
                                <span
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-medium"
                                    title="Audio redirection active"
                                >
                                    <Volume2 className="w-2.5 h-2.5" />
                                    <span>Audio</span>
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={handleSendCtrlAltDel}
                        className="px-3 py-1.5 hover:bg-white/5 rounded-md text-xs font-semibold text-text-primary flex items-center gap-2 transition-colors border border-transparent hover:border-border"
                        title="Send Ctrl+Alt+End"
                        aria-label="Send Ctrl+Alt+Del"
                    >
                        <Power className="w-3.5 h-3.5" />
                        <span>Ctrl+Alt+Del</span>
                    </button>

                    <button
                        type="button"
                        onClick={handleToggleScaling}
                        className="px-3 py-1.5 hover:bg-white/5 rounded-md text-xs font-semibold text-text-primary flex items-center gap-2 transition-colors border border-transparent hover:border-border"
                        title={
                            scalingFit ? 'Switch to Native 1:1 Resolution' : 'Switch to Fit'
                        }
                        aria-label={scalingFit ? 'Switch to native 1:1 scaling' : 'Switch to fit scaling'}
                    >
                        <MonitorPlay className="w-3.5 h-3.5" />
                        <span>{scalingFit ? 'Fit' : '1:1'}</span>
                    </button>

                    <div className="w-px h-5 bg-border mx-2"></div>

                    <button
                        type="button"
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className="p-1.5 hover:bg-white/5 rounded-md text-text-primary transition-colors"
                        title="Fullscreen (F11)"
                        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    >
                        {isFullscreen ? (
                            <Minimize2 className="w-4 h-4" />
                        ) : (
                            <Maximize2 className="w-4 h-4" />
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={onReconnect}
                        className="p-1.5 hover:bg-blue-500/10 hover:text-blue-400 rounded-md text-text-primary transition-colors"
                        title="Reconnect (Ctrl+Shift+R)"
                        aria-label="Reconnect"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>

                    <button
                        type="button"
                        onClick={onDisconnect}
                        className="p-1.5 hover:bg-red-500/10 hover:text-red-400 rounded-md text-text-primary transition-colors ml-1"
                        title="Disconnect (Ctrl+Shift+D)"
                        aria-label="Disconnect"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
