// 90-11: Native VNC view — canvas-based rendering via vnc:* Tauri events
import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTabStore, useUIStore } from '../store';
import * as api from '../services/api';
import type { Tab } from '../types';
import { Monitor } from 'lucide-react';
import { VncToolbar } from './VncToolbar';

interface VncInitPayload {
    session_id: string;
    width: number;
    height: number;
    name: string;
}

interface VncRectPayload {
    session_id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    data: string; // base64 RGBA
}

// L-4 partial: CopyRect — the server tells us a region just moved on screen
// (window drag, scroll). The canvas already holds those pixels so we blit
// them locally instead of re-decoding a fresh rectangle.
interface VncCopyRectPayload {
    session_id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    src_x: number;
    src_y: number;
}

interface VncStatusPayload {
    session_id: string;
    message: string;
}

interface VncViewProps {
    tab: Tab;
    isActive: boolean;
}

export function VncView({ tab, isActive }: VncViewProps) {
    const closeTab = useTabStore(s => s.closeTab);
    const updateTabStatus = useTabStore(s => s.updateTabStatus);
    const addToast = useUIStore(s => s.addToast);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [phase, setPhase] = useState<'connecting' | 'connected' | 'error' | 'disconnected'>('connecting');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [fbSize, setFbSize] = useState<{ w: number; h: number } | null>(null);
    const [fbName, setFbName] = useState('');
    const didConnect = useRef(false);

    const connect = useCallback(async () => {
        if (didConnect.current) return;
        didConnect.current = true;

        setPhase('connecting');
        updateTabStatus(tab.id, 'connecting');

        try {
            // CRIT-A4: backend resolves host/port/password server-side from connectionId.
            await api.vncNativeConnect(tab.id, tab.connectionId);
        } catch (err: unknown) {
            setPhase('error');
            setErrorMsg(String(err));
            updateTabStatus(tab.id, 'error');
            addToast({ type: 'error', title: 'VNC Error', description: String(err) });
        }
    }, [tab, updateTabStatus, addToast]);

    useEffect(() => {
        const unlisteners: Array<() => void> = [];

        const setup = async () => {
            const ulInit = await listen<VncInitPayload>('vnc:init', ({ payload }) => {
                if (payload.session_id !== tab.id) return;
                setFbSize({ w: payload.width, h: payload.height });
                setFbName(payload.name);
                setPhase('connected');
                updateTabStatus(tab.id, 'connected');

                // Size canvas to match framebuffer
                if (canvasRef.current) {
                    canvasRef.current.width = payload.width;
                    canvasRef.current.height = payload.height;
                }
            });

            const ulRect = await listen<VncRectPayload>('vnc:rect', ({ payload }) => {
                if (payload.session_id !== tab.id) return;
                const canvas = canvasRef.current;
                if (!canvas) return;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                // Decode base64 RGBA
                const binStr = atob(payload.data);
                const bytes = new Uint8ClampedArray(binStr.length);
                for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);

                const imageData = new ImageData(bytes, payload.width, payload.height);
                ctx.putImageData(imageData, payload.x, payload.y);
            });

            const ulCopyRect = await listen<VncCopyRectPayload>('vnc:copyrect', ({ payload }) => {
                if (payload.session_id !== tab.id) return;
                const canvas = canvasRef.current;
                if (!canvas) return;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                // Blit the existing canvas region from (src_x, src_y) to (x, y).
                // drawImage with the same canvas as both source and destination
                // is well-defined on HTMLCanvasElement: the browser snapshots
                // the source rect before drawing it back, so overlapping copies
                // work correctly.
                ctx.drawImage(
                    canvas,
                    payload.src_x, payload.src_y, payload.width, payload.height,
                    payload.x, payload.y, payload.width, payload.height,
                );
            });

            const ulError = await listen<VncStatusPayload>('vnc:error', ({ payload }) => {
                if (payload.session_id !== tab.id) return;
                setPhase('error');
                setErrorMsg(payload.message);
                updateTabStatus(tab.id, 'error');
            });

            const ulDisc = await listen<VncStatusPayload>('vnc:disconnected', ({ payload }) => {
                if (payload.session_id !== tab.id) return;
                setPhase('disconnected');
                updateTabStatus(tab.id, 'disconnected');
            });

            unlisteners.push(ulInit, ulRect, ulCopyRect, ulError, ulDisc);
            connect();
        };

        setup();

        return () => {
            unlisteners.forEach(u => u());
            api.vncNativeDisconnect(tab.id).catch(() => {});
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleReconnect = () => {
        didConnect.current = false;
        setErrorMsg(null);
        connect();
    };

    const handleFullscreen = () => {
        canvasRef.current?.requestFullscreen?.();
    };

    // Translate KeyboardEvent to X11 keysym (simplified subset)
    const handleKeyDown = (e: React.KeyboardEvent) => {
        e.preventDefault();
        const keysym = keyToKeysym(e.key, e.code);
        if (keysym) api.vncNativeKeyEvent(tab.id, keysym, true).catch(() => {});
    };

    const handleKeyUp = (e: React.KeyboardEvent) => {
        e.preventDefault();
        const keysym = keyToKeysym(e.key, e.code);
        if (keysym) api.vncNativeKeyEvent(tab.id, keysym, false).catch(() => {});
    };

    return (
        <div
            className={`w-full h-full flex flex-col bg-black relative ${isActive ? 'flex' : 'hidden'}`}
        >
            {/* Floating auto-hide toolbar */}
            <VncToolbar
                sessionId={tab.id}
                connectionName={tab.connectionName}
                fbName={fbName}
                fbSize={fbSize}
                phase={phase}
                onReconnect={handleReconnect}
                onDisconnect={() => api.vncNativeDisconnect(tab.id).catch(() => {})}
                onClose={() => closeTab(tab.id)}
                onFullscreen={handleFullscreen}
            />

            {/* Canvas area */}
            <div className="flex-1 overflow-auto flex items-center justify-center">
                {(phase === 'error' || phase === 'disconnected') && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="bg-surface border border-border rounded-xl p-6 max-w-sm text-center pointer-events-auto">
                            <Monitor className="w-10 h-10 mx-auto text-purple-400 mb-3" />
                            {phase === 'error' && (
                                <p className="text-red-400 text-sm mb-4">{errorMsg}</p>
                            )}
                            {phase === 'disconnected' && (
                                <p className="text-text-muted text-sm mb-4">Session disconnected.</p>
                            )}
                            <div className="flex gap-2 justify-center">
                                <button
                                    onClick={handleReconnect}
                                    className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
                                >
                                    Reconnect
                                </button>
                                <button
                                    onClick={() => closeTab(tab.id)}
                                    className="px-3 py-1.5 bg-surface border border-border rounded text-sm hover:bg-white/5"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                <canvas
                    ref={canvasRef}
                    tabIndex={0}
                    onKeyDown={handleKeyDown}
                    onKeyUp={handleKeyUp}
                    data-no-contextmenu
                    className="outline-none cursor-crosshair"
                    style={{ imageRendering: 'pixelated' }}
                />
            </div>
        </div>
    );
}

// Minimal X11 keysym map for common keys
function keyToKeysym(key: string, _code: string): number | null {
    if (key.length === 1) return key.charCodeAt(0);
    const map: Record<string, number> = {
        Enter: 0xff0d, Escape: 0xff1b, Backspace: 0xff08, Tab: 0xff09,
        Delete: 0xffff, Home: 0xff50, End: 0xff57,
        ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54,
        PageUp: 0xff55, PageDown: 0xff56, Insert: 0xff63,
        F1: 0xffbe, F2: 0xffbf, F3: 0xffc0, F4: 0xffc1, F5: 0xffc2,
        F6: 0xffc3, F7: 0xffc4, F8: 0xffc5, F9: 0xffc6, F10: 0xffc7,
        F11: 0xffc8, F12: 0xffc9,
        Shift: 0xffe1, Control: 0xffe3, Alt: 0xffe9, Meta: 0xffeb,
        CapsLock: 0xffe5, ' ': 0x0020,
    };
    return map[key] ?? null;
}
