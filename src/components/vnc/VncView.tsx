// 90-11: Native VNC view — canvas-based rendering via vnc:* Tauri events
import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTabStore, useUIStore } from '../../store';
import * as api from '../../services/api';
import type { Tab } from '../../types';
import { Monitor, ShieldAlert, X } from 'lucide-react';
import { VncToolbar } from './VncToolbar';

interface VncInitPayload {
    session_id: string;
    width: number;
    height: number;
    name: string;
}

// Mirrors VncRectItem from vnc_client.rs (serde internally-tagged enum)
type VncRectItem =
    | { rect_type: 'raw'; x: number; y: number; width: number; height: number; data: string }
    | { rect_type: 'jpeg'; x: number; y: number; width: number; height: number; data: string }
    | { rect_type: 'copyrect'; x: number; y: number; width: number; height: number; src_x: number; src_y: number };

interface VncFramePayload {
    session_id: string;
    rects: VncRectItem[];
}

interface VncStatusPayload {
    session_id: string;
    message: string;
}

// Mirrors VncSecurityWarningEvent from vnc_client.rs — emitted when the
// connection uses weak/absent encryption and is NOT wrapped in an SSH tunnel.
// security_type: 1 = None, 2 = VNC Auth (DES-56), null = pre-connect notice.
interface VncSecurityWarningPayload {
    session_id: string;
    message: string;
    security_type: number | null;
}

// Decoded rect ready for synchronous canvas drawing inside a RAF callback
type PreparedRect =
    | { type: 'raw'; x: number; y: number; w: number; h: number; bytes: Uint8ClampedArray }
    | { type: 'jpeg'; x: number; y: number; bitmap: ImageBitmap }
    | { type: 'copyrect'; x: number; y: number; w: number; h: number; sx: number; sy: number };

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
    const [securityWarning, setSecurityWarning] = useState<string | null>(null);
    const didConnect = useRef(false);

    // RAF render queue: accumulate decoded rects, flush atomically on the next
    // animation frame (~16 ms). Multiple vnc:frame events in the same 16 ms
    // window are coalesced into a single draw pass — no partial-frame flicker.
    const pendingRef = useRef<PreparedRect[]>([]);
    const rafRef = useRef<number | null>(null);

    const scheduleRender = useCallback(() => {
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            const rects = pendingRef.current.splice(0);
            for (const r of rects) {
                if (r.type === 'raw') {
                    ctx.putImageData(new ImageData(r.bytes, r.w, r.h), r.x, r.y);
                } else if (r.type === 'jpeg') {
                    ctx.drawImage(r.bitmap, r.x, r.y);
                    r.bitmap.close();
                } else {
                    // copyrect: blit canvas region — drawImage on self is safe
                    ctx.drawImage(canvas, r.sx, r.sy, r.w, r.h, r.x, r.y, r.w, r.h);
                }
            }
        });
    }, []);

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

                if (canvasRef.current) {
                    canvasRef.current.width = payload.width;
                    canvasRef.current.height = payload.height;
                }
            });

            // Single batched frame event replaces separate vnc:rect / vnc:copyrect.
            // JPEG rects are pre-decoded via createImageBitmap before entering the
            // RAF queue, so the RAF callback itself is always synchronous.
            const ulFrame = await listen<VncFramePayload>('vnc:frame', async ({ payload }) => {
                if (payload.session_id !== tab.id) return;

                const prepared: PreparedRect[] = await Promise.all(
                    payload.rects.map(async (rect): Promise<PreparedRect> => {
                        if (rect.rect_type === 'raw') {
                            const bin = atob(rect.data);
                            const bytes = new Uint8ClampedArray(bin.length);
                            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                            return { type: 'raw', x: rect.x, y: rect.y, w: rect.width, h: rect.height, bytes };
                        }
                        if (rect.rect_type === 'jpeg') {
                            const bin = atob(rect.data);
                            const arr = new Uint8Array(bin.length);
                            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                            const bitmap = await createImageBitmap(
                                new Blob([arr], { type: 'image/jpeg' }),
                            );
                            return { type: 'jpeg', x: rect.x, y: rect.y, bitmap };
                        }
                        // copyrect — no pixel data, just blit coordinates
                        return {
                            type: 'copyrect',
                            x: rect.x, y: rect.y,
                            w: rect.width, h: rect.height,
                            sx: rect.src_x, sy: rect.src_y,
                        };
                    })
                );

                pendingRef.current.push(...prepared);
                scheduleRender();
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

            // Weak/absent VNC encryption with no SSH tunnel — surface a persistent
            // banner so the user knows the session is exposed. Backend emits this
            // both pre-connect (security_type null) and after the RFB handshake.
            const ulSecWarn = await listen<VncSecurityWarningPayload>('vnc:security_warning', ({ payload }) => {
                if (payload.session_id !== tab.id) return;
                setSecurityWarning(payload.message);
            });

            unlisteners.push(ulInit, ulFrame, ulError, ulDisc, ulSecWarn);
            connect();
        };

        setup();

        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            pendingRef.current = [];
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

            {securityWarning && (
                <div className="flex items-start gap-2 px-3 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-200 text-xs">
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <span className="flex-1 leading-snug">{securityWarning}</span>
                    <button
                        onClick={() => setSecurityWarning(null)}
                        className="shrink-0 p-0.5 rounded hover:bg-amber-500/20"
                        aria-label="Dismiss security warning"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}

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
