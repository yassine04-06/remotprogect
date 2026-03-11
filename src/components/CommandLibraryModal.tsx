import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, TerminalSquare, Search, Edit2, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import type { SavedCommand } from '../types';

export const CommandLibraryModal: React.FC = () => {
    const {
        showCommandLibraryDialog,
        setShowCommandLibraryDialog,
        savedCommands,
        createSavedCommand,
        updateSavedCommand,
        deleteSavedCommand
    } = useAppStore();

    const [query, setQuery] = useState('');
    const [editingCmd, setEditingCmd] = useState<SavedCommand | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    // Form state
    const [name, setName] = useState('');
    const [command, setCommand] = useState('');
    const [description, setDescription] = useState('');
    const [tags, setTags] = useState('');

    if (!showCommandLibraryDialog) return null;

    const filteredCommands = savedCommands.filter(cmd => {
        const q = query.toLowerCase();
        return (
            cmd.name.toLowerCase().includes(q) ||
            cmd.command.toLowerCase().includes(q) ||
            (cmd.description && cmd.description.toLowerCase().includes(q)) ||
            (cmd.tags && cmd.tags.toLowerCase().includes(q))
        );
    });

    const handleOpenEdit = (cmd: SavedCommand) => {
        setIsCreating(false);
        setEditingCmd(cmd);
        setName(cmd.name);
        setCommand(cmd.command);
        setDescription(cmd.description || '');
        setTags(cmd.tags || '');
    };

    const handleOpenCreate = () => {
        setEditingCmd(null);
        setIsCreating(true);
        setName('');
        setCommand('');
        setDescription('');
        setTags('');
    };

    const handleCloseForm = () => {
        setEditingCmd(null);
        setIsCreating(false);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (isCreating) {
                await createSavedCommand({ name, command, description, tags });
            } else if (editingCmd) {
                await updateSavedCommand({ id: editingCmd.id, name, command, description, tags });
            }
            handleCloseForm();
        } catch (error) {
            console.error(error);
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this command?')) {
            await deleteSavedCommand(id);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface rounded-xl shadow-2xl border border-white/10 w-full max-w-4xl flex flex-col overflow-hidden max-h-[85vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-accent/20 text-accent">
                            <TerminalSquare className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-text">Command Library</h2>
                            <p className="text-xs text-text-muted">Manage your saved shell snippets and macros</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowCommandLibraryDialog(false)}
                        className="p-2 rounded-md hover:bg-white/10 text-text-muted transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col lg:flex-row relative">
                    {/* Left Panel: List */}
                    <div className={`flex-1 flex flex-col border-r border-white/5 transition-all ${isCreating || editingCmd ? 'hidden lg:flex' : 'flex'}`}>
                        <div className="p-4 border-b border-white/5 flex gap-2">
                            <div className="flex-1 relative">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                <input
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search saved commands..."
                                    className="w-full bg-background rounded-md pl-9 pr-3 py-2 text-sm text-text border-none outline-none focus:ring-1 focus:ring-accent/50"
                                />
                            </div>
                            <button
                                onClick={handleOpenCreate}
                                className="px-3 py-2 bg-accent/20 hover:bg-accent/30 text-accent rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                            >
                                <Plus className="w-4 h-4" /> New
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                            {filteredCommands.length === 0 ? (
                                <div className="p-8 text-center text-text-muted text-sm">
                                    <TerminalSquare className="w-8 h-8 opacity-20 mx-auto mb-2" />
                                    No commands found.
                                </div>
                            ) : (
                                filteredCommands.map(cmd => (
                                    <div
                                        key={cmd.id}
                                        onClick={() => handleOpenEdit(cmd)}
                                        className={`group px-3 py-3 rounded-lg cursor-pointer flex flex-col gap-1 transition-colors ${editingCmd?.id === cmd.id ? 'bg-accent/10 border border-accent/20' : 'hover:bg-white/5 border border-transparent'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold text-sm text-text">{cmd.name}</span>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={(e) => handleDelete(cmd.id, e)}
                                                    className="p-1 rounded hover:bg-red-500/20 text-red-400 object-contain"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="text-xs font-mono text-text-muted/70 truncate bg-background/50 px-2 py-1 rounded">
                                            {cmd.command}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Right Panel: Editor */}
                    <AnimatePresence mode="popLayout">
                        {(isCreating || editingCmd) && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="w-full lg:w-[400px] flex flex-col bg-surface/50"
                            >
                                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                                    <h3 className="text-sm font-semibold flex items-center gap-2">
                                        <Edit2 className="w-4 h-4 text-accent" />
                                        {isCreating ? 'Create New Command' : 'Edit Command'}
                                    </h3>
                                    <button onClick={handleCloseForm} className="lg:hidden p-1 hover:bg-white/10 rounded">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-6">
                                    <form id="command-form" onSubmit={handleSave} className="space-y-4 text-sm">
                                        <div>
                                            <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Display Name *</label>
                                            <input
                                                required
                                                type="text"
                                                value={name}
                                                onChange={e => setName(e.target.value)}
                                                placeholder="e.g. Docker logs formatting"
                                                className="w-full bg-background rounded border border-white/10 px-3 py-2 text-text outline-none focus:border-accent"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Shell Command *</label>
                                            <textarea
                                                required
                                                value={command}
                                                onChange={e => setCommand(e.target.value)}
                                                placeholder="e.g. docker ps -a --format '{{.Names}}'"
                                                rows={4}
                                                className="w-full bg-background font-mono rounded border border-white/10 px-3 py-2 text-text outline-none focus:border-accent resize-none custom-scrollbar"
                                                spellCheck={false}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Description</label>
                                            <input
                                                type="text"
                                                value={description}
                                                onChange={e => setDescription(e.target.value)}
                                                placeholder="Optional context"
                                                className="w-full bg-background rounded border border-white/10 px-3 py-2 text-text outline-none focus:border-accent"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Tags</label>
                                            <input
                                                type="text"
                                                value={tags}
                                                onChange={e => setTags(e.target.value)}
                                                placeholder="e.g. docker, aws, linux (comma separated)"
                                                className="w-full bg-background rounded border border-white/10 px-3 py-2 text-text outline-none focus:border-accent"
                                            />
                                        </div>
                                    </form>
                                </div>
                                <div className="p-4 border-t border-white/5 flex justify-end gap-3 bg-white/[0.02]">
                                    <button
                                        type="button"
                                        onClick={handleCloseForm}
                                        className="px-4 py-2 hover:bg-white/5 text-text rounded-md text-sm transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        form="command-form"
                                        className="px-4 py-2 bg-accent hover:bg-accent-light text-white rounded-md text-sm font-medium transition-colors shadow-lg shadow-accent/20"
                                    >
                                        Save Command
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </motion.div>
    );
};
