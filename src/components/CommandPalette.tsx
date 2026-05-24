import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, TerminalSquare, Command, Hash, Server } from 'lucide-react';
import { useUIStore, useCredentialStore, useConnectionStore, useTabStore } from '../store';
import type { ServerConnection, SavedCommand } from '../types';

// ── LOW-A6: Fuzzy matching ────────────────────────────────────────────────────
//
// Scores `query` against `target`.  Returns 0 if no match, positive value
// otherwise — higher = better.  Scoring tiers:
//   exact       → 10 000
//   starts-with →  5 000  (bonus: shorter target ranks higher)
//   substring   →  1 000
//   fuzzy       →  10+ per matched character; consecutive run adds +5 each
function fuzzyScore(query: string, target: string): number {
    if (!query || !target) return 0;
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    if (t === q) return 10000;
    if (t.startsWith(q)) return 5000 + Math.max(0, 100 - t.length);
    if (t.includes(q)) return 1000 + Math.max(0, 100 - t.length);
    let qi = 0, score = 0, consecutive = 0;
    for (let i = 0; i < t.length && qi < q.length; i++) {
        if (t[i] === q[qi]) { qi++; consecutive++; score += 10 + consecutive * 5; }
        else { consecutive = 0; }
    }
    return qi === q.length ? score : 0;
}

// Highest score across all searchable fields of a connection.
function scoreConnection(q: string, c: ServerConnection): number {
    return Math.max(
        fuzzyScore(q, c.name) * 3,       // name is most important
        fuzzyScore(q, c.host) * 2,
        fuzzyScore(q, c.protocol),
        c.tags ? fuzzyScore(q, c.tags) : 0,
    );
}

// Highest score across all searchable fields of a saved command.
function scoreCommand(q: string, c: SavedCommand): number {
    return Math.max(
        fuzzyScore(q, c.name) * 3,
        fuzzyScore(q, c.command),
        c.description ? fuzzyScore(q, c.description) * 2 : 0,
        c.tags ? fuzzyScore(q, c.tags) : 0,
    );
}

// Protocol → badge colors
const PROTO_STYLE: Record<string, string> = {
    SSH:     'text-green-400 bg-green-500/10 border-green-500/20',
    RDP:     'text-blue-400 bg-blue-500/10 border-blue-500/20',
    VNC:     'text-purple-400 bg-purple-500/10 border-purple-500/20',
    SFTP:    'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    FTP:     'text-orange-400 bg-orange-500/10 border-orange-500/20',
    PROXMOX: 'text-red-400 bg-red-500/10 border-red-500/20',
    DOCKER:  'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
};

type PaletteItem =
    | { kind: 'command';    data: SavedCommand }
    | { kind: 'connection'; data: ServerConnection };

