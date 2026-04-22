import { useState, useEffect } from 'react';
import { Maximize2, Minimize2, MonitorPlay, X, RefreshCw, Power } from 'lucide-react';
import { useUIStore } from '../store';
import * as api from '../services/api';

interface RdpToolbarProps {
    sessionId: string;
    connectionName: string;
    onDisconnect: () => void;
    onReconnect: () => void;
    embedStatus: string;
}

export function RdpToolbar({ sessionId, connectionName, onDisconnect, onReconnect, embedStatus }: RdpToolbarProps) {
    const isFullscreen = useUIStore(s => s.isFullscreen);
    const setIsFullscreen = useUIStore(s => s.setIsFullscreen);
    const [isVisible, setIsVisible] = useState(true);
    const [mouseActive, setMouseActive] = useState(false);
    const [scalingFit, setScalingFit] = useState(true);

    // Auto-hide logic
    useEffect(() => {
        if (!mouseActive) {
            const timer = setTimeout(() => setIsVisible(false), 2500);
            return () => clearTimeout(timer);
        } else {
            setIsVisible(true);
        }
    }, [mouseActive]);

    const handleSendCtrlAltDel = () => {
        // Send a custom standard input command that the C# helper interepts
        api.rdpSendInput(sessionId, "CMD:CTRLALTDEL").catch(console.error);
    };

    const handleToggleScaling = () => {
        const next = !scalingFit;
        setScalingFit(next);
        api.rdpSendInput(sessionId, `CMD:SCALING:${next ? 'FIT' : '1'}`).catch(console.error);
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
            onMouseEnter={() => setMouseActive(true)}
            onMouseLeave={() => setMouseActive(false)}
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
                        {(embedStatus === 'launching' || embedStatus === 'embedding' || embedStatus === 'auth') && (
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500 animate-pulse"></span>
                        )}
                        {(embedStatus === 'error' || embedStatus === 'disconnected') && (
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                        )}
                    </div>
                    <span className="font-bold text-sm tracking-wide text-text-primary">{connectionName}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                    <button 
                        onClick={handleSendCtrlAltDel}
                        className="px-3 py-1.5 hover:bg-white/5 rounded-md text-xs font-semibold text-text-primary flex items-center gap-2 transition-colors border border-transparent hover:border-border"
                        title="Invia Ctrl+Alt+End"
                    >
                        <Power className="w-3.5 h-3.5" />
                        <span>Ctrl+Alt+Del</span>
                    </button>

                    <button 
                        onClick={handleToggleScaling}
                        className="px-3 py-1.5 hover:bg-white/5 rounded-md text-xs font-semibold text-text-primary flex items-center gap-2 transition-colors border border-transparent hover:border-border"
                        title={scalingFit ? "Passa a Risoluzione Nativa 1:1" : "Passa a Adatta (Fit)"}
                    >
                        <MonitorPlay className="w-3.5 h-3.5" />
                        <span>{scalingFit ? 'Fit' : '1:1'}</span>
                    </button>

                    <div className="w-px h-5 bg-border mx-2"></div>

                    <button 
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className="p-1.5 hover:bg-white/5 rounded-md text-text-primary transition-colors"
                        title="Schermo Intero (F11)"
                    >
                        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>

                    <button 
                        onClick={onReconnect}
                        className="p-1.5 hover:bg-blue-500/10 hover:text-blue-400 rounded-md text-text-primary transition-colors"
                        title="Riconnetti (Ctrl+Shift+R)"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>

                    <button 
                        onClick={onDisconnect}
                        className="p-1.5 hover:bg-red-500/10 hover:text-red-400 rounded-md text-text-primary transition-colors ml-1"
                        title="Disconnetti (Ctrl+Shift+D)"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}
