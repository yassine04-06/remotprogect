import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useConnectionStore, useTabStore, useUIStore, useCredentialStore } from '../store';
import type { ServerConnection, Group } from '../types';
import { motion, AnimatePresence } from 'framer-motion';
import { ExternalToolsMenu } from './ExternalToolsMenu';
import {
    Plus,
    Search,
    Terminal,
    Monitor,
    ChevronRight,
    ChevronDown,
    Folder,
    FolderOpen,
    FolderPlus,
    Layout,
    Edit2,
    Trash2,
    Play,
    Globe,
    MoreVertical,
    FolderSync,
    KeyRound,
    Star,
    Tag,
} from 'lucide-react';
import type { CredentialProfile } from '../types';
import * as api from '../services/api';
import { confirm } from '@tauri-apps/plugin-dialog';

interface ContextMenuState {
    x: number;
    y: number;
    connection: ServerConnection;
}

type FlatItem =
    | { type: 'group'; id: string; group: Group; connectionsCount: number; isExpanded: boolean; depth: number }
    | { type: 'server'; id: string; connection: ServerConnection; depth: number };

export const ServerSidebar: React.FC = () => {
    const connections = useConnectionStore(s => s.connections);
    const groups = useConnectionStore(s => s.groups);
    const searchQuery = useConnectionStore(s => s.searchQuery);
    const setSearchQuery = useConnectionStore(s => s.setSearchQuery);
    const setEditingConnection = useConnectionStore(s => s.setEditingConnection);
    const setEditingGroup = useConnectionStore(s => s.setEditingGroup);
    const deleteConnection = useConnectionStore(s => s.deleteConnection);
    const deleteGroup = useConnectionStore(s => s.deleteGroup);

    const tabs = useTabStore(s => s.tabs);
    const activeTabId = useTabStore(s => s.activeTabId);
    const openTab = useTabStore(s => s.openTab);

    const setShowConnectionDialog = useUIStore(s => s.setShowConnectionDialog);
    const setShowGroupDialog = useUIStore(s => s.setShowGroupDialog);
    const setShowImportDialog = useUIStore(s => s.setShowImportDialog);
    const addToast = useUIStore(s => s.addToast);

    const credentialProfiles = useCredentialStore(s => s.credentialProfiles);

    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [groupContextMenu, setGroupContextMenu] = useState<{
        x: number;
        y: number;
        group: Group;
    } | null>(null);
    const [showTools, setShowTools] = useState(false);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    // 90-7: tag filter + sort
    const [tagFilter, setTagFilter] = useState<string | null>(null);
    const [sortMode, setSortMode] = useState<'alpha' | 'recent' | 'favorites'>('alpha');
    // 90-9: drag & drop — id of folder/'root' currently hovered as drop target
    const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
    // Manual ordering (persisted). { id, pos } = current drop indicator.
    const [dropInfo, setDropInfo] = useState<{ id: string; pos: 'before' | 'after' | 'inside' } | null>(null);
    // Single mixed manual order for folders + connections. Keys: "g:<id>" / "c:<id>".
    const [itemOrder, setItemOrder] = useState<string[]>(() => {
        try { return JSON.parse(localStorage.getItem('nexorc_item_order') || '[]'); } catch { return []; }
    });
    const keyOf = (kind: 'conn' | 'group', id: string) => `${kind === 'conn' ? 'c' : 'g'}:${id}`;
    const orderIndex = useCallback(
        (key: string) => { const i = itemOrder.indexOf(key); return i < 0 ? Infinity : i; },
        [itemOrder]
    );
    // Move dragKey adjacent to targetKey within the persisted mixed order.
    const reorderItems = (dragKey: string, targetKey: string, pos: 'before' | 'after', allKeys: string[]) => {
        const normalized = [
            ...itemOrder.filter(x => allKeys.includes(x)),
            ...allKeys.filter(x => !itemOrder.includes(x)),
        ];
        const without = normalized.filter(x => x !== dragKey);
        let to = without.indexOf(targetKey);
        if (to < 0) to = without.length;
        if (pos === 'after') to += 1;
        const next = [...without.slice(0, to), dragKey, ...without.slice(to)];
        setItemOrder(next);
        localStorage.setItem('nexorc_item_order', JSON.stringify(next));
    };

    useEffect(() => {
        const handler = () => {
            setContextMenu(null);
            setGroupContextMenu(null);
            setShowTools(false);
        };
        window.addEventListener('click', handler);
        return () => window.removeEventListener('click', handler);
    }, []);

    const toggleGroup = useCallback((id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (justDragged.current) return; // ignore the click right after a drag
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleContextMenu = (e: React.MouseEvent, connection: ServerConnection) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, connection });
    };

    const handleGroupContextMenu = (e: React.MouseEvent, group: Group) => {
        e.preventDefault();
        e.stopPropagation();
        setGroupContextMenu({ x: e.clientX, y: e.clientY, group });
    };

    const handleDelete = useCallback(
        async (connection: ServerConnection) => {
            setContextMenu(null);
            const ok = await confirm(`Delete "${connection.name}"?`, { title: 'Confirm Delete', kind: 'warning' });
            if (!ok) return;
            try {
                await deleteConnection(connection.id);
            } catch (err) {
                addToast({ type: 'error', title: 'Delete failed', description: String(err) });
            }
        },
        [deleteConnection, addToast]
    );

    const refreshConnections = useCallback(async () => {
        const { setConnections, setGroups } = useConnectionStore.getState();
        const [conns, grps] = await Promise.all([api.getConnections(), api.getGroups()]);
        setConnections(conns);
        setGroups(grps);
    }, []);

    // 90-7: toggle favorite
    const handleToggleFavorite = useCallback(async (conn: ServerConnection, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await api.toggleFavorite(conn.id);
            await refreshConnections();
        } catch (err) {
            addToast({ type: 'error', title: 'Favorite toggle failed', description: String(err) });
        }
    }, [addToast, refreshConnections]);

    // ── Pointer-based drag & drop ─────────────────────────────────────────────
    // Tauri's WebView intercepts native HTML5 drag events (for OS file-drop), so
    // we implement reordering/nesting with pointer events instead. Rows carry
    // data-rowid / data-rowkind; we hit-test with elementFromPoint on move.
    const dragRef = useRef<{ kind: 'conn' | 'group'; id: string } | null>(null);
    const dropRef = useRef<{ id: string | null; kind: 'conn' | 'group' | 'root'; pos: 'before' | 'after' | 'inside' } | null>(null);
    const startPt = useRef<{ x: number; y: number } | null>(null);
    const dragActive = useRef(false);
    const justDragged = useRef(false);
    const dndAbort = useRef<AbortController | null>(null);

    const performMove = useCallback(async () => {
        const drag = dragRef.current;
        const drop = dropRef.current;
        if (!drag || !drop) return;
        const { kind: dragKind, id: dragId } = drag;
        if (drop.kind !== 'root' && drop.id === dragId) return;
        try {
            // Move into a folder (or to root)
            if (drop.kind === 'root' || (drop.pos === 'inside' && drop.kind === 'group')) {
                const target = drop.kind === 'root' ? null : drop.id;
                if (dragKind === 'conn') await api.updateConnectionGroup(dragId, target);
                else if (dragId !== target) await api.updateGroupParent(dragId, target);
                await refreshConnections();
                return;
            }
            // before/after a target row (folder OR connection) — interleaved order.
            const targetId = drop.id as string;
            const targetParent =
                drop.kind === 'group'
                    ? (groups.find(g => g.id === targetId)?.parent_id ?? null)
                    : (connections.find(c => c.id === targetId)?.group_id ?? null);
            // reparent dragged item into the target's parent if needed
            if (dragKind === 'conn') {
                const cur = connections.find(c => c.id === dragId)?.group_id ?? null;
                if (cur !== targetParent) await api.updateConnectionGroup(dragId, targetParent);
            } else {
                const cur = groups.find(g => g.id === dragId)?.parent_id ?? null;
                if (cur !== targetParent && dragId !== targetParent) await api.updateGroupParent(dragId, targetParent);
            }
            // single mixed order array — folders & connections interleave freely
            const dir: 'before' | 'after' = drop.pos === 'before' ? 'before' : 'after';
            const allKeys = [
                ...groups.map(g => keyOf('group', g.id)),
                ...connections.map(c => keyOf('conn', c.id)),
            ];
            reorderItems(keyOf(dragKind, dragId), keyOf(drop.kind as 'conn' | 'group', targetId), dir, allKeys);
            await refreshConnections();
        } catch (err) {
            addToast({ type: 'error', title: 'Move failed', description: String(err) });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groups, connections, itemOrder, refreshConnections, addToast]);

    const onPointerMove = useCallback((e: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        // require a small threshold before activating drag (so clicks still work)
        if (!dragActive.current) {
            const s = startPt.current;
            if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 5) return;
            dragActive.current = true;
        }
        const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
            '[data-rowid]'
        ) as HTMLElement | null;
        const id = el?.getAttribute('data-rowid');
        if (!el || !id) {
            dropRef.current = { id: null, kind: 'root', pos: 'inside' };
            setDragOverGroupId('root');
            setDropInfo(null);
            return;
        }
        const kind = el.getAttribute('data-rowkind') as 'conn' | 'group';
        const r = el.getBoundingClientRect();
        const y = e.clientY - r.top;
        let pos: 'before' | 'after' | 'inside';
        if (kind === 'group') {
            // wider before/after bands (≈40% each) so dropping BETWEEN folders is
            // easy; only the central ~20% means "into the folder".
            pos = y < r.height * 0.4 ? 'before' : y > r.height * 0.6 ? 'after' : 'inside';
        } else {
            pos = y < r.height * 0.5 ? 'before' : 'after';
        }
        dropRef.current = { id, kind, pos };
        setDragOverGroupId(null);
        setDropInfo(id === drag.id ? null : { id, pos });
    }, []);

    const onPointerUp = useCallback(() => {
        dndAbort.current?.abort(); // detaches both move + up listeners
        dndAbort.current = null;
        const wasDragging = dragActive.current;
        dragActive.current = false;
        if (wasDragging) {
            justDragged.current = true; // suppress the click that follows a drag
            setTimeout(() => { justDragged.current = false; }, 0);
            performMove();
        }
        dragRef.current = null;
        dropRef.current = null;
        startPt.current = null;
        setDropInfo(null);
        setDragOverGroupId(null);
    }, [performMove]);

    const startDrag = useCallback(
        (e: React.PointerEvent, kind: 'conn' | 'group', id: string) => {
            if (e.button !== 0) return;
            dragRef.current = { kind, id };
            startPt.current = { x: e.clientX, y: e.clientY };
            dragActive.current = false;
            const ac = new AbortController();
            dndAbort.current = ac;
            window.addEventListener('pointermove', onPointerMove, { signal: ac.signal });
            window.addEventListener('pointerup', onPointerUp, { signal: ac.signal });
        },
        [onPointerMove, onPointerUp]
    );

    // 30-13: O(1) tab-status lookup — replaces O(n) find inside every renderItem call

    // 30-13: O(1) tab-status lookup — replaces O(n) find inside every renderItem call
    const tabStatusByConn = useMemo(() => {
        const map = new Map<string, string>();
        for (const t of tabs) {
            if (t.connectionId) map.set(t.connectionId, t.status);
        }
        return map;
    }, [tabs]);

    const getTabStatus = useCallback(
        (connectionId: string) => tabStatusByConn.get(connectionId) ?? 'idle',
        [tabStatusByConn]
    );

    // 30-13: O(1) profile lookup — replaces O(n) find inside every ConnectionItem render
    const profileById = useMemo(() => {
        const map = new Map(credentialProfiles.map(p => [p.id, p]));
        return map;
    }, [credentialProfiles]);

    // 90-7: collect all unique tags across connections
    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        connections.forEach(c => {
            if (c.tags) c.tags.split(',').forEach(t => { const s = t.trim(); if (s) tagSet.add(s); });
        });
        return Array.from(tagSet).sort();
    }, [connections]);

    const filteredConnections = useMemo(() => {
        let list = connections.filter(
            c =>
                c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                c.host.toLowerCase().includes(searchQuery.toLowerCase())
        );
        if (tagFilter) {
            list = list.filter(c => c.tags?.split(',').map(t => t.trim()).includes(tagFilter));
        }
        if (sortMode === 'favorites') {
            list = list.filter(c => c.is_favorite);
        } else if (sortMode === 'recent') {
            list = [...list].sort((a, b) => (b.last_connected_at ?? 0) - (a.last_connected_at ?? 0));
        }
        // 'alpha' → ordering handled per-parent in visibleNodes (mixed manual order)
        return list;
    }, [connections, searchQuery, tagFilter, sortMode]);

    // Recursively count connections in a folder + all its subfolders.
    const countDeep = useCallback(
        (groupId: string): number => {
            const walk = (id: string): number => {
                let n = connections.filter(c => c.group_id === id).length;
                for (const child of groups.filter(g => g.parent_id === id)) n += walk(child.id);
                return n;
            };
            return walk(groupId);
        },
        [connections, groups]
    );

    // Flatten the folder tree (supports nested subfolders via parent_id) into an
    // ordered list with depth, honoring expand/collapse — feeds the virtual list.
    const visibleNodes = useMemo(() => {
        const nodes: FlatItem[] = [];
        // Children of a parent = subfolders + connections, INTERLEAVED by the
        // single mixed manual order (so a session can sit between two folders).
        // Fallback when unordered: folders before connections, then name.
        const childrenOf = (parentId: string | null) => {
            const folders = groups
                .filter(g => (g.parent_id ?? null) === parentId)
                .map(g => ({ kind: 'group' as const, id: g.id, group: g }));
            const conns = filteredConnections
                .filter(c => (c.group_id ?? null) === parentId)
                .map(c => ({ kind: 'conn' as const, id: c.id, conn: c }));
            const all = [...folders, ...conns];
            all.sort((a, b) => {
                const ia = orderIndex(keyOf(a.kind, a.id));
                const ib = orderIndex(keyOf(b.kind, b.id));
                if (ia !== ib) return ia - ib;
                // both unordered → folders first, then alpha
                if (a.kind !== b.kind) return a.kind === 'group' ? -1 : 1;
                const an = a.kind === 'group' ? a.group.name : a.conn.name;
                const bn = b.kind === 'group' ? b.group.name : b.conn.name;
                return an.localeCompare(bn);
            });
            return all;
        };

        const walk = (parentId: string | null, depth: number) => {
            for (const item of childrenOf(parentId)) {
                if (item.kind === 'group') {
                    const isExpanded = expandedGroups.has(item.id);
                    nodes.push({
                        type: 'group',
                        id: item.id,
                        group: item.group,
                        connectionsCount: countDeep(item.id),
                        isExpanded,
                        depth,
                    });
                    if (isExpanded) walk(item.id, depth + 1);
                } else {
                    nodes.push({ type: 'server', id: item.id, connection: item.conn, depth });
                }
            }
        };

        walk(null, 0);
        return nodes;
    }, [groups, filteredConnections, expandedGroups, countDeep, orderIndex]);

    const renderItem = useCallback(
        (item: FlatItem, style: React.CSSProperties) => {
            if (item.type === 'group') {
                const { group, isExpanded, connectionsCount, depth } = item;
                return (
                    <div style={{ ...style, paddingLeft: depth * 14 }} className="pr-2">
                        <div
                            data-rowid={group.id}
                            data-rowkind="group"
                            className={`relative w-full flex items-center gap-2 px-3 h-full rounded-xl text-text-muted hover:bg-accent/5 transition-all group/header cursor-grab active:cursor-grabbing select-none ${dropInfo?.id === group.id && dropInfo.pos === 'inside' ? 'bg-accent/20 ring-1 ring-accent/60' : ''}`}
                            onClick={e => toggleGroup(group.id, e)}
                            onContextMenu={e => handleGroupContextMenu(e, group)}
                            onPointerDown={e => startDrag(e, 'group', group.id)}
                        >
                            {dropInfo?.id === group.id && dropInfo.pos === 'before' && (
                                <span className="absolute -top-px left-2 right-2 h-0.5 bg-accent rounded-full" />
                            )}
                            {dropInfo?.id === group.id && dropInfo.pos === 'after' && (
                                <span className="absolute -bottom-px left-2 right-2 h-0.5 bg-accent rounded-full" />
                            )}
                            {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                                <ChevronRight className="w-3.5 h-3.5" />
                            )}
                            <div className="flex-1 flex items-center justify-between min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                    {isExpanded ? (
                                        <FolderOpen className="w-4 h-4 text-accent/70" />
                                    ) : (
                                        <Folder className="w-4 h-4 text-text-muted/50" />
                                    )}
                                    <span
                                        className={`text-[11px] font-bold uppercase tracking-wider truncate ${isExpanded ? 'text-text-primary' : 'text-text-muted'}`}
                                    >
                                        {group.name}
                                    </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <span className="text-[10px] font-mono opacity-40 bg-accent/5 px-2 py-0.5 rounded-full">
                                        {connectionsCount}
                                    </span>
                                    <div className="hidden group-hover/header:flex items-center gap-0.5 ml-1">
                                        <button
                                            type="button"
                                            onClick={e => {
                                                e.stopPropagation();
                                                setEditingGroup(group);
                                                setShowGroupDialog(true);
                                            }}
                                            className="p-1 hover:bg-accent/10 rounded-md text-text-muted hover:text-text-primary transition-colors"
                                            title="Rename Folder"
                                            aria-label="Rename folder"
                                        >
                                            <Edit2 className="w-3 h-3" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={async e => {
                                                e.stopPropagation();
                                                const ok = await confirm(
                                                    `Delete folder "${group.name}"? Connections inside will become ungrouped.`,
                                                    { title: 'Confirm Delete', kind: 'warning' }
                                                );
                                                if (!ok) return;
                                                await deleteGroup(group.id);
                                            }}
                                            className="p-1 hover:bg-red-500/10 rounded-md text-text-muted hover:text-red-400 transition-colors"
                                            title="Delete Folder"
                                            aria-label="Delete folder"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            }

            const conn = item.connection;
            const isActive =
                activeTabId === conn.id ||
                tabs.some(t => t.connectionId === conn.id && t.id === activeTabId);
            const status = getTabStatus(conn.id);

            return (
                <div
                    data-rowid={conn.id}
                    data-rowkind="conn"
                    style={{ ...style, paddingLeft: item.depth * 14 }}
                    onPointerDown={e => startDrag(e, 'conn', conn.id)}
                    className={`relative pr-2 ${item.depth > 0 ? 'pl-2 border-l border-border/40' : ''}`}
                >
                    {dropInfo?.id === conn.id && dropInfo.pos === 'before' && (
                        <span className="absolute top-0 left-2 right-2 h-0.5 bg-accent rounded-full z-10" />
                    )}
                    {dropInfo?.id === conn.id && dropInfo.pos === 'after' && (
                        <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full z-10" />
                    )}
                    <ConnectionItem
                        connection={conn}
                        profile={profileById.get(conn.credential_profile_id ?? '')}
                        status={status}
                        isActive={isActive}
                        onOpen={() => { if (!justDragged.current) openTab(conn); }}
                        onEdit={() => {
                            setEditingConnection(conn);
                            setShowConnectionDialog(true);
                        }}
                        onContextMenu={e => handleContextMenu(e, conn)}
                        onToggleFavorite={e => handleToggleFavorite(conn, e)}
                    />
                </div>
            );
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            visibleNodes,
            toggleGroup,
            expandedGroups,
            activeTabId,
            tabs,
            getTabStatus,
            profileById,
            openTab,
            setEditingConnection,
            setShowConnectionDialog,
            setEditingGroup,
            setShowGroupDialog,
            deleteGroup,
            startDrag,
            dropInfo,
            handleToggleFavorite,
        ]
    );

    return (
        <div className="w-64 flex flex-col h-full bg-surface border-r border-border select-none">
            <div className="h-12 flex items-center justify-between px-4 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                        <Layout className="w-4 h-4 text-accent" />
                    </div>
                    <span className="text-sm font-bold tracking-tight">NexoRC Vault</span>
                </div>
                <div className="flex items-center gap-0.5">
                    <button
                        type="button"
                        className="p-1.5 hover:bg-accent/5 rounded-md text-text-muted hover:text-accent transition-colors"
                        onClick={() => setShowImportDialog(true)}
                        title="Import Connections"
                        aria-label="Import Connections"
                    >
                        <FolderSync className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        className="p-1.5 hover:bg-accent/5 rounded-md text-text-muted hover:text-accent transition-colors"
                        onClick={() => {
                            setEditingGroup(null);
                            setShowGroupDialog(true);
                        }}
                        title="New Folder"
                        aria-label="New Folder"
                    >
                        <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        className="p-1.5 hover:bg-accent/5 rounded-md text-text-muted hover:text-accent transition-colors"
                        onClick={() => {
                            setEditingConnection(null);
                            setShowConnectionDialog(true);
                        }}
                        title="New Connection"
                        aria-label="New Connection"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="p-3 shrink-0">
                <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted group-focus-within:text-accent transition-colors" />
                    <input
                        type="search"
                        placeholder="Search infrastructure..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full h-10 pl-10 pr-4 bg-accent/5 border border-border rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-accent/40 focus:bg-accent/5 transition-all"
                    />
                </div>
            </div>

            {/* 90-7: Sort + tag filter bar */}
            <div className="px-3 pb-2 shrink-0 space-y-2">
                <div className="flex gap-1">
                    {(['alpha', 'recent', 'favorites'] as const).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setSortMode(mode)}
                            className={`flex-1 py-1 text-[9px] font-bold uppercase rounded transition-colors ${sortMode === mode ? 'bg-accent text-white' : 'bg-base text-text-muted hover:text-text-primary'}`}
                        >
                            {mode === 'alpha' ? 'A–Z' : mode === 'recent' ? 'Recent' : '★ Starred'}
                        </button>
                    ))}
                </div>
                {allTags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                        {allTags.map(tag => (
                            <button
                                key={tag}
                                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-semibold transition-colors ${tagFilter === tag ? 'bg-accent text-white' : 'bg-white/5 text-text-muted hover:bg-white/10'}`}
                            >
                                <Tag className="w-2.5 h-2.5" />{tag}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Scrollable tree — drop in empty area = move to root */}
            <div
                className={`flex-1 min-h-0 overflow-y-auto custom-scrollbar pl-2 pr-1 ${dragOverGroupId === 'root' ? 'bg-accent/5 ring-1 ring-inset ring-accent/30' : ''}`}
            >
                {visibleNodes.length > 0 ? (
                    <div className="py-1">
                        {visibleNodes.map(node => (
                            <React.Fragment key={node.id}>
                                {renderItem(node, { height: 36 })}
                            </React.Fragment>
                        ))}
                    </div>
                ) : (
                    <div className="mt-12 px-6 flex flex-col items-center text-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5">
                            <Search className="w-5 h-5 opacity-20" />
                        </div>
                        <div className="text-[10px] font-bold text-text-muted/50 uppercase tracking-widest leading-relaxed">
                            {searchQuery ? 'No results found' : 'Secure Vault Empty'}
                        </div>
                        {!searchQuery && (
                            <div className="text-[10px] text-text-muted/30 leading-relaxed">
                                Click + to add a connection
                                <br />
                                or create a folder
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="p-4 border-t border-border bg-base/20 mt-auto">
                <div className="flex items-center gap-3 px-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                    <div className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
                        Encrypted Node
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {contextMenu && (
                    <motion.div
                        ref={contextMenuRef}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="fixed z-[100] bg-surface border border-border rounded-xl shadow-2xl p-1.5 min-w-[180px] backdrop-blur-xl"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                        onClick={e => e.stopPropagation()}
                    >
                        {!showTools ? (
                            <>
                                <button
                                    type="button"
                                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-accent hover:text-white rounded-lg transition-colors"
                                    onClick={() => {
                                        openTab(contextMenu.connection);
                                        setContextMenu(null);
                                    }}
                                >
                                    <Play className="w-3.5 h-3.5" /> Connect
                                </button>
                                <button
                                    type="button"
                                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-white/5 rounded-lg transition-colors"
                                    onClick={() => {
                                        setEditingConnection(contextMenu.connection);
                                        setShowConnectionDialog(true);
                                        setContextMenu(null);
                                    }}
                                >
                                    <Edit2 className="w-3.5 h-3.5" /> Edit Connection
                                </button>
                                <button
                                    type="button"
                                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-white/5 rounded-lg transition-colors justify-between"
                                    onClick={() => setShowTools(true)}
                                >
                                    <div className="flex items-center gap-3">
                                        <Globe className="w-3.5 h-3.5" /> External Tools
                                    </div>
                                    <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                                </button>
                                <div className="h-px bg-border my-1.5 mx-1.5" />
                                <button
                                    type="button"
                                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-red-500 hover:text-white rounded-lg transition-colors"
                                    onClick={() => handleDelete(contextMenu.connection)}
                                >
                                    <Trash2 className="w-3.5 h-3.5" /> Delete from Vault
                                </button>
                            </>
                        ) : (
                            <ExternalToolsMenu
                                connection={contextMenu.connection}
                                onClose={() => setContextMenu(null)}
                            />
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {groupContextMenu && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="fixed z-[100] bg-surface border border-border rounded-xl shadow-2xl p-1.5 min-w-[160px] backdrop-blur-xl"
                        style={{ top: groupContextMenu.y, left: groupContextMenu.x }}
                        onClick={e => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-accent/5 rounded-lg transition-colors"
                            onClick={() => {
                                setEditingGroup(groupContextMenu.group);
                                setShowGroupDialog(true);
                                setGroupContextMenu(null);
                            }}
                        >
                            <Edit2 className="w-3.5 h-3.5" /> Rename Folder
                        </button>
                        <div className="h-px bg-border my-1.5 mx-1.5" />
                        <button
                            type="button"
                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-red-500 hover:text-white rounded-lg transition-colors"
                            onClick={async () => {
                                setGroupContextMenu(null);
                                const ok = await confirm(
                                    `Delete folder "${groupContextMenu.group.name}"? Connections inside will become ungrouped.`,
                                    { title: 'Confirm Delete', kind: 'warning' }
                                );
                                if (!ok) return;
                                try {
                                    await deleteGroup(groupContextMenu.group.id);
                                } catch (err) {
                                    addToast({
                                        type: 'error',
                                        title: 'Delete folder failed',
                                        description: String(err),
                                    });
                                }
                            }}
                        >
                            <Trash2 className="w-3.5 h-3.5" /> Delete Folder
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

interface ConnectionItemProps {
    connection: ServerConnection;
    profile?: CredentialProfile;
    status: string;
    isActive: boolean;
    onOpen: () => void;
    onEdit: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onToggleFavorite: (e: React.MouseEvent) => void;
}

const ConnectionItem: React.FC<ConnectionItemProps> = React.memo(
    ({ connection, profile, status, isActive, onOpen, onEdit, onContextMenu, onToggleFavorite }) => {
        return (
            <div
                className={`w-full h-full flex items-center gap-2 px-2 py-0 rounded-md cursor-pointer group transition-colors select-none ${isActive ? 'bg-accent/20 text-accent font-bold' : 'hover:bg-accent/5 text-text-muted hover:text-text-primary'}`}
                onDoubleClick={onOpen}
                onClick={onOpen}
                onContextMenu={onContextMenu}
            >
                <div
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        status === 'connected'
                            ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]'
                            : status === 'connecting'
                              ? 'bg-yellow-500 animate-pulse'
                              : status === 'error'
                                ? 'bg-red-500'
                                : 'bg-transparent border border-border/50'
                    }`}
                />

                <div className="shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                    {connection.protocol === 'SSH' ? (
                        <Terminal className="w-3.5 h-3.5" />
                    ) : connection.protocol === 'RDP' ? (
                        <Monitor className="w-3.5 h-3.5" />
                    ) : connection.protocol === 'SFTP' ? (
                        <FolderSync className="w-3.5 h-3.5" />
                    ) : connection.protocol === 'FTP' ? (
                        <FolderOpen className="w-3.5 h-3.5" />
                    ) : (
                        <Globe className="w-3.5 h-3.5" />
                    )}
                </div>

                <div className="flex-1 min-w-0 flex items-center gap-1.5 truncate">
                    <span className="text-xs truncate">{connection.name}</span>
                    {connection.override_credentials ? (
                        <span className="text-[9px] font-bold text-orange-400 bg-orange-400/10 px-1 py-0.5 rounded flex items-center gap-1 shrink-0 uppercase ml-auto">
                            <Edit2 className="w-2.5 h-2.5" /> Custom
                        </span>
                    ) : profile ? (
                        <span
                            className="text-[9px] font-bold text-accent bg-accent/10 px-1 py-0.5 rounded flex items-center gap-1 shrink-0 uppercase truncate max-w-[80px] ml-auto"
                            title={profile.name}
                        >
                            <KeyRound className="w-2.5 h-2.5 shrink-0" /> {profile.name}
                        </span>
                    ) : (
                        <span className="text-[9px] font-bold opacity-30 uppercase shrink-0 ml-auto">
                            ({connection.protocol})
                        </span>
                    )}
                </div>

                {/* 90-7: favorite star (always visible when active, hover otherwise) */}
                <button
                    type="button"
                    onClick={onToggleFavorite}
                    className={`p-1 rounded-md transition-colors shrink-0 ${connection.is_favorite ? 'text-yellow-400' : 'hidden group-hover:block text-text-muted hover:text-yellow-400'}`}
                    title={connection.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                    aria-label={connection.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                    <Star className={`w-3 h-3 ${connection.is_favorite ? 'fill-yellow-400' : ''}`} />
                </button>
                <div className="hidden group-hover:flex items-center gap-1">
                    <button
                        type="button"
                        onClick={e => {
                            e.stopPropagation();
                            onEdit();
                        }}
                        className="p-1 hover:bg-accent/10 rounded-md text-text-muted hover:text-text-primary transition-colors"
                        aria-label="Edit connection"
                    >
                        <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                        type="button"
                        onClick={e => {
                            e.stopPropagation();
                            onContextMenu(e);
                        }}
                        className="p-1 hover:bg-accent/10 rounded-md text-text-muted hover:text-text-primary transition-colors"
                        aria-label="More options"
                    >
                        <MoreVertical className="w-3 h-3" />
                    </button>
                </div>
            </div>
        );
    }
);
