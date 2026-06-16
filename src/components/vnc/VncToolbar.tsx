// LOW-8: VncToolbar — auto-hide floating toolbar for VNC sessions
import { useState, useEffect } from 'react';
import { Maximize2, Monitor, X, RefreshCw, Power, WifiOff } from 'lucide-react';
import * as api from '../../services/api';
import { useUIStore } from '../../store';

export interface VncToolbarProps {
    sessionId: string;
    connectionName: string;
    fbName: string;
    fbSize: { w: number; h: number } | null;
    phase: 'connecting' | 'connected' | 'error' | 'disconnected';
    onReconnect: () => void;
    onDisconnect: () => void;
    onClose: () => void;
    onFullscreen: () => void;
}

export function VncToolbar({
    sessionId,
    connectionName,
    fbName,
    fbSize,
    phase,
    onReconnect,
    onDisconnect,
    onClose,
    onFullscreen,
}: VncToolbarProps) {
    const addToast = useUIStore(s => s.addToast);
    const [isVisible, setIsVisible] = useState(true);

    // Auto-hide: show when mouse Y < 80 px, hide 3 s after moving away
    useEffect(() => {
        let hideTimer: ReturnType<typeof setTimeout> | null = null;

        const onMove = (e: MouseEvent) => {
            if (e.clientY < 80) {
                if (hideTimer !== null) {
                    clearTimeout(hideTimer);
                    hideTimer = null;
                }
                setIsVisible(true);
            } else {
                if (hideTimer === null) {
                    hideTimer = setTimeout(() => {
                        setIsVisible(false);
                        hideTimer = null;
                    }, 3000);
                }
            }
        };

        window.addEventListener('mousemove', onMove);
        // Show on mount for 3 s, then hide if mouse isn't near top
        hideTimer = setTimeout(() => {
            setIsVisible(false);
            hideTimer = null;
        }, 3000);

        return () => {
            window.removeEventListener('mousemove', onMove);
            if (hideTimer !== null) clearTimeout(hideTimer);
        };
    }, []);

    const handleCtrlAltDel = async () => {
        try {
            // Down: Control, Alt, Delete
            await api.vncNativeKeyEvent(sessionId, 0xffe3, true);
            await api.vncNativeKeyEvent(sessionId, 0xffe9, true);
            await api.vncNativeKeyEvent(sessionId, 0xffff, true);
            // Up: Delete, Alt, Control (reverse order)
            await api.vncNativeKeyEvent(sessionId, 0xffff, false);
            await api.vncNativeKeyEvent(sessionId, 0xffe9, false);
            await api.vncNativeKeyEvent(sessionId, 0xffe3, false);
        } catch (e) {
            addToast({ type: 'warning', title: 'VNC key event failed', description: String(e) });
        }
    };

    // Status chip
    const statusChip = () => {
        switch (phase) {
            case 'connected':
                return (
                    <div className="flex items-center gap-1.5">
                        <div className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                        </div>
                        <span className="text-green-400 text-xs font-semibold">Connected</span>
                    </div>
                );
            case 'connecting':
                return (
                    <div className="flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3 text-purple-400 animate-spin" />
                        <span className="text-purple-400 text-xs font-semibold">Connecting…</span>
                    </div>
                );
            case 'error':
                return (
                    <div className="flex items-center gap-1.5">
                        <span className="inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                        <span className="text-red-400 text-xs font-semibold">Error</span>
                    </div>
                );
            case 'disconnected':
                return (
                    <div className="flex items-center gap-1.5">
                        <span className="inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                        <span className="text-amber-400 text-xs font-semibold">Disconnected</span>
                    </div>
                );
        }
    };

    return (
        <div className="absolute top-0 left-0 right-0 h-16 z-50 flex justify-center pointer-events-none">
            <div
                className={`pointer-events-auto transition-all duration-300 ease-in-out transform flex items-center gap-3 bg-surface/90 backdrop-blur-md border border-border border-t-0 shadow-2xl rounded-b-xl px-4 py-2 ${
                    isVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
                }`}
            >
                {/* Connection info */}
                <div className="flex items-center gap-2 pr-3 border-r border-border">
                    <Monitor className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <div className="flex flex-col leading-tight">
                        <span className="font-bold text-xs tracking-wide text-text-primary">
                            {connectionName}
                        </span>
                        <span className="text-[10px] text-text-muted">
                            {fbName && `${fbName} · `}
                            {fbSize ? `${fbSize.w}×${fbSize.h}` : '—'}
                        </span>
                    </div>
                </div>

                {/* Status */}
                <div className="pr-3 border-r border-border">
                    {statusChip()}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={handleCtrlAltDel}
                        className="px-2.5 py-1.5 hover:bg-white/5 rounded-md text-xs font-semibold text-text-primary flex items-center gap-1.5 transition-colors border border-transparent hover:border-border"
                        title="Send Ctrl+Alt+Del"
                        aria-label="Send Ctrl+Alt+Del"
                    >
                        <Power className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Ctrl+Alt+Del</span>
                    </button>

                    <div className="w-px h-4 bg-border mx-1" />

                    <button
                        type="button"
                        onClick={onFullscreen}
                        className="p-1.5 hover:bg-white/5 rounded-md text-text-primary transition-colors"
                        title="Fullscreen"
                        aria-label="Enter fullscreen"
                    >
                        <Maximize2 className="w-4 h-4" />
                    </button>

                    {(phase === 'error' || phase === 'disconnected') && (
                        <button
                            type="button"
                            onClick={onReconnect}
                            className="p-1.5 hover:bg-blue-500/10 hover:text-blue-400 rounded-md text-text-primary transition-colors"
                            title="Reconnect"
                            aria-label="Reconnect"
                        >
                            <RefreshCw className="w-4 h-4" />
                        </button>
                    )}

                    {phase === 'connected' && (
                        <button
                            type="button"
                            onClick={onDisconnect}
                            className="p-1.5 hover:bg-red-500/10 hover:text-red-400 rounded-md text-text-primary transition-colors"
                            title="Disconnect"
                            aria-label="Disconnect"
                        >
                            <WifiOff className="w-4 h-4" />
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/5 rounded-md text-text-muted hover:text-text-primary transition-colors ml-1"
                        title="Close tab"
                        aria-label="Close tab"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
