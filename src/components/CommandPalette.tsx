import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, TerminalSquare, Command, Hash } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export const CommandPalette: React.FC = () => {
    const { showCommandPalette, setShowCommandPalette, savedCommands } = useAppStore();
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const [pendingCommand, setPendingCommand] = useState<{ original: string, variables: string[], values: Record<string, string> } | null>(null);

    const EXTRACT_VARS_REGEX = /\{\{([^}]+)\}\}/g;

    // Filter commands based on query (name, description, tags, or raw command)
    const filteredCommands = savedCommands.filter(cmd => {
        const q = query.toLowerCase();
        return (
            cmd.name.toLowerCase().includes(q) ||
            cmd.command.toLowerCase().includes(q) ||
            (cmd.description && cmd.description.toLowerCase().includes(q)) ||
            (cmd.tags && cmd.tags.toLowerCase().includes(q))
        );
    });

    useEffect(() => {
        if (showCommandPalette) {
            setQuery('');
            setSelectedIndex(0);
            setPendingCommand(null);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [showCommandPalette]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

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

    const handleSelectCommand = (command: string) => {
        const matches = Array.from(command.matchAll(EXTRACT_VARS_REGEX));
        const variables = [...new Set(matches.map(m => m[1]))]; // Unique variables only

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
        for (const v of pendingCommand.variables) {
            finalCommand = finalCommand.split(`{{${v}}}`).join(pendingCommand.values[v] || '');
        }
        handleInject(finalCommand);
    };

    const handleInject = (command: string) => {
        // Dispatch custom event to active terminal
        window.dispatchEvent(new CustomEvent('inject-command', { detail: command }));
        setShowCommandPalette(false);
        setPendingCommand(null);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setShowCommandPalette(false);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : prev));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        } else if (e.key === 'Enter' && filteredCommands.length > 0 && !pendingCommand) {
            e.preventDefault();
            handleSelectCommand(filteredCommands[selectedIndex].command);
        }
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
                            onClick={(e) => e.stopPropagation()}
                            className="w-full max-w-2xl bg-surface border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col mx-4"
                        >
                            {pendingCommand ? (
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
                                                    onChange={(e) => setPendingCommand(prev => prev ? { ...prev, values: { ...prev.values, [v]: e.target.value } } : null)}
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
                                    {/* Search Header */}
                                    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
                                        <Search className="w-5 h-5 text-text-muted" />
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            value={query}
                                            onChange={(e) => setQuery(e.target.value)}
                                            onKeyDown={onKeyDown}
                                            placeholder="Search saved terminal commands... (Ctrl+P)"
                                            className="flex-1 bg-transparent border-none outline-none text-text placeholder:text-text-muted/50 font-medium"
                                        />
                                        <div className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-text-muted font-mono flex items-center gap-1">
                                            <Command className="w-3 h-3" /> P
                                        </div>
                                    </div>

                                    {/* Results List */}
                                    <div className="max-h-[60vh] overflow-y-auto w-full custom-scrollbar py-2">
                                        {filteredCommands.length === 0 ? (
                                            <div className="px-4 py-8 text-center text-text-muted text-sm flex flex-col items-center gap-2">
                                                <TerminalSquare className="w-8 h-8 opacity-20" />
                                                <p>No commands found matching "{query}"</p>
                                            </div>
                                        ) : (
                                            filteredCommands.map((cmd, idx) => (
                                                <div
                                                    key={cmd.id}
                                                    onClick={() => handleSelectCommand(cmd.command)}
                                                    onMouseEnter={() => setSelectedIndex(idx)}
                                                    className={`mx-2 px-3 py-2.5 rounded-lg cursor-pointer flex items-center gap-3 transition-colors ${selectedIndex === idx ? 'bg-accent/15 text-white' : 'hover:bg-white/5 text-text'}`}
                                                >
                                                    <div className={`p-2 rounded-md ${selectedIndex === idx ? 'bg-accent/20 text-accent' : 'bg-white/5 text-text-muted'}`}>
                                                        <TerminalSquare className="w-4 h-4" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold text-sm truncate">{cmd.name}</span>
                                                            {cmd.tags && (
                                                                <div className="flex items-center gap-1">
                                                                    {cmd.tags.split(',').map(tag => tag.trim()).filter(Boolean).map(tag => (
                                                                        <span key={tag} className={`text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold ${selectedIndex === idx ? 'bg-accent/30 text-accent-light' : 'bg-white/10 text-text-muted'}`}>
                                                                            {tag}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className={`text-xs truncate font-mono mt-0.5 ${selectedIndex === idx ? 'text-accent-light/80' : 'text-text-muted/60'}`}>
                                                            {cmd.command}
                                                        </div>
                                                    </div>
                                                    <div className={`text-[10px] uppercase font-bold tracking-widest ${selectedIndex === idx ? 'text-accent opacity-100' : 'opacity-0'}`}>
                                                        Enter ↵
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    {/* Footer */}
                                    <div className="bg-white/[0.02] border-t border-white/5 px-4 py-2 flex items-center justify-between text-[10px] text-text-muted">
                                        <span className="flex items-center gap-1.5"><Hash className="w-3 h-3" /> {savedCommands.length} snippets</span>
                                        <div className="flex items-center gap-4">
                                            <span><kbd className="bg-white/10 px-1 py-0.5 rounded font-mono">↑↓</kbd> to navigate</span>
                                            <span><kbd className="bg-white/10 px-1 py-0.5 rounded font-mono">↵</kbd> to select</span>
                                            <span><kbd className="bg-white/10 px-1 py-0.5 rounded font-mono">Esc</kbd> to close</span>
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
