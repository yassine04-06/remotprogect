import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Plus, Trash2, ShieldCheck, Copy } from 'lucide-react';
import * as api from '../../services/api';
import { useUIStore } from '../../store';
import type { TotpCode } from '../../types';

export function TotpModal({ onClose }: { onClose: () => void }) {
    const addToast = useUIStore(s => s.addToast);
    const [codes, setCodes] = useState<TotpCode[]>([]);
    const [adding, setAdding] = useState(false);
    const [label, setLabel] = useState('');
    const [secret, setSecret] = useState('');

    const [locked, setLocked] = useState(false);

    const load = useCallback(async () => {
        try {
            setCodes(await api.totpList());
            setLocked(false);
        } catch (e) {
            // If the vault auto-locked while the modal is open, stop polling and
            // show a single inline notice instead of spamming a toast every second.
            if (String(e).toLowerCase().includes('lock')) {
                setLocked(true);
            } else {
                addToast({ type: 'error', title: 'Failed to load codes', description: String(e) });
            }
        }
    }, [addToast]);

    // The 6-digit code only changes every 30s. Instead of re-decrypting every
    // secret each second (expensive), we tick the countdown locally and only
    // re-fetch from the backend when a window actually rolls over (≥30x fewer
    // decrypt calls). Paused while the vault is locked.
    useEffect(() => {
        if (locked) return;
        load();
        const t = setInterval(() => {
            setCodes(prev => {
                let needsRefetch = false;
                const next = prev.map(c => {
                    const remaining = c.seconds_remaining - 1;
                    if (remaining <= 0) needsRefetch = true;
                    return { ...c, seconds_remaining: Math.max(0, remaining) };
                });
                if (needsRefetch) load();
                return next;
            });
        }, 1000);
        return () => clearInterval(t);
    }, [load, locked]);

    const handleAdd = async () => {
        if (!label.trim() || !secret.trim()) return;
        try {
            await api.totpAdd(label.trim(), secret.trim());
            setLabel(''); setSecret(''); setAdding(false);
            load();
        } catch (e) {
            addToast({ type: 'error', title: 'Invalid secret', description: String(e) });
        }
    };

    const handleDelete = async (id: string) => {
        try { await api.totpDelete(id); load(); } catch (e) {
            addToast({ type: 'error', title: 'Delete failed', description: String(e) });
        }
    };

    // a11y: close on Escape.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="2FA Codes"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]"
            >
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-accent" />
                        <h2 className="text-base font-bold text-text-primary">2FA Codes</h2>
                    </div>
                    <button onClick={onClose} className="text-text-muted hover:text-text-primary">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-3 space-y-2">
                    {locked && (
                        <p className="text-xs text-amber-400 text-center py-8">
                            Vault locked — unlock NexoRC to view your 2FA codes.
                        </p>
                    )}
                    {!locked && codes.length === 0 && !adding && (
                        <p className="text-xs text-text-muted text-center py-8">
                            No 2FA secrets yet. Add one to generate rotating codes.
                        </p>
                    )}
                    {codes.map(c => (
                        <div key={c.id} className="flex items-center gap-3 p-3 bg-base rounded-xl border border-border">
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] text-text-muted truncate">{c.label}</div>
                                <div className="text-xl font-mono font-bold tracking-widest text-accent tabular-nums">
                                    {c.code.slice(0, 3)} {c.code.slice(3)}
                                </div>
                            </div>
                            <div className="relative w-7 h-7 shrink-0" title={`${c.seconds_remaining}s`}>
                                <svg className="w-7 h-7 -rotate-90" viewBox="0 0 36 36">
                                    <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3" className="text-border" />
                                    <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="3"
                                        className="text-accent" strokeDasharray={100}
                                        strokeDashoffset={100 - (c.seconds_remaining / 30) * 100} pathLength={100} />
                                </svg>
                                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-text-muted">
                                    {c.seconds_remaining}
                                </span>
                            </div>
                            <button
                                onClick={() => { navigator.clipboard?.writeText(c.code).catch(() => {}); addToast({ type: 'success', title: 'Code copied', description: c.label }); }}
                                className="p-1.5 text-text-muted hover:text-accent" title="Copy code">
                                <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(c.id)} className="p-1.5 text-text-muted hover:text-red-400" title="Remove">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ))}

                    {adding && (
                        <div className="p-3 bg-base rounded-xl border border-accent/30 space-y-2">
                            <input
                                autoFocus value={label} onChange={e => setLabel(e.target.value)}
                                placeholder="Label (e.g. GitHub, AWS root)"
                                className="w-full bg-surface border border-border rounded px-3 py-2 text-sm outline-none focus:border-accent"
                            />
                            <input
                                value={secret} onChange={e => setSecret(e.target.value)}
                                placeholder="Base32 secret (from the QR setup key)"
                                className="w-full bg-surface border border-border rounded px-3 py-2 text-sm font-mono outline-none focus:border-accent"
                            />
                            <div className="flex gap-2">
                                <button onClick={handleAdd} className="flex-1 py-1.5 bg-accent text-white rounded text-xs font-bold hover:bg-accent/90">Save</button>
                                <button onClick={() => { setAdding(false); setLabel(''); setSecret(''); }} className="px-3 py-1.5 bg-surface border border-border rounded text-xs font-semibold text-text-muted">Cancel</button>
                            </div>
                        </div>
                    )}
                </div>

                {!adding && (
                    <div className="p-3 border-t border-border">
                        <button onClick={() => setAdding(true)} className="w-full flex items-center justify-center gap-2 py-2 bg-accent/10 text-accent rounded-xl text-sm font-semibold hover:bg-accent/20">
                            <Plus className="w-4 h-4" /> Add 2FA secret
                        </button>
                    </div>
                )}
            </motion.div>
        </div>
    );
}