export const CommandPalette: React.FC = () => {
    const showCommandPalette    = useUIStore(s => s.showCommandPalette);
    const setShowCommandPalette = useUIStore(s => s.setShowCommandPalette);
    const savedCommands         = useCredentialStore(s => s.savedCommands);
    const connections           = useConnectionStore(s => s.connections);

    const [query, setQuery]               = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const [pendingCommand, setPendingCommand] = useState<{
        original: string;
        variables: string[];
        values: Record<string, string>;
    } | null>(null);

    const EXTRACT_VARS_REGEX = /\{\{([^}]+)\}\}/g;

    // ── LOW-A6: scored + sorted results ──────────────────────────────────────

    const { scoredConnections, scoredCommands, allItems } = useMemo(() => {
        const hasQuery = query.trim().length > 0;

        // Connections only appear when there is an active query.
        type ScoredConnection = Extract<PaletteItem, { kind: 'connection' }> & { score: number };
        type ScoredCommand    = Extract<PaletteItem, { kind: 'command' }>    & { score: number };

        const scoredConnections: ScoredConnection[] = hasQuery
            ? connections
                .map(c => ({ kind: 'connection' as const, data: c, score: scoreConnection(query, c) }))
                .filter(x => x.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 8)
            : [];

        // Commands: show all when query is empty, fuzzy-filtered when not.
        const scoredCommands: ScoredCommand[] = hasQuery
            ? savedCommands
                .map(c => ({ kind: 'command' as const, data: c, score: scoreCommand(query, c) }))
                .filter(x => x.score > 0)
                .sort((a, b) => b.score - a.score)
            : savedCommands.map(c => ({ kind: 'command' as const, data: c, score: 0 }));

        // Flat list drives keyboard navigation (connections first).
        const allItems: PaletteItem[] = [...scoredConnections, ...scoredCommands];

        return { scoredConnections, scoredCommands, allItems };
    }, [query, connections, savedCommands]);

    // ── Reset state on open ───────────────────────────────────────────────────

    useEffect(() => {
        if (showCommandPalette) {
            setQuery('');
            setSelectedIndex(0);
            setPendingCommand(null);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [showCommandPalette]);

    useEffect(() => { setSelectedIndex(0); }, [query]);

    // ── Ctrl/Cmd+P toggle ─────────────────────────────────────────────────────

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                setShowCommandPalette(!showCommandPalette);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showCommandPalette, setShowCommandPalette]);

    // ── Actions ───────────────────────────────────────────────────────────────

    const handleSelectCommand = (command: string) => {
        const matches   = Array.from(command.matchAll(EXTRACT_VARS_REGEX));
        const variables = [...new Set(matches.map(m => m[1]))];
        if (variables.length > 0) {
            const initialValues = variables.reduce((acc, v) => ({ ...acc, [v]: '' }), {});
            setPendingCommand({ original: command, variables, values: initialValues });
        } else {
            handleInject(command);
        }
    };

    const handleInjectWithVars = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!pendingCommand) return;
        let finalCommand = pendingCommand.original;
        for (const v of pendingCommand.variables)
            finalCommand = finalCommand.split(`{{${v}}}`).join(pendingCommand.values[v] || '');
        handleInject(finalCommand);
    };

    const handleInject = (command: string) => {
        window.dispatchEvent(new CustomEvent('inject-command', { detail: command }));
        setShowCommandPalette(false);
        setPendingCommand(null);
    };

    const handleSelectItem = (item: PaletteItem) => {
        if (item.kind === 'command') {
            handleSelectCommand(item.data.command);
        } else {
            useTabStore.getState().openTab(item.data);
            setShowCommandPalette(false);
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setShowCommandPalette(false);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, allItems.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && allItems.length > 0 && !pendingCommand) {
            e.preventDefault();
            const item = allItems[selectedIndex];
            if (item) handleSelectItem(item);
        }
    };

    // ── Render helpers ────────────────────────────────────────────────────────

    // We need to track the flat keyboard-nav index across both sections.
    // Use a counter that increments inside each section's map.
    let navIdx = 0;

    const renderConnectionItem = (item: Extract<PaletteItem, { kind: 'connection' }> & { score: number }) => {
        const idx = navIdx++;
        const selected = selectedIndex === idx;
        const c = item.data;
        return (
            <div
                key={c.id}
                onClick={() => handleSelectItem({ kind: 'connection', data: c })}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`mx-2 px-3 py-2.5 rounded-lg cursor-pointer flex items-center gap-3 transition-colors ${
                    selected ? 'bg-accent/15 text-white' : 'hover:bg-white/5 text-text'
                }`}
            >
                <div className={`p-2 rounded-md shrink-0 ${selected ? 'bg-accent/20 text-accent' : 'bg-white/5 text-text-muted'}`}>
                    <Server className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm truncate">{c.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-bold ${PROTO_STYLE[c.protocol] ?? 'text-text-muted bg-white/5 border-white/10'}`}>
                            {c.protocol}
                        </span>
                        {c.tags && c.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                            <span key={tag} className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold ${selected ? 'bg-accent/30 text-accent-light' : 'bg-white/10 text-text-muted'}`}>
                                {tag}
                            </span>
                        ))}
                    </div>
                    <div className={`text-xs truncate font-mono mt-0.5 ${selected ? 'text-accent-light/80' : 'text-text-muted/60'}`}>
                        {c.host}:{c.port}
                    </div>
                </div>
                <div className={`text-[10px] uppercase font-bold tracking-widest shrink-0 ${selected ? 'text-accent opacity-100' : 'opacity-0'}`}>
                    Open ↵
                </div>
            </div>
        );
    };

    const renderCommandItem = (item: Extract<PaletteItem, { kind: 'command' }> & { score: number }) => {
        const idx = navIdx++;
        const selected = selectedIndex === idx;
        const cmd = item.data;
        return (
            <div
                key={cmd.id}
                onClick={() => handleSelectItem({ kind: 'command', data: cmd })}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`mx-2 px-3 py-2.5 rounded-lg cursor-pointer flex items-center gap-3 transition-colors ${
                    selected ? 'bg-accent/15 text-white' : 'hover:bg-white/5 text-text'
                }`}
            >
                <div className={`p-2 rounded-md shrink-0 ${selected ? 'bg-accent/20 text-accent' : 'bg-white/5 text-text-muted'}`}>
                    <TerminalSquare className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm truncate">{cmd.name}</span>
                        {cmd.tags && cmd.tags.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                            <span key={tag} className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold ${selected ? 'bg-accent/30 text-accent-light' : 'bg-white/10 text-text-muted'}`}>
                                {tag}
                            </span>
                        ))}
                    </div>
                    <div className={`text-xs truncate font-mono mt-0.5 ${selected ? 'text-accent-light/80' : 'text-text-muted/60'}`}>
                        {cmd.command}
                    </div>
                </div>
                <div className={`text-[10px] uppercase font-bold tracking-widest shrink-0 ${selected ? 'text-accent opacity-100' : 'opacity-0'}`}>
                    Enter ↵
                </div>
            </div>
        );
    };

    return (
        <AnimatePresence>
            {showCommandPalette && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowCommandPalette(false)}
                        className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-start justify-center pt-[15vh]"
                    >
                        <motion.div
                            initial={{ opacity: 0, y: -20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, scale: 0.95 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            onClick={e => e.stopPropagation()}
                            className="w-full max-w-2xl bg-surface border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col mx-4"
                        >
                            {pendingCommand ? (
                                /* ── Variable fill-in form (unchanged) ───────── */
                                <div className="flex flex-col p-5 gap-4">
                                    <div className="flex items-center gap-2 text-accent border-b border-white/5 pb-3">
                                        <TerminalSquare className="w-5 h-5" />
                                        <h3 className="font-bold text-sm tracking-widest uppercase">Insert Variables</h3>
                                    </div>

                                    <div className="p-3 bg-black/40 border border-white/5 rounded-lg text-xs font-mono text-text-muted break-all">
                                        {pendingCommand.original.split(EXTRACT_VARS_REGEX).map((part, i) => {
                                            const isVar = pendingCommand.variables.includes(part);
                                            return isVar ? (
                                                <span key={i} className="text-accent bg-accent/10 px-1 rounded mx-0.5">
                                                    {pendingCommand.values[part] || `{{${part}}}`}
                                                </span>
                                            ) : (
                                                <span key={i}>{part}</span>
                                            );
                                        })}
                                    </div>

                                    <form onSubmit={handleInjectWithVars} className="flex flex-col gap-3">
                                        {pendingCommand.variables.map((v, idx) => (
                                            <div key={v} className="flex flex-col gap-1.5">
                                                <label className="text-xs font-bold text-text-muted uppercase tracking-widest">{v}</label>
                                                <input
                                                    autoFocus={idx === 0}
                                                    type="text"
                                                    value={pendingCommand.values[v]}
                                                    onChange={e =>
                                                        setPendingCommand(prev =>
                                                            prev ? { ...prev, values: { ...prev.values, [v]: e.target.value } } : null
                                                        )
                                                    }
                                                    className="bg-background/80 border border-white/10 rounded px-3 py-2 text-sm font-mono text-text outline-none focus:border-accent transition-colors shadow-inner"
                                                    placeholder={`Enter value for ${v}...`}
                                                />
                                            </div>
                                        ))}

                                        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/5">
                                            <button type="button" onClick={() => setPendingCommand(null)} className="px-5 py-2 text-xs font-bold text-text-muted hover:text-white transition-colors">
                                                Back
                                            </button>
                                            <button type="submit" className="flex-1 px-4 py-2 bg-accent hover:bg-accent-light text-white rounded-lg font-bold text-sm transition-colors shadow-lg flex items-center justify-center gap-2">
                                                <Command className="w-4 h-4" /> Execute Command
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            ) : (
                                <>
                                    {/* ── Search header ──────────────────────────── */}
                                    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
                                        <Search className="w-5 h-5 text-text-muted shrink-0" />
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            value={query}
                                            onChange={e => setQuery(e.target.value)}
                                            onKeyDown={onKeyDown}
                                            placeholder="Search connections or snippets… (Ctrl+P)"
                                            className="flex-1 bg-transparent border-none outline-none text-text placeholder:text-text-muted/50 font-medium"
                                        />
                                        <div className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-text-muted font-mono flex items-center gap-1 shrink-0">
                                            <Command className="w-3 h-3" /> P
                                        </div>
                                    </div>

                                    {/* ── Results ────────────────────────────────── */}
                                    <div className="max-h-[60vh] overflow-y-auto w-full custom-scrollbar py-2">
                                        {(() => {
                                            // Reset the nav-index counter at the start of the render pass.
                                            navIdx = 0;
                                            const hasQuery = query.trim().length > 0;
                                            const noResults = allItems.length === 0;

                                            if (noResults && hasQuery) {
                                                return (
                                                    <div className="px-4 py-8 text-center text-text-muted text-sm flex flex-col items-center gap-2">
                                                        <Search className="w-8 h-8 opacity-20" />
                                                        <p>No results for "{query}"</p>
                                                    </div>
                                                );
                                            }

                                            return (
                                                <>
                                                    {/* Connections section */}
                                                    {scoredConnections.length > 0 && (
                                                        <>
                                                            <div className="px-4 py-1 flex items-center gap-2">
                                                                <Server className="w-3 h-3 text-text-muted/50" />
                                                                <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted/50">Connections</span>
                                                            </div>
                                                            {scoredConnections.map(item => renderConnectionItem(item))}
                                                            {scoredCommands.length > 0 && (
                                                                <div className="mx-4 my-1 h-px bg-white/5" />
                                                            )}
                                                        </>
                                                    )}

                                                    {/* Commands section */}
                                                    {scoredCommands.length > 0 && (
                                                        <>
                                                            {(hasQuery || scoredConnections.length > 0) && (
                                                                <div className="px-4 py-1 flex items-center gap-2">
                                                                    <TerminalSquare className="w-3 h-3 text-text-muted/50" />
                                                                    <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted/50">Snippets</span>
                                                                </div>
                                                            )}
                                                            {scoredCommands.map(item => renderCommandItem(item))}
                                                        </>
                                                    )}

                                                    {scoredCommands.length === 0 && !hasQuery && (
                                                        <div className="px-4 py-8 text-center text-text-muted text-sm flex flex-col items-center gap-2">
                                                            <TerminalSquare className="w-8 h-8 opacity-20" />
                                                            <p>No saved snippets yet</p>
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>

                                    {/* ── Footer ─────────────────────────────────── */}
                                    <div className="bg-white/[0.02] border-t border-white/5 px-4 py-2 flex items-center justify-between text-[10px] text-text-muted">
                                        <span className="flex items-center gap-3">
                                            <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> {savedCommands.length} snippets</span>
                                            <span className="flex items-center gap-1"><Server className="w-3 h-3" /> {connections.length} connections</span>
                                        </span>
                                        <div className="flex items-center gap-4">
                                            <span><kbd className="bg-white/10 px-1 py-0.5 rounded font-mono">↑↓</kbd> navigate</span>
                                            <span><kbd className="bg-white/10 px-1 py-0.5 rounded font-mono">↵</kbd> select</span>
                                            <span><kbd className="bg-white/10 px-1 py-0.5 rounded font-mono">Esc</kbd> close</span>
                                        </div>
                                    </div>
                                </>
                            )}
                        </motion.div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};
