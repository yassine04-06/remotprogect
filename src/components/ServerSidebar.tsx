import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { ServerConnection } from '../types';
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
    Library
} from 'lucide-react';

interface ContextMenuState {
    x: number;
    y: number;
    connection: ServerConnection;
}

export const ServerSidebar: React.FC = () => {
    const {
        connections,
        groups,
        searchQuery,
        setSearchQuery,
        openTab,
        tabs,
        activeTabId,
        setShowConnectionDialog,
        setShowGroupDialog,
        setEditingConnection,
        setEditingGroup,
        setShowPortScanner,
        setShowCommandLibraryDialog,
        deleteConnection,
        deleteGroup
    } = useAppStore();

    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; group: { id: string; name: string } } | null>(null);
    const [showTools, setShowTools] = useState(false);
    const contextMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = () => {
            setContextMenu(null);
            setGroupContextMenu(null);
            setShowTools(false);
        };
        window.addEventListener('click', handler);
        return () => window.removeEventListener('click', handler);
    }, []);

    const toggleGroup = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handleContextMenu = (e: React.MouseEvent, connection: ServerConnection) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, connection });
    };

    const handleGroupContextMenu = (e: React.MouseEvent, group: any) => {
        e.preventDefault();
        e.stopPropagation();
        setGroupContextMenu({ x: e.clientX, y: e.clientY, group });
    };

    const handleDelete = async (connection: ServerConnection) => {
        setContextMenu(null);
        if (!confirm(`Are you sure you want to delete "${connection.name}"?`)) return;
        await deleteConnection(connection.id);
    };

    const getTabStatus = (connectionId: string) => {
        const tab = tabs.find((t) => t.connectionId === connectionId);
        return tab?.status ?? 'idle';
    };

    const filteredConnections = useMemo(() =>
        connections.filter(
            (c) =>
                c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                c.host.toLowerCase().includes(searchQuery.toLowerCase())
        ),
        [connections, searchQuery]
    );

    const ungrouped = useMemo(() => filteredConnections.filter((c) => !c.group_id), [filteredConnections]);

    const grouped = useMemo(() =>
        groups.map((g) => ({
            group: g,
            connections: filteredConnections.filter((c) => c.group_id === g.id),
        })).filter((g) => g.connections.length > 0 || !searchQuery),
        [groups, filteredConnections, searchQuery]
    );


    return (
        <div className="w-64 flex flex-col h-full bg-surface border-r border-border select-none">
            <div className="h-12 flex items-center justify-between px-4 border-b border-border">
                <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                        <Layout className="w-4 h-4 text-accent" />
                    </div>
                    <span className="text-sm font-bold tracking-tight">Nexus Vault</span>
                </div>
                <div className="flex items-center gap-0.5">
                    <button
                        className="p-1.5 hover:bg-accent/5 rounded-md text-text-muted hover:text-accent transition-colors"
                        onClick={() => setShowCommandLibraryDialog(true)}
                        title="Command Library"
                    >
                        <Library className="w-3.5 h-3.5" />
                    </button>
                    <button
                        className="p-1.5 hover:bg-accent/5 rounded-md text-text-muted hover:text-accent transition-colors"
                        onClick={() => setShowPortScanner(true)}
                        title="Network Scan"
                    >
                        <Globe className="w-3.5 h-3.5" />
                    </button>
                    <button
                        className="p-1.5 hover:bg-accent/5 rounded-md text-text-muted hover:text-accent transition-colors"
                        onClick={() => {
                            setEditingGroup(null);
                            setShowGroupDialog(true);
                        }}
                        title="New Folder"
                    >
                        <FolderPlus className="w-3.5 h-3.5" />
                    </button>
                    <button
                        className="p-1.5 hover:bg-accent/5 rounded-md text-text-muted hover:text-accent transition-colors"
                        onClick={() => {
                            setEditingConnection(null);
                            setShowConnectionDialog(true);
                        }}
                        title="New Connection"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="p-3">
                <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted group-focus-within:text-accent transition-colors" />
                    <input
                        type="search"
                        placeholder="Search infrastructure..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full h-10 pl-10 pr-4 bg-accent/5 border border-border rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-accent/40 focus:bg-accent/5 transition-all"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 pb-4 custom-scrollbar">
                <AnimatePresence mode="popLayout">
                    {ungrouped.map((c) => (
                        <ConnectionItem
                            key={c.id}
                            connection={c}
                            status={getTabStatus(c.id)}
                            isActive={tabs.some((t) => t.connectionId === c.id && t.id === activeTabId)}
                            onOpen={() => openTab(c)}
                            onEdit={() => {
                                setEditingConnection(c);
                                setShowConnectionDialog(true);
                            }}
                            onContextMenu={(e) => handleContextMenu(e, c)}
                        />
                    ))}

                    {grouped.map(({ group, connections: gConns }) => {
                        const isExpanded = expandedGroups.has(group.id);
                        return (
                            <motion.div key={group.id} layout className="mb-0.5">
                                <button
                                    onClick={() => toggleGroup(group.id, {} as any)} // Cast to any to satisfy type, actual event not used in toggleGroup
                                    onContextMenu={(e) => handleGroupContextMenu(e, group)}
                                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-text-muted hover:bg-accent/5 transition-all group/header"
                                >
                                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 mt-0.5" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5" />}
                                    <div className="flex-1 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            {isExpanded ? <FolderOpen className="w-4 h-4 text-accent/70" /> : <Folder className="w-4 h-4 text-text-muted/50" />}
                                            <span className={`text-[11px] font-black uppercase tracking-widest ${isExpanded ? 'text-text-primary' : 'text-text-muted'}`}>
                                                {group.name}
                                            </span>
                                        </div>
                                        <span className="text-[10px] font-mono opacity-40 bg-accent/5 px-2 py-0.5 rounded-full">
                                            {gConns.length}
                                        </span>
                                    </div>
                                </button>
                                <AnimatePresence>
                                    {isExpanded && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            exit={{ opacity: 0, height: 0 }}
                                            className="ml-4 pl-2 border-l border-border/50 mt-0.5 overflow-hidden"
                                        >
                                            {gConns.map((conn) => {
                                                const isActive = activeTabId === conn.id || tabs.some(t => t.connectionId === conn.id && t.id === activeTabId);
                                                const status = getTabStatus(conn.id);
                                                return (
                                                    <ConnectionItem
                                                        key={conn.id}
                                                        connection={conn}
                                                        status={status}
                                                        isActive={isActive}
                                                        onOpen={() => openTab(conn)}
                                                        onEdit={() => {
                                                            setEditingConnection(conn);
                                                            setShowConnectionDialog(true);
                                                        }}
                                                        onContextMenu={(e) => handleContextMenu(e, conn)}
                                                    />
                                                );
                                            })}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>

                {filteredConnections.length === 0 && (
                    <div className="mt-12 px-6 flex flex-col items-center text-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5">
                            <Search className="w-5 h-5 opacity-10" />
                        </div>
                        <div className="text-[10px] font-bold text-text-muted/50 uppercase tracking-widest leading-relaxed">
                            {searchQuery ? 'No results found' : 'Secure Vault Empty'}
                        </div>
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
                        onClick={(e) => e.stopPropagation()}
                    >
                        {!showTools ? (
                            <>
                                <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-accent hover:text-white rounded-lg transition-colors"
                                    onClick={() => { openTab(contextMenu.connection); setContextMenu(null); }}>
                                    <Play className="w-3.5 h-3.5" /> Connect
                                </button>
                                <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-white/5 rounded-lg transition-colors"
                                    onClick={() => {
                                        setEditingConnection(contextMenu.connection);
                                        setShowConnectionDialog(true);
                                        setContextMenu(null);
                                    }}>
                                    <Edit2 className="w-3.5 h-3.5" /> Edit Connection
                                </button>
                                <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-white/5 rounded-lg transition-colors justify-between"
                                    onClick={() => setShowTools(true)}>
                                    <div className="flex items-center gap-3">
                                        <Globe className="w-3.5 h-3.5" /> External Tools
                                    </div>
                                    <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                                </button>
                                <div className="h-px bg-border my-1.5 mx-1.5" />
                                <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-red-500 hover:text-white rounded-lg transition-colors"
                                    onClick={() => handleDelete(contextMenu.connection)}>
                                    <Trash2 className="w-3.5 h-3.5" /> Delete from Vault
                                </button>
                            </>
                        ) : (
                            <ExternalToolsMenu connection={contextMenu.connection} onClose={() => setContextMenu(null)} />
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
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-text-primary hover:bg-accent/5 rounded-lg transition-colors"
                            onClick={() => {
                                setEditingGroup(groupContextMenu.group as any);
                                setShowGroupDialog(true);
                                setGroupContextMenu(null);
                            }}>
                            <Edit2 className="w-3.5 h-3.5" /> Rename Folder
                        </button>
                        <div className="h-px bg-border my-1.5 mx-1.5" />
                        <button className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-red-500 hover:text-white rounded-lg transition-colors"
                            onClick={async () => {
                                setGroupContextMenu(null);
                                if (!confirm(`Delete folder "${groupContextMenu.group.name}"? Connections inside will become ungrouped.`)) return;
                                await deleteGroup(groupContextMenu.group.id);
                            }}>
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
    status: string;
    isActive: boolean;
    onOpen: () => void;
    onEdit: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
}

const ConnectionItem: React.FC<ConnectionItemProps> = React.memo(({
    connection,
    status,
    isActive,
    onOpen,
    onEdit,
    onContextMenu
}) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer group transition-colors select-none ${isActive ? 'bg-accent/20 text-accent font-bold' : 'hover:bg-accent/5 text-text-muted hover:text-text-primary'}`}
            onDoubleClick={onOpen}
            onClick={onOpen}
            onContextMenu={onContextMenu}
        >
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === 'connected' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' :
                status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                    status === 'error' ? 'bg-red-500' : 'bg-transparent border border-border/50'
                }`} />

            <div className="shrink-0 opacity-40 group-hover:opacity-100 transition-opacity">
                {connection.protocol === 'SSH' ? <Terminal className="w-3.5 h-3.5" /> :
                    connection.protocol === 'RDP' ? <Monitor className="w-3.5 h-3.5" /> :
                        connection.protocol === 'SFTP' ? <FolderSync className="w-3.5 h-3.5" /> :
                            connection.protocol === 'FTP' ? <FolderOpen className="w-3.5 h-3.5" /> :
                                <Globe className="w-3.5 h-3.5" />}
            </div>

            <div className="flex-1 min-w-0 flex items-baseline gap-1.5 truncate">
                <span className="text-xs truncate">{connection.name}</span>
                <span className="text-[9px] font-bold opacity-30 uppercase shrink-0">({connection.protocol})</span>
            </div>

            <div className="hidden group-hover:flex items-center gap-1">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                    }}
                    className="p-1 hover:bg-accent/10 rounded-md text-text-muted hover:text-text-primary transition-colors"
                >
                    <Edit2 className="w-3 h-3" />
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onContextMenu(e);
                    }}
                    className="p-1 hover:bg-accent/10 rounded-md text-text-muted hover:text-text-primary transition-colors"
                >
                    <MoreVertical className="w-3 h-3" />
                </button>
            </div>
        </motion.div>
    );
});
