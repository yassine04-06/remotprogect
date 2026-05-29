import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { List } from 'react-window';
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
    Library,
    KeyRound,
    Star,
    Tag,
} from 'lucide-react';
import type { CredentialProfile } from '../types';
import * as api from '../services/api';
import { confirm } from '@tauri-apps/plugin-dialog';

// react-window 2.x `List` uses different prop names than 1.x;
// cast to a compatible type so JSX doesn't need inline generic parameters.
const VirtualList = List as React.ComponentType<{
    rowComponent: React.ComponentType<{ index: number; style: React.CSSProperties }>;
    rowCount: number;
    rowHeight: number;
    rowProps?: object;
    style?: React.CSSProperties;
}>;

interface ContextMenuState {
    x: number;
    y: number;
    connection: ServerConnection;
}

type FlatItem =
    | { type: 'group'; id: string; group: Group; connectionsCount: number; isExpanded: boolean }
    | { type: 'server'; id: string; connection: ServerConnection };

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
    const setShowPortScanner = useUIStore(s => s.setShowPortScanner);
    const setShowCommandLibraryDialog = useUIStore(s => s.setShowCommandLibraryDialog);
    const setShowImportDialog = useUIStore(s => s.setShowImportDialog);
    const addToast = useUIStore(s => s.addToast);

    const credentialProfiles = useCredentialStore(s => s.credentialProfiles);

    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    // 30-13: virtual list container height tracked via ResizeObserver
    const listContainerRef = useRef<HTMLDivElement>(null);
    const [listHeight, setListHeight] = useState(400);
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
    // 90-9: drag & drop
    const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

    useEffect(() => {
        const handler = () => {
            setContextMenu(null);
            setGroupContextMenu(null);
            setShowTools(false);
        };
        window.addEventListener('click', handler);
        return () => window.removeEventListener('click', handler);
    }, []);

    useEffect(() => {
        const el = listContainerRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([entry]) => {
            if (entry) setListHeight(entry.contentRect.height);
        });
        ro.observe(el);
        setListHeight(el.clientHeight);
        return () => ro.disconnect();
    }, []);

    const toggleGroup = useCallback((id: string, e: React.MouseEvent) => {
        e.stopPropagation();
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

    // 90-9: drag & drop handlers
    const handleDragStart = useCallback((e: React.DragEvent, connectionId: string) => {
        e.dataTransfer.setData('connectionId', connectionId);
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, groupId: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverGroupId(groupId);
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent, groupId: string | null) => {
        e.preventDefault();
        setDragOverGroupId(null);
        const connectionId = e.dataTransfer.getData('connectionId');
        if (!connectionId) return;
        try {
            await api.updateConnectionGroup(connectionId, groupId);
            await refreshConnections();
        } catch (err) {
            addToast({ type: 'error', title: 'Move failed', description: String(err) });
        }
    }, [addToast, refreshConnections]);

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
        } else {
            list = [...list].sort((a, b) => a.name.localeCompare(b.name));
        }
        return list;
    }, [connections, searchQuery, tagFilter, sortMode]);

    const ungrouped = useMemo(
        () => filteredConnections.filter(c => !c.group_id),
        [filteredConnections]
    );

    const grouped = useMemo(
        () =>
            groups
                .map(g => ({
                    group: g,
                    connections: filteredConnections.filter(c => c.group_id === g.id),
                }))
                .filter(g => g.connections.length > 0 || !searchQuery),
        [groups, filteredConnections, searchQuery]
    );

    const visibleNodes = useMemo(() => {
        const nodes: FlatItem[] = [];

        ungrouped.forEach(c => {
            nodes.push({ type: 'server', id: c.id, connection: c });
        });

        grouped.forEach(({ group, connections: gConns }) => {
            const isExpanded = expandedGroups.has(group.id);
            nodes.push({
                type: 'group',
                id: group.id,
                group,
                connectionsCount: gConns.length,
                isExpanded,
            });
            if (isExpanded) {
                gConns.forEach(c => {
                    nodes.push({ type: 'server', id: c.id, connection: c });
                });
            }
        });

        return nodes;
    }, [ungrouped, grouped, expandedGroups]);

    const renderItem = useCallback(
        (item: FlatItem, style: React.CSSProperties) => {
            if (item.type === 'group') {
                const { group, isExpanded, connectionsCount } = item;
                return (
                    <div style={style} className="pr-2">
                        <div
                            className={`w-full flex items-center gap-2 px-3 h-full rounded-xl text-text-muted hover:bg-accent/5 transition-all group/header cursor-pointer select-none ${dragOverGroupId === group.id ? 'bg-accent/15 border border-dashed border-accent/40' : ''}`}
                            onClick={e => toggleGroup(group.id, e)}
                            onContextMenu={e => handleGroupContextMenu(e, group)}
                            onDragOver={e => handleDragOver(e, group.id)}
                            onDragLeave={() => setDragOverGroupId(null)}
                            onDrop={e => handleDrop(e, group.id)}
                        >
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
            const isChild = !!conn.group_id;

            return (
                <div
                    style={style}
                    draggable
                    onDragStart={e => handleDragStart(e, conn.id)}
                    className={`pr-2 ${isChild ? 'ml-4 pl-2 border-l border-border/50' : ''}`}
                >
                    <ConnectionItem
                        connection={conn}
                        profile={profileById.get(conn.credential_profile_id ?? '')}
                        status={status}
                        isActive={isActive}
                        onOpen={() => openTab(conn)}
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
            handleDragStart,
            handleDragOver,
            handleDrop,
            dragOverGroupId,
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
                        onClick={() => setShowCommandLibraryDialog(true)}
                        title="Command Library"
                        aria-label="Command Library"
                    >
                        <Library className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        className="p-1.5 hover:bg-accent/5 rounded-md text-text-muted hover:text-accent transition-colors"
                        onClick={() => setShowPortScanner(true)}
                        title="Network Scan"
                        aria-label="Network Scan"
                    >
                        <Globe className="w-3.5 h-3.5" />
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

            {/* 30-13: react-window virtual list — only DOM-renders rows in the viewport */}
            <div ref={listContainerRef} className="flex-1 min-h-0 custom-scrollbar pl-2 pr-1" style={{ overflow: 'hidden' }}>
                {visibleNodes.length > 0 ? (
                    <VirtualList
                        rowComponent={({ index, style }) =>
                            renderItem(visibleNodes[index], style)
                        }
                        rowCount={visibleNodes.length}
                        rowHeight={36}
                        rowProps={{}}
                        style={{ height: listHeight, overflowY: 'auto' }}
                    />
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
