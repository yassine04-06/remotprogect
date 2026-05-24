import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Key, Plus, Trash2, Copy, Download, Loader2, ChevronDown } from 'lucide-react';
import * as api from '../services/api';
import type { SshKey } from '../types';

interface Props {
    onClose: () => void;
}

export function SshKeyManagerModal({ onClose }: Props) {
    const [keys, setKeys] = useState<SshKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<'list' | 'import' | 'generate'>('list');
    const [expandedKey, setExpandedKey] = useState<string | null>(null);

    // Import form state
    const [importName, setImportName] = useState('');
    const [importPem, setImportPem] = useState('');
    const [importPub, setImportPub] = useState('');
    const [importComment, setImportComment] = useState('');
    const [importing, setImporting] = useState(false);

    // Generate form state
    const [genName, setGenName] = useState('');
    const [genType, setGenType] = useState<'ed25519' | 'rsa'>('ed25519');
    const [genComment, setGenComment] = useState('');
    const [generating, setGenerating] = useState(false);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            setKeys(await api.sshKeyList());
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    // 90-22: ESC closes the modal
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Delete key "${name}"? Connections using it will need to be reconfigured.`)) return;
        try {
            await api.sshKeyDelete(id);
            setKeys(k => k.filter(x => x.id !== id));
        } catch (e) {
            alert(String(e));
        }
    };

    const handleImport = async () => {
        if (!importName.trim() || !importPem.trim() || !importPub.trim()) {
            alert('Name, private key PEM and public key are required.');
            return;
        }
        setImporting(true);
        setError(null);
        try {
            // CRIT-1 fix: send plaintext PEM to the server; encryption happens
            // inside ssh_key_create (server-side via private_key_plaintext field).
            const fingerprint = computeFingerprint(importPub.trim());
            const keyType = importPub.trim().startsWith('ssh-rsa') ? 'rsa' : 'ed25519';
            const key = await api.sshKeyCreate({
                name: importName.trim(),
                key_type: keyType,
                public_key: importPub.trim(),
                private_key_plaintext: importPem.trim(),
                fingerprint,
                comment: importComment.trim() || null,
            });
            setKeys(k => [...k, key]);
            setImportName(''); setImportPem(''); setImportPub(''); setImportComment('');
            setTab('list');
        } catch (e) {
            setError(String(e));
        } finally {
            setImporting(false);
        }
    };

    const handleGenerate = async () => {
        if (!genName.trim()) { alert('Key name is required.'); return; }
        setGenerating(true);
        setError(null);
        try {
            const key = await api.sshKeyGenerate(genName.trim(), genType, genComment.trim() || undefined);
            setKeys(k => [...k, key]);
            setGenName(''); setGenComment('');
            setTab('list');
        } catch (e) {
            setError(String(e));
        } finally {
            setGenerating(false);
        }
    };

    const copyPub = (pub: string) => navigator.clipboard.writeText(pub).catch(() => {});

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-2xl bg-surface border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                style={{ maxHeight: '85vh' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div className="flex items-center gap-3">
                        <Key className="w-5 h-5 text-accent" />
                        <h2 className="text-base font-bold text-text-primary">SSH Key Manager</h2>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 px-6 pt-4">
                    {(['list', 'import', 'generate'] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors capitalize ${tab === t ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary hover:bg-white/5'}`}
                        >
                            {t === 'list' ? `Keys (${keys.length})` : t === 'import' ? 'Import PEM' : 'Generate New'}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {error && (
                        <div className="mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                            {error}
                        </div>
                    )}

                    {/* Key list */}
                    {tab === 'list' && (
                        <div className="space-y-2">
                            {loading ? (
                                <div className="flex items-center justify-center py-12 text-text-muted">
                                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
                                </div>
                            ) : keys.length === 0 ? (
                                <div className="text-center py-12 text-text-muted text-sm">
                                    <Key className="w-8 h-8 mx-auto mb-3 opacity-30" />
                                    <p>No SSH keys stored.</p>
                                    <p className="text-xs mt-1 opacity-60">Import an existing key or generate a new one.</p>
                                </div>
                            ) : (
                                keys.map(key => (
                                    <div key={key.id} className="border border-border rounded-xl overflow-hidden">
                                        <button
                                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
                                            onClick={() => setExpandedKey(expandedKey === key.id ? null : key.id)}
                                        >
                                            <Key className="w-4 h-4 text-accent shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-semibold text-text-primary truncate">{key.name}</div>
                                                <div className="text-xs text-text-muted font-mono truncate">{key.fingerprint}</div>
                                            </div>
                                            <span className="text-[10px] text-text-muted bg-white/5 px-2 py-0.5 rounded font-mono uppercase">{key.key_type}</span>
                                            <ChevronDown className={`w-3.5 h-3.5 text-text-muted transition-transform ${expandedKey === key.id ? 'rotate-180' : ''}`} />
                                        </button>
                                        <AnimatePresence>
                                            {expandedKey === key.id && (
                                                <motion.div
                                                    initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                                                    className="overflow-hidden border-t border-border"
                                                >
                                                    <div className="px-4 py-3 space-y-2">
                                                        <div>
                                                            <div className="text-[10px] text-text-muted uppercase mb-1">Public Key</div>
                                                            <div className="bg-base rounded-lg px-3 py-2 font-mono text-[10px] text-text-muted break-all line-clamp-2">
                                                                {key.public_key}
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button onClick={() => copyPub(key.public_key)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-text-muted hover:text-text-primary transition-colors">
                                                                <Copy className="w-3 h-3" /> Copy public key
                                                            </button>
                                                            <button onClick={() => handleDelete(key.id, key.name)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-xs text-red-400 transition-colors ml-auto">
                                                                <Trash2 className="w-3 h-3" /> Delete
                                                            </button>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {/* Import PEM */}
                    {tab === 'import' && (
                        <div className="space-y-4">
                            <p className="text-xs text-text-muted">Paste an existing OpenSSH private key (PEM format). The private key is encrypted with your vault master key before being stored.</p>
                            <div>
                                <label className="text-xs text-text-muted mb-1 block">Key name *</label>
                                <input value={importName} onChange={e => setImportName(e.target.value)}
                                    className="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                                    placeholder="e.g. Production server key" />
                            </div>
                            <div>
                                <label className="text-xs text-text-muted mb-1 block">Private key (PEM) *</label>
                                <textarea value={importPem} onChange={e => setImportPem(e.target.value)} rows={6}
                                    className="w-full bg-base border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary outline-none focus:border-accent resize-none"
                                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----" />
                            </div>
                            <div>
                                <label className="text-xs text-text-muted mb-1 block">Public key *</label>
                                <textarea value={importPub} onChange={e => setImportPub(e.target.value)} rows={2}
                                    className="w-full bg-base border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary outline-none focus:border-accent resize-none"
                                    placeholder="ssh-ed25519 AAAA... user@host" />
                            </div>
                            <div>
                                <label className="text-xs text-text-muted mb-1 block">Comment (optional)</label>
                                <input value={importComment} onChange={e => setImportComment(e.target.value)}
                                    className="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                                    placeholder="e.g. admin@server-prod" />
                            </div>
                            <button onClick={handleImport} disabled={importing}
                                className="w-full h-10 rounded-xl bg-accent text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-accent/90 transition-colors">
                                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                Import & Encrypt
                            </button>
                        </div>
                    )}

                    {/* Generate */}
                    {tab === 'generate' && (
                        <div className="space-y-4">
                            <p className="text-xs text-text-muted">Generate a new key pair using ssh-keygen. The private key is encrypted with your vault master key immediately after generation — it never persists unencrypted.</p>
                            <div>
                                <label className="text-xs text-text-muted mb-1 block">Key name *</label>
                                <input value={genName} onChange={e => setGenName(e.target.value)}
                                    className="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                                    placeholder="e.g. My dev key" />
                            </div>
                            <div>
                                <label className="text-xs text-text-muted mb-1 block">Key type</label>
                                <div className="flex gap-2">
                                    {(['ed25519', 'rsa'] as const).map(t => (
                                        <button key={t} onClick={() => setGenType(t)}
                                            className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-colors ${genType === t ? 'bg-accent text-white' : 'bg-base border border-border text-text-muted hover:text-text-primary'}`}>
                                            {t === 'ed25519' ? 'Ed25519 (recommended)' : 'RSA 4096'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-text-muted mb-1 block">Comment (optional)</label>
                                <input value={genComment} onChange={e => setGenComment(e.target.value)}
                                    className="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                                    placeholder="e.g. user@hostname" />
                            </div>
                            <button onClick={handleGenerate} disabled={generating}
                                className="w-full h-10 rounded-xl bg-accent text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-accent/90 transition-colors">
                                {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Plus className="w-4 h-4" /> Generate Key</>}
                            </button>
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

function computeFingerprint(pubKeyLine: string): string {
    const parts = pubKeyLine.trim().split(' ');
    if (parts.length < 2) return 'unknown';
    try {
        const raw = atob(parts[1]);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        // Simple base64 of bytes as placeholder — real SHA256 computed server-side
        return `SHA256:${btoa(String.fromCharCode(...bytes)).slice(0, 43)}`;
    } catch {
        return 'unknown';
    }
}
