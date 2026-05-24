import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TerminalSquare, SendHorizonal, X } from 'lucide-react';
import { useTabStore, useUIStore } from '../store';
import * as api from '../services/api';

export const BroadcastBar: React.FC = () => {
    const isBroadcastMode = useTabStore(s => s.isBroadcastMode);
    const setBroadcastMode = useTabStore(s => s.setBroadcastMode);
    const tabs = useTabStore(s => s.tabs);
    const addToast = useUIStore(s => s.addToast);
    const [command, setCommand] = useState('');
    const [sending, setSending] = useState(false);

    const targetTabs = tabs.filter(t => t.protocol === 'SSH' || t.protocol === 'LOCAL');

    const handleBroadcast = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!command.trim() || targetTabs.length === 0) return;

        setSending(true);
        const results = await Promise.allSettled(
            targetTabs.map(tab => {
                if (tab.protocol === 'SSH') {
                    return api.sshSendInput(tab.id, command + '\n');
                } else {
                    return api.shellSendInput(tab.id, command + '\r\n');
                }
            })
        );
        setSending(false);

        const failed = results
            .map((r, i) => (r.status === 'rejected' ? targetTabs[i].connectionName : null))
            .filter(Boolean) as string[];

        if (failed.length === 0) {
            addToast({
                type: 'success',
                title: `Broadcast sent`,
                description: `Command delivered to ${targetTabs.length} terminal${targetTabs.length > 1 ? 's' : ''}.`,
            });
        } else if (failed.length < targetTabs.length) {
            addToast({
                type: 'warning',
                title: `Partial broadcast`,
                description: `Failed on: ${failed.join(', ')}`,
            });
        } else {
            addToast({
                type: 'error',
                title: 'Broadcast failed',
                description: 'Could not send to any terminal. Are they still connected?',
            });
        }

        setCommand('');
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
                            <span className="text-xs font-bold uppercase tracking-wider">
                                Broadcast ({targetTabs.length})
                            </span>
                        </div>
                        <input
                            type="text"
                            value={command}
                            onChange={e => setCommand(e.target.value)}
                            placeholder={
                                targetTabs.length === 0
                                    ? 'No terminals open — open an SSH or local session first'
                                    : `Execute command across ${targetTabs.length} terminal${targetTabs.length > 1 ? 's' : ''}...`
                            }
                            className="flex-1 bg-background/50 border border-white/10 rounded px-3 py-1.5 text-sm font-mono text-text outline-none focus:border-accent transition-colors"
                            disabled={targetTabs.length === 0}
                        />
                        <button
                            type="submit"
                            disabled={!command.trim() || targetTabs.length === 0 || sending}
                            className="px-4 py-1.5 bg-accent hover:bg-accent-light text-white rounded font-semibold text-sm transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <SendHorizonal className="w-4 h-4" />
                            {sending ? 'Sending…' : 'Send'}
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
