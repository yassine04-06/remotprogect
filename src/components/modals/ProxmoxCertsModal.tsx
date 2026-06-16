// MED-A8: UI for listing and forgetting TOFU-pinned Proxmox certificates.
// Allows the user to review which Proxmox servers have pinned TLS fingerprints
// and selectively remove entries to force re-TOFU on the next connection.

import { useEffect, useState } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { X, ShieldCheck, ShieldOff, Trash2, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import * as api from '../../services/api';
import type { ProxmoxPinnedCert } from '../../types';
import { useUIStore } from '../../store';
import { parseBackendError, getUserFriendlyErrorMessage } from '../../utils/errorMapper';

interface ProxmoxCertsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ProxmoxCertsModal({ isOpen, onClose }: ProxmoxCertsModalProps) {
    const addToast = useUIStore(s => s.addToast);
    const [certs, setCerts] = useState<ProxmoxPinnedCert[]>([]);
    const [loading, setLoading] = useState(false);
    const [forgetting, setForgetting] = useState<string | null>(null);

    // ESC to close
    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [isOpen, onClose]);

    const loadCerts = async () => {
        setLoading(true);
        try {
            const list = await api.proxmoxListPinnedCerts();
            // Sort by host_key for stable ordering
            setCerts(list.sort((a, b) => a.host_key.localeCompare(b.host_key)));
        } catch (err: unknown) {
            const appError = parseBackendError(err);
            addToast({
                type: 'error',
                title: 'Failed to load pinned certs',
                description: getUserFriendlyErrorMessage(appError),
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) loadCerts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleForget = async (hostKey: string) => {
        const ok = await confirm(`Remove pinned certificate for "${hostKey}"?\n\nThe next connection to this host will re-verify its certificate.`, { title: 'Remove Certificate', kind: 'warning' });
        if (!ok) return;
        setForgetting(hostKey);
        try {
            await api.proxmoxForgetCert(hostKey);
            setCerts(prev => prev.filter(c => c.host_key !== hostKey));
            addToast({
                type: 'success',
                title: 'Certificate removed',
                description: `Pinned cert for ${hostKey} deleted. TOFU will re-run on next connect.`,
            });
        } catch (err: unknown) {
            const appError = parseBackendError(err);
            addToast({
                type: 'error',
                title: 'Failed to remove cert',
                description: getUserFriendlyErrorMessage(appError),
            });
        } finally {
            setForgetting(null);
        }
    };

    const formatDate = (unix: number) => {
        return new Date(unix * 1000).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
        });
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div
                className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="glass-card w-full max-w-xl rounded-2xl overflow-hidden border border-border/50"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between px-6 py-5 border-b border-border">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
                                <ShieldCheck className="w-5 h-5 text-accent" />
                            </div>
                            <div>
                                <h2 className="text-base font-bold">Pinned Proxmox Certificates</h2>
                                <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold">
                                    TOFU Certificate Store
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={loadCerts}
                                disabled={loading}
                                title="Refresh"
                                className="btn-icon"
                            >
                                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            </button>
                            <button onClick={onClose} className="btn-icon">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="px-6 py-4 max-h-[420px] overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
                                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                                Loading…
                            </div>
                        ) : certs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-text-muted gap-3">
                                <ShieldOff className="w-10 h-10 opacity-30" />
                                <p className="text-sm font-semibold">No pinned certificates</p>
                                <p className="text-[11px] text-center max-w-xs leading-relaxed">
                                    Proxmox certificates are pinned on first connection (TOFU).
                                    Connect to a Proxmox server to see its certificate here.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {certs.map(cert => (
                                    <div
                                        key={cert.host_key}
                                        className="flex items-start gap-4 p-4 rounded-xl bg-accent/5 border border-border hover:border-accent/20 transition-colors"
                                    >
                                        <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5">
                                            <ShieldCheck className="w-4 h-4 text-green-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-text-primary truncate">
                                                {cert.host_key}
                                            </p>
                                            <p
                                                className="text-[10px] font-mono text-text-muted mt-0.5 truncate"
                                                title={cert.fingerprint_sha256}
                                            >
                                                {cert.fingerprint_sha256}
                                            </p>
                                            <p className="text-[10px] text-text-muted mt-1">
                                                Pinned {formatDate(cert.added_at)}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleForget(cert.host_key)}
                                            disabled={forgetting === cert.host_key}
                                            title="Forget this certificate"
                                            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                                        >
                                            {forgetting === cert.host_key ? (
                                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <Trash2 className="w-3.5 h-3.5" />
                                            )}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer note */}
                    <div className="px-6 py-4 border-t border-border bg-base/20">
                        <p className="text-[10px] text-text-muted leading-relaxed">
                            Certificates are pinned on first connection (Trust on First Use).
                            Forgetting a cert forces re-verification on the next connect.
                            If the fingerprint changes unexpectedly, it may indicate a MITM attack.
                        </p>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
