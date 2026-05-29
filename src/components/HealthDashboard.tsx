import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { useConnectionStore, useTabStore } from '../store';
import type { ServerConnection } from '../types';
import * as api from '../services/api';
import {
    Monitor,
    Server,
    Terminal,
    Lock,
    HardDrive,
    MonitorStop,
    RefreshCw,
    ChevronRight,
    Folder as FolderIcon,
    GripVertical,
} from 'lucide-react';

interface PingHistory {
    [connectionId: string]: {
        online: boolean;
        latency: number | null;
        history: (number | null)[];
    };
}

interface CardData {
    online: boolean;
    latency: number | null;
    history: (number | null)[];
}

const RECENT_LIMIT = 9;

function getProtocolIcon(protocol: string) {
    switch (protocol.toUpperCase()) {
        case 'SSH':
            return <Terminal className="w-4 h-4" />;
        case 'RDP':
            return <Monitor className="w-4 h-4" />;
        case 'VNC':
            return <MonitorStop className="w-4 h-4" />;
        case 'SFTP':
            return <Lock className="w-4 h-4" />;
        case 'FTP':
            return <HardDrive className="w-4 h-4" />;
        default:
            return <Server className="w-4 h-4" />;
    }
}

// ── Monitoring card ────────────────────────────────────────────────────────
const HealthCard: React.FC<{
    conn: ServerConnection;
    data: CardData | undefined;
    onOpen: () => void;
    onGripDown?: (e: React.PointerEvent) => void;
}> = ({ conn, data, onOpen, onGripDown }) => {
    const isOnline = data?.online ?? false;
    const latency = data?.latency ?? 0;
    const hasData = !!data;

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            onMouseMove={e => {
                const r = e.currentTarget.getBoundingClientRect();
                e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
                e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
            }}
            className="sheen glass-card rounded-2xl p-5 transition-[border-color,box-shadow] duration-300 hover:border-accent/40 flex flex-col gap-4 relative overflow-hidden group hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_30%,transparent),0_20px_60px_-20px_color-mix(in_srgb,var(--color-accent)_45%,transparent)] [&:hover::after]:[animation:sheen_0.9s_ease]"
        >
            {/* Cursor-follow spotlight */}
            <div
                className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                    background:
                        'radial-gradient(260px circle at var(--mx,50%) var(--my,50%), color-mix(in srgb, var(--color-accent) 16%, transparent), transparent 60%)',
                }}
            />
            {/* Status aura — online cards breathe softly */}
            <div
                className={`absolute -top-12 -right-12 w-36 h-36 rounded-full blur-3xl transition-colors duration-1000 ${hasData ? (isOnline ? 'bg-green-500 animate-[breathe_3.5s_ease-in-out_infinite]' : 'bg-red-500 opacity-20') : 'bg-gray-500 opacity-15'}`}
            />

            <div className="flex justify-between items-start z-10">
                <div
                    className="flex items-center gap-3 cursor-pointer flex-1 min-w-0"
                    onClick={onOpen}
                >
                    <div
                        className={`p-2.5 rounded-lg border flex items-center justify-center ${hasData ? (isOnline ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20') : 'bg-accent/5 text-text-muted border-white/10'}`}
                    >
                        {getProtocolIcon(conn.protocol)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-text-primary truncate" title={conn.name}>
                            {conn.name}
                        </h3>
                        <div className="text-[10px] uppercase font-bold tracking-wider text-text-muted mt-0.5 opacity-70 truncate" title={`${conn.host}:${conn.port}`}>
                            {conn.host}:{conn.port}
                        </div>
                    </div>
                </div>
                {/* compact status dot — keeps the whole top row free for the name */}
                <div className="flex items-center gap-1.5 shrink-0">
                    <span
                        title={hasData ? (isOnline ? 'Online' : 'Offline') : 'Checking…'}
                        className="relative flex h-2.5 w-2.5"
                    >
                        {hasData && isOnline && (
                            <span className="absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-50 animate-ping" />
                        )}
                        <span
                            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                                hasData ? (isOnline ? 'bg-green-400' : 'bg-red-400') : 'bg-text-muted/40 animate-pulse'
                            }`}
                        />
                    </span>
                    {onGripDown && (
                        <button
                            type="button"
                            onPointerDown={onGripDown}
                            title="Drag to reorder"
                            aria-label="Drag to reorder"
                            className="p-1 -mr-1 rounded-md text-text-muted/40 hover:text-accent hover:bg-accent/10 cursor-grab active:cursor-grabbing touch-none transition-all opacity-0 group-hover:opacity-100"
                        >
                            <GripVertical className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            <div className="z-10 mt-2 cursor-pointer" onClick={onOpen}>
                <div className="flex justify-between items-end mb-2">
                    <span className="text-xs font-bold text-text-muted uppercase tracking-widest">
                        Latency
                    </span>
                    {hasData && isOnline && (
                        <span className="text-2xl font-mono font-black bg-gradient-to-br from-text-primary to-accent bg-clip-text text-transparent tabular-nums">
                            {latency}
                            <span className="text-xs text-text-muted font-bold ml-0.5">ms</span>
                        </span>
                    )}
                    {hasData && !isOnline && (
                        <span className="text-sm font-mono font-bold text-red-400">TIMEOUT</span>
                    )}
                </div>

                {/* Sparkline — gradient bars */}
                <div className="h-10 w-full flex items-end justify-between gap-1 mt-3">
                    {(data?.history || Array(20).fill(null)).map((val, idx) => {
                        const h = val === null ? 4 : Math.min(100, Math.max(10, (val / 200) * 100));
                        return (
                            <div
                                key={idx}
                                style={{ height: `${h}%` }}
                                className={`flex-1 rounded-full transition-all duration-300 ${val === null ? 'bg-red-500/40 hover:bg-red-400/60' : 'bg-gradient-to-t from-accent/20 to-accent/70 hover:to-accent'}`}
                                title={val === null ? 'Timeout' : `${val}ms`}
                            />
                        );
                    })}
                </div>
            </div>
        </motion.div>
    );
};

const DASH_ORDER_KEY = 'nexorc_dash_order';

export const HealthDashboard: React.FC = () => {
    const connections = useConnectionStore(s => s.connections);
    const groups = useConnectionStore(s => s.groups);
    const openTab = useTabStore(s => s.openTab);
    const [healthData, setHealthData] = useState<PingHistory>({});
    const [isPinging, setIsPinging] = useState(false);
    // null = Recent view. Otherwise the folder currently being browsed.
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
    // Manual connection order (persisted, global id list).
    const [dashOrder, setDashOrder] = useState<string[]>(() => {
        try { return JSON.parse(localStorage.getItem(DASH_ORDER_KEY) || '[]'); } catch { return []; }
    });
    // Pointer drag-reorder state
    const dragRef = useRef<string | null>(null);
    const startPt = useRef<{ x: number; y: number } | null>(null);
    const dragActive = useRef(false);
    const justDragged = useRef(false);
    const [dropEdge, setDropEdge] = useState<{ id: string; edge: 'left' | 'right' } | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    // refs read inside the window pointer listeners (avoid stale closures)
    const edgeRef = useRef<{ id: string; edge: 'left' | 'right' } | null>(null);
    const connsRef = useRef(connections);
    connsRef.current = connections;

    // Deep count of connections in a folder + all subfolders.
    const countDeep = useCallback(
        (gid: string): number => {
            const walk = (id: string): number => {
                let n = connections.filter(c => c.group_id === id).length;
                for (const child of groups.filter(g => g.parent_id === id)) n += walk(child.id);
                return n;
            };
            return walk(gid);
        },
        [connections, groups]
    );

    // Breadcrumb path (root → current).
    const breadcrumb = useMemo(() => {
        const path: { id: string; name: string }[] = [];
        let cur = currentFolderId;
        for (let i = 0; i < 20 && cur; i++) {
            const g = groups.find(x => x.id === cur);
            if (!g) break;
            path.unshift({ id: g.id, name: g.name });
            cur = g.parent_id ?? null;
        }
        return path;
    }, [currentFolderId, groups]);

    // Subfolders of the current folder (only inside a folder view).
    const subfolders = useMemo(
        () =>
            currentFolderId
                ? groups.filter(g => g.parent_id === currentFolderId).sort((a, b) => a.name.localeCompare(b.name))
                : [],
        [groups, currentFolderId]
    );

    // Connections shown as cards: Recent (root) = latest N; folder = DIRECT only, manual order.
    const visibleConnections = useMemo(() => {
        if (!currentFolderId) {
            return [...connections]
                .sort((a, b) => (b.last_connected_at ?? 0) - (a.last_connected_at ?? 0))
                .slice(0, RECENT_LIMIT);
        }
        const direct = connections.filter(c => c.group_id === currentFolderId);
        const idx = (id: string) => { const i = dashOrder.indexOf(id); return i < 0 ? Infinity : i; };
        return [...direct].sort((a, b) => {
            const d = idx(a.id) - idx(b.id);
            return d !== 0 ? d : a.name.localeCompare(b.name);
        });
    }, [currentFolderId, connections, dashOrder]);

    // All top-level folders (even empty) → new folders appear immediately.
    const topGroups = useMemo(
        () => groups.filter(g => !g.parent_id).sort((a, b) => a.name.localeCompare(b.name)),
        [groups]
    );

    // ── Pointer drag-reorder for connection cards ─────────────────────────────
    const onCardMove = useCallback((e: PointerEvent) => {
        if (!dragRef.current) return;
        if (!dragActive.current) {
            const s = startPt.current;
            if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 5) return;
            dragActive.current = true;
            setDraggingId(dragRef.current);
        }
        const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
            '[data-cardid]'
        ) as HTMLElement | null;
        if (!el) { edgeRef.current = null; setDropEdge(null); return; }
        const id = el.getAttribute('data-cardid')!;
        if (id === dragRef.current) { edgeRef.current = null; setDropEdge(null); return; }
        const r = el.getBoundingClientRect();
        const next = { id, edge: (e.clientX < r.left + r.width / 2 ? 'left' : 'right') as 'left' | 'right' };
        edgeRef.current = next;
        setDropEdge(next);
    }, []);

    const onCardUp = useCallback(() => {
        window.removeEventListener('pointermove', onCardMove);
        window.removeEventListener('pointerup', onCardUp);
        const dragId = dragRef.current;
        const wasDragging = dragActive.current;
        const edge = edgeRef.current;
        dragRef.current = null;
        startPt.current = null;
        dragActive.current = false;
        edgeRef.current = null;
        setDropEdge(null);
        setDraggingId(null);
        if (wasDragging && dragId && edge) {
            justDragged.current = true;
            setTimeout(() => { justDragged.current = false; }, 0);
            const ids = connsRef.current.map(c => c.id);
            setDashOrder(prev => {
                const base = [...prev.filter(x => ids.includes(x)), ...ids.filter(x => !prev.includes(x))];
                const from = base.indexOf(dragId);
                if (from > -1) base.splice(from, 1);
                let to = base.indexOf(edge.id);
                if (to < 0) to = base.length;
                if (edge.edge === 'right') to += 1;
                base.splice(to, 0, dragId);
                localStorage.setItem(DASH_ORDER_KEY, JSON.stringify(base));
                return base;
            });
        }
    }, [onCardMove]);

    const startCardDrag = useCallback((e: React.PointerEvent, id: string) => {
        if (e.button !== 0) return;
        e.preventDefault(); // stop text selection while dragging
        dragRef.current = id;
        startPt.current = { x: e.clientX, y: e.clientY };
        dragActive.current = false;
        window.addEventListener('pointermove', onCardMove);
        window.addEventListener('pointerup', onCardUp);
    }, [onCardMove, onCardUp]);

    const runPings = useCallback(async () => {
        setIsPinging(true);
        const updates: Array<{ id: string; online: boolean; latency: number | null }> = [];
        await Promise.allSettled(
            connections.map(async conn => {
                try {
                    const latency = await api.pingServer(conn.host, conn.port);
                    updates.push({ id: conn.id, online: true, latency });
                } catch {
                    updates.push({ id: conn.id, online: false, latency: null });
                }
            })
        );
        setHealthData(prev => {
            const next = { ...prev };
            for (const { id, online, latency } of updates) {
                if (!next[id]) next[id] = { online, latency, history: [latency] };
                else next[id] = { online, latency, history: [...next[id].history, latency].slice(-20) };
            }
            return next;
        });
        setIsPinging(false);
    }, [connections]);

    // Initial ping + 10s interval
    useEffect(() => {
        runPings();
        const interval = setInterval(runPings, 10000);
        return () => clearInterval(interval);
    }, [runPings]);

    if (connections.length === 0) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex items-center justify-center flex-col text-text-muted"
            >
                <div className="relative mb-8">
                    <div className="absolute inset-0 bg-accent/20 blur-3xl rounded-full" />
                    <div className="relative w-24 h-24 bg-surface/50 backdrop-blur-xl border border-white/5 rounded-3xl flex items-center justify-center shadow-2xl">
                        <Monitor className="w-10 h-10 text-accent opacity-50" />
                    </div>
                </div>
                <h2 className="text-2xl font-bold text-text-primary mb-3 tracking-tight">
                    Health Dashboard
                </h2>
                <p className="text-[13px] opacity-60 max-w-[280px] text-center leading-relaxed">
                    No connections found. Add servers from the sidebar to start monitoring their
                    status and uptime.
                </p>
            </motion.div>
        );
    }

    return (
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6 bg-base">
            {/* Living aurora backdrop + film grain */}
            <div className="aurora-bg" />
            <div className="grain" />
            <div className="relative max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-3xl font-black tracking-tight bg-gradient-to-r from-text-primary via-accent to-accent-secondary bg-clip-text text-transparent [background-size:200%_auto] animate-[gradient-pan_6s_linear_infinite]">
                            Active Monitoring
                        </h1>
                        <p className="text-sm text-text-muted mt-1">
                            Real-time health status of your infrastructure
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => { if (!isPinging) runPings(); }}
                            disabled={isPinging}
                            title="Refresh now"
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/5 bg-surface text-xs font-semibold transition-colors hover:bg-accent/10 hover:text-accent hover:border-accent/30 disabled:cursor-not-allowed ${isPinging ? 'text-accent' : 'text-text-muted'}`}
                        >
                            <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`} />
                            {isPinging ? 'Pinging...' : 'Refresh'}
                        </button>
                    </div>
                </div>

                {/* Top-level folder chips (Recent + all top folders, even empty) */}
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                    <button
                        type="button"
                        onClick={() => setCurrentFolderId(null)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${currentFolderId === null ? 'bg-accent/15 text-accent border-accent/30' : 'bg-surface text-text-muted border-white/5 hover:text-text-primary hover:bg-accent/5'}`}
                    >
                        Recent
                    </button>
                    {topGroups.map(g => (
                        <button
                            key={g.id}
                            type="button"
                            onClick={() => setCurrentFolderId(g.id)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${breadcrumb[0]?.id === g.id ? 'bg-accent/15 text-accent border-accent/30' : 'bg-surface text-text-muted border-white/5 hover:text-text-primary hover:bg-accent/5'}`}
                        >
                            {g.name}
                        </button>
                    ))}
                </div>

                {/* Breadcrumb (inside a folder) */}
                {currentFolderId && (
                    <div className="flex items-center gap-1 mb-5 text-xs text-text-muted flex-wrap">
                        <button onClick={() => setCurrentFolderId(null)} className="hover:text-accent transition-colors">
                            Home
                        </button>
                        {breadcrumb.map(b => (
                            <span key={b.id} className="flex items-center gap-1">
                                <ChevronRight className="w-3 h-3 opacity-50" />
                                <button
                                    onClick={() => setCurrentFolderId(b.id)}
                                    className={`hover:text-accent transition-colors ${b.id === currentFolderId ? 'text-accent font-semibold' : ''}`}
                                >
                                    {b.name}
                                </button>
                            </span>
                        ))}
                    </div>
                )}

                {/* Subfolder cards — click to drill in */}
                {subfolders.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-5">
                        {subfolders.map(sf => (
                            <button
                                key={sf.id}
                                type="button"
                                onClick={() => setCurrentFolderId(sf.id)}
                                className="sheen relative overflow-hidden flex items-center gap-3 p-4 rounded-xl bg-surface/40 border border-border hover:border-accent/40 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-12px_color-mix(in_srgb,var(--color-accent)_50%,transparent)] transition-all duration-200 text-left group [&:hover::after]:[animation:sheen_0.9s_ease]"
                            >
                                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent/25 to-accent-secondary/10 ring-1 ring-accent/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                                    <FolderIcon className="w-4 h-4 text-accent" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-text-primary truncate">{sf.name}</div>
                                    <div className="text-[10px] uppercase tracking-wider text-text-muted">
                                        {countDeep(sf.id)} connections
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {/* Connection cards (direct). Drag from the grip handle to reorder. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {visibleConnections.map(conn => (
                        <div
                            key={conn.id}
                            data-cardid={conn.id}
                            className={`relative rounded-2xl transition-[opacity,transform] duration-150 ${
                                draggingId === conn.id ? 'opacity-40 scale-[0.97]' : ''
                            }`}
                        >
                            {/* insertion bar */}
                            {dropEdge?.id === conn.id && (
                                <span
                                    className={`absolute top-2 bottom-2 w-1 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)] z-20 ${
                                        dropEdge.edge === 'left' ? '-left-2.5' : '-right-2.5'
                                    }`}
                                />
                            )}
                            <HealthCard
                                conn={conn}
                                data={healthData[conn.id]}
                                onOpen={() => { if (!justDragged.current) openTab(conn); }}
                                onGripDown={currentFolderId ? e => startCardDrag(e, conn.id) : undefined}
                            />
                        </div>
                    ))}
                </div>

                {visibleConnections.length === 0 && subfolders.length === 0 && (
                    <p className="text-sm text-text-muted">
                        {currentFolderId ? 'Empty folder.' : 'No connections yet.'}
                    </p>
                )}
            </div>
        </div>
    );
};
