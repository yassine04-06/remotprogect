import { useState } from 'react';
import { X, Save, Download, Upload, ShieldCheck, Lock, Database, Palette, Check } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import * as api from '../services/api';
import { motion, AnimatePresence } from 'framer-motion';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { fetchData, addToast, theme, setTheme } = useAppStore();
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [activeSection, setActiveSection] = useState<'security' | 'data' | 'appearance'>('security');

    if (!isOpen) return null;

    const handleExport = async () => {
        try {
            const data = await api.exportConnections();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `nexus_export_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            addToast({ type: 'success', title: 'Vault exported', description: 'Your backup is ready.' });
        } catch (err: any) {
            addToast({ type: 'error', title: 'Export failed', description: String(err) });
        }
    };

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!confirm('OVERWRITE WARNING: This will replace your entire current vault. Continue?')) {
            e.target.value = '';
            return;
        }

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            await api.importConnections(data);
            await fetchData();
            addToast({ type: 'success', title: 'Vault restored', description: 'Data synchronization complete.' });
        } catch (err: any) {
            addToast({ type: 'error', title: 'Import failed', description: String(err) });
        } finally {
            e.target.value = '';
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password || password.length < 8) {
            addToast({ type: 'error', title: 'Complexity error', description: 'Password must be at least 8 characters.' });
            return;
        }

        setLoading(true);
        try {
            await api.setMasterPassword(password);
            addToast({ type: 'success', title: 'Security updated', description: 'Master password changed successfully.' });
            setPassword('');
            onClose();
        } catch (err: any) {
            addToast({ type: 'error', title: 'Critical failure', description: String(err) });
        } finally {
            setLoading(false);
        }
    };

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 30 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 30 }}
                    className="flex flex-row glass-card w-full max-w-3xl h-[500px] rounded-2xl overflow-hidden border border-border/50"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Navigation Sidebar */}
                    <div className="w-64 border-r border-border bg-base/30 p-4 flex flex-col gap-2">
                        <div className="px-3 py-6 mb-4">
                            <h2 className="text-xl font-bold tracking-tight">Settings</h2>
                            <p className="text-[10px] font-black uppercase tracking-widest text-text-muted mt-1">System Control</p>
                        </div>

                        <button
                            onClick={() => setActiveSection('security')}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${activeSection === 'security' ? 'bg-accent/10 text-accent shadow-sm' : 'text-text-muted hover:bg-accent/5 focus:bg-accent/5'}`}
                        >
                            <ShieldCheck className="w-4 h-4" /> Security
                        </button>

                        <button
                            onClick={() => setActiveSection('appearance')}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${activeSection === 'appearance' ? 'bg-accent/10 text-accent shadow-sm' : 'text-text-muted hover:bg-accent/5 focus:bg-accent/5'}`}
                        >
                            <Palette className="w-4 h-4" /> Appearance
                        </button>

                        <button
                            onClick={() => setActiveSection('data')}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${activeSection === 'data' ? 'bg-accent/10 text-accent shadow-sm' : 'text-text-muted hover:bg-accent/5 focus:bg-accent/5'}`}
                        >
                            <Database className="w-4 h-4" /> Vault & Data
                        </button>

                        <div className="mt-auto p-4 border-t border-border opacity-40">
                            <div className="text-[9px] font-bold uppercase tracking-widest">Nexus v0.1.0-alpha</div>
                        </div>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 flex flex-col bg-transparent">
                        <div className="flex justify-end p-4">
                            <button onClick={onClose} className="btn-icon">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 pt-0">
                            <AnimatePresence mode="wait">
                                {activeSection === 'security' ? (
                                    <motion.section
                                        key="security"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        className="space-y-8"
                                    >
                                        <div>
                                            <h3 className="text-lg font-bold mb-2">Master Vault Security</h3>
                                            <p className="text-xs text-text-muted leading-relaxed">
                                                Update your master password to re-encrypt your entire vault.
                                                Ensure this is stored safely; it is the only way to recover your data.
                                            </p>
                                        </div>

                                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0">
                                                <Lock className="w-5 h-5 text-red-400" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-red-300">Master Password</h3>
                                                <p className="text-[11px] text-red-400/70 mt-0.5">Protect your vault with high-grade encryption.</p>
                                            </div>
                                        </div>

                                        <form onSubmit={handlePasswordChange} className="space-y-4">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-text-muted px-1">New Password</label>
                                                <input
                                                    type="password"
                                                    value={password}
                                                    onChange={(e) => setPassword(e.target.value)}
                                                    className="w-full h-11 bg-accent/5 border border-border rounded-xl px-4 text-sm focus:outline-none focus:ring-1 focus:ring-accent/40 transition-all font-mono"
                                                    placeholder="At least 8 characters..."
                                                />
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={loading || password.length < 8}
                                                className="w-full h-11 bg-accent text-white rounded-xl text-sm font-bold hover:bg-accent/90 transition-all flex items-center justify-center gap-2 group shadow-lg"
                                            >
                                                {loading ? 'Processing...' : (
                                                    <>
                                                        Update Security <Save className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                                    </>
                                                )}
                                            </button>
                                        </form>

                                        <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/10 flex gap-4">
                                            <Lock className="w-5 h-5 text-red-500 shrink-0" />
                                            <div>
                                                <p className="text-[11px] font-bold text-red-400 uppercase tracking-wider mb-1">Security Impact</p>
                                                <p className="text-[11px] text-text-muted leading-relaxed">
                                                    Changing your password will re-index all encrypted blobs. This may take a moment for large vaults.
                                                </p>
                                            </div>
                                        </div>
                                    </motion.section>
                                ) : activeSection === 'appearance' ? (
                                    <motion.section
                                        key="appearance"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        className="space-y-6"
                                    >
                                        <div>
                                            <h3 className="text-lg font-bold mb-1">Visual Identity</h3>
                                            <p className="text-[11px] text-text-muted">Customize the aesthetic experience of your terminal environment.</p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                { id: 'default', name: 'Catppuccin Mocha', desc: 'Modern & Balanced', preview: 'bg-[#1e1e2e]' },
                                                { id: 'light', name: 'Day Mode', desc: 'Clean & Bright', preview: 'bg-[#ffffff]' },
                                                { id: 'stealth', name: 'Stealth Mode', desc: 'Ultra-Dark Grayscale', preview: 'bg-[#0a0a0a]' },
                                                { id: 'matrix', name: 'The Matrix', desc: 'Neon Green Digital', preview: 'bg-[#000000]' },
                                                { id: 'cyberpunk', name: 'Night City', desc: 'Neon Purple & Cyan', preview: 'bg-[#0d0221]' },
                                            ].map((t) => (
                                                <button
                                                    key={t.id}
                                                    onClick={() => setTheme(t.id as any)}
                                                    className={`p-4 rounded-xl border transition-all text-left flex items-start gap-4 relative group ${theme === t.id ? 'bg-accent/10 border-accent/50 ring-1 ring-accent/30' : 'bg-base/20 border-border hover:border-accent/30 hover:bg-accent/5'}`}
                                                >
                                                    <div className={`w-10 h-10 rounded-lg ${t.preview} border border-border shrink-0 shadow-inner flex items-center justify-center`}>
                                                        {theme === t.id && <Check className={`w-5 h-5 ${t.id === 'light' ? 'text-black' : 'text-white'}`} />}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className={`text-[13px] font-bold truncate ${theme === t.id ? 'text-accent' : 'text-text-primary'}`}>{t.name}</p>
                                                        <p className="text-[10px] text-text-muted truncate">{t.desc}</p>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>

                                        <div className="p-4 rounded-2xl bg-accent/5 border border-accent/10 flex gap-4">
                                            <Palette className="w-5 h-5 text-accent shrink-0" />
                                            <div>
                                                <p className="text-[11px] font-bold text-accent uppercase tracking-wider mb-1">Experimental Aesthetics</p>
                                                <p className="text-[11px] text-text-muted leading-relaxed">
                                                    Themes modify global CSS variables. All high-density components automatically inherit the selected color palette.
                                                </p>
                                            </div>
                                        </div>
                                    </motion.section>
                                ) : (
                                    <motion.section
                                        key="data"
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        className="space-y-8"
                                    >
                                        <div>
                                            <h3 className="text-lg font-bold mb-2">Infrastructure Lifecycle</h3>
                                            <p className="text-xs text-text-muted leading-relaxed">
                                                Manage your connection architecture through portable backups.
                                                Exported data remains encrypted with your current master key.
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <button
                                                onClick={handleExport}
                                                className="flex flex-col items-center justify-center p-6 bg-accent/5 border border-border rounded-2xl hover:bg-accent/10 hover:border-accent/30 transition-all group"
                                            >
                                                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-all">
                                                    <Upload className="w-6 h-6 text-accent" />
                                                </div>
                                                <span className="text-sm font-bold">Export Vault</span>
                                                <p className="text-[10px] text-text-muted mt-1">Download encrypted backup</p>
                                            </button>

                                            <label className="flex flex-col items-center justify-center p-6 bg-accent/5 border border-border rounded-2xl hover:bg-accent/10 hover:border-accent/30 transition-all group cursor-pointer">
                                                <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                                                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-all">
                                                    <Download className="w-6 h-6 text-accent" />
                                                </div>
                                                <span className="text-sm font-bold">Import Vault</span>
                                                <p className="text-[10px] text-text-muted mt-1">Restore from backup file</p>
                                            </label>
                                        </div>

                                        <div className="p-4 rounded-2xl bg-accent/5 border border-border flex gap-4">
                                            <Database className="w-5 h-5 text-text-muted shrink-0" />
                                            <div>
                                                <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">Local Identity</p>
                                                <p className="text-[11px] text-text-muted leading-relaxed">
                                                    Nexus stores its primary database at <code>%APPDATA%/nexus/vault.db</code>.
                                                    Your exports include all metadata and encrypted secrets.
                                                </p>
                                            </div>
                                        </div>
                                    </motion.section>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
