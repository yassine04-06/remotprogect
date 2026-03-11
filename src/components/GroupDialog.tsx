import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Group } from '../types';
import { motion } from 'framer-motion';
import { X, FolderPlus, Loader2 } from 'lucide-react';

interface Props {
    editGroup?: Group | null;
    onClose: () => void;
}

export const GroupDialog: React.FC<Props> = ({ editGroup, onClose }) => {
    const { createGroup, updateGroup, addToast } = useAppStore();
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (editGroup) {
            setName(editGroup.name);
        }
    }, [editGroup]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        setLoading(true);
        try {
            if (editGroup) {
                await updateGroup(editGroup.id, name.trim());
                addToast({ type: 'success', title: 'Folder renamed', description: name.trim() });
            } else {
                await createGroup(name.trim());
                addToast({ type: 'success', title: 'Folder created', description: name.trim() });
            }
            onClose();
        } catch {
            // Errors handled by store
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-xl bg-accent/10 text-accent">
                            <FolderPlus className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-text-primary">{editGroup ? 'Rename Folder' : 'New Folder'}</h2>
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mt-0.5">Organize Connections</p>
                        </div>
                    </div>
                    <button className="p-2 hover:bg-white/5 rounded-full transition-colors" onClick={onClose}><X className="w-5 h-5" /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-text-muted uppercase ml-1">Folder Name</label>
                        <input
                            className="h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50 text-sm"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="e.g. Azienda XYZ"
                            autoFocus
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button type="button" className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary transition-colors" onClick={onClose}>Cancel</button>
                        <button
                            type="submit"
                            className="px-6 py-2 bg-accent text-white rounded-lg font-bold text-sm hover:bg-accent/90 transition-all disabled:opacity-50 shadow-lg shadow-accent/20"
                            disabled={loading || !name.trim()}
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : editGroup ? 'Rename' : 'Create'}
                        </button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
};
