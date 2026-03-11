import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TerminalSquare, SendHorizonal, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import * as api from '../services/api';

export const BroadcastBar: React.FC = () => {
    const { isBroadcastMode, setBroadcastMode, tabs } = useAppStore();
    const [command, setCommand] = useState('');

    const targetTabs = tabs.filter(t => t.protocol === 'SSH' || t.protocol === 'LOCAL');

    const handleBroadcast = (e: React.FormEvent) => {
        e.preventDefault();
        if (!command.trim()) return;

        // Iterate through all compatible tabs and dispatch the inject-command event
        // targetTabs.forEach(tab => {
        // We use the same mechanism as the Command Palette, except this time we suffix it with \r to auto-execute.
        // Since inject-command globally listens, it normally relies on the active tab checking if it's visible.
        // To broadcast, we need to send directly via API.
        // });

        const executeCommand = async () => {
            const promises = targetTabs.map(async tab => {
                try {
                    if (tab.protocol === 'SSH') {
                        await api.sshSendInput(tab.id, command + '\n');
                    } else if (tab.protocol === 'LOCAL') {
                        await api.shellSendInput(tab.id, command + '\r\n');
                    }
                } catch (err) {
                    console.error(`Broadcast failed for ${tab.connectionName}`, err);
                }
            });
            await Promise.allSettled(promises);
            setCommand('');
        };

        executeCommand();
    };

    return (
        <AnimatePresence>
            {isBroadcastMode && (
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="w-full bg-accent/10 border-b border-accent/20 overflow-hidden"
                >
                    <form onSubmit={handleBroadcast} className="flex items-center gap-3 px-4 py-2">
                        <div className="flex items-center gap-2 text-accent">
                            <TerminalSquare className="w-4 h-4" />
                            <span className="text-xs font-bold uppercase tracking-wider">Broadcast ({targetTabs.length})</span>
                        </div>
                        <input
                            type="text"
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            placeholder={`Execute command across ${targetTabs.length} terminals...`}
                            className="flex-1 bg-background/50 border border-white/10 rounded px-3 py-1.5 text-sm font-mono text-text outline-none focus:border-accent transition-colors"
                        />
                        <button
                            type="submit"
                            disabled={!command.trim() || targetTabs.length === 0}
                            className="px-4 py-1.5 bg-accent hover:bg-accent-light text-white rounded font-semibold text-sm transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <SendHorizonal className="w-4 h-4" /> Send
                        </button>
                        <div className="w-px h-6 bg-white/10 mx-1" />
                        <button
                            type="button"
                            onClick={() => setBroadcastMode(false)}
                            className="p-1.5 hover:bg-white/10 text-text-muted hover:text-red-400 rounded-md transition-colors"
                            title="Close Broadcast Mode"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </form>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
