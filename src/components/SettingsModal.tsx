import { useEffect, useState } from 'react';
import {
    X,
    Save,
    Download,
    Upload,
    ShieldCheck,
    Lock,
    Database,
    Palette,
    Check,
    RefreshCw,
    Layers,
    ShieldOff,
    Loader2,
} from 'lucide-react';
import { useUIStore, useConnectionStore } from '../store';
import * as api from '../services/api';
import { save as saveDialog, open as openDialog, confirm } from '@tauri-apps/plugin-dialog';
import { parseBackendError, getUserFriendlyErrorMessage } from '../utils/errorMapper';
import { motion, AnimatePresence } from 'framer-motion';
import { ProxmoxCertsModal } from './ProxmoxCertsModal';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const fetchData = useConnectionStore(s => s.fetchConnections);
    const addToast = useUIStore(s => s.addToast);
    const theme = useUIStore(s => s.theme);
    const setTheme = useUIStore(s => s.setTheme);
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [activeSection, setActiveSection] = useState<'security' | 'data' | 'appearance' | 'about'>(
        'security'
    );
    const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'latest' | 'error' | 'installing'>('idle');
    const [updateInfo, setUpdateInfo] = useState<{ version?: string; notes?: string } | null>(null);
    // MED-A11: allow multiple instances setting
    const [allowMultiple, setAllowMultiple] = useState(false);
    const [allowMultipleLoading, setAllowMultipleLoading] = useState(false);
    // MED-A8: Proxmox pinned certs modal
    const [showCertsModal, setShowCertsModal] = useState(false);

    // 90-22: ESC closes the modal
    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [isOpen, onClose]);

    // MED-A11: load allow-multiple-instances setting whenever the security tab opens
    useEffect(() => {
        if (!isOpen || activeSection !== 'security') return;
        api.getAllowMultipleInstances()
            .then(val => setAllowMultiple(val))
            .catch(() => { /* ignore — stay at default false */ });
    }, [isOpen, activeSection]);

    const handleCheckUpdate = async () => {
        setUpdateStatus('checking');
        setUpdateInfo(null);
        try {
            const result = await api.checkForUpdate();
            if (result.available) {
                setUpdateStatus('available');
                setUpdateInfo({ version: result.version, notes: result.notes });
            } else {
                setUpdateStatus('latest');
            }
        } catch {
            setUpdateStatus('error');
        }
    };

    const handleInstallUpdate = async () => {
        setUpdateStatus('installing');
        try {
            await api.installUpdate(); // downloads, installs, then app restarts automatically
        } catch {
            setUpdateStatus('error');
        }
    };

    // MED-A11: persist the toggle, show a restart-needed notice
    const handleAllowMultipleToggle = async (next: boolean) => {
        setAllowMultipleLoading(true);
        try {
            await api.setAllowMultipleInstances(next);
            setAllowMultiple(next);
            addToast({
                type: 'info',
                title: 'Setting saved',
                description: 'Takes effect on next application launch.',
            });
        } catch (err: unknown) {
            const appError = parseBackendError(err);
            addToast({
                type: 'error',
                title: 'Failed to save setting',
                description: getUserFriendlyErrorMessage(appError),
            });
        } finally {
            setAllowMultipleLoading(false);
        }
    };

    if (!isOpen) return null;

    // 90-23: Native filesystem export via Tauri save dialog
    const handleExport = async () => {
        try {
            const path = await saveDialog({
                defaultPath: `nexorc_vault_${new Date().toISOString().split('T')[0]}.json`,
                filters: [{ name: 'NexoRC Vault', extensions: ['json'] }],
            });
            if (!path) return;
            await api.vaultExportFile(path);
            addToast({
                type: 'success',
                title: 'Vault exported',
                description: 'Backup written to disk.',
            });
        } catch (err: unknown) {
            const appError = parseBackendError(err);
            addToast({
                type: 'error',
                title: 'Export failed',
                description: getUserFriendlyErrorMessage(appError),
            });
        }
    };

    // Export connection list as CSV (no passwords)
    const handleExportCsv = async () => {
        try {
            const path = await saveDialog({
                defaultPath: `nexorc_connections_${new Date().toISOString().split('T')[0]}.csv`,
                filters: [{ name: 'CSV Spreadsheet', extensions: ['csv'] }],
            });
            if (!path) return;
            await api.exportConnectionsCsv(path);
            addToast({
                type: 'success',
                title: 'CSV exported',
                description: 'Connection list saved (no passwords).',
            });
        } catch (err: unknown) {
            const appError = parseBackendError(err);
            addToast({
                type: 'error',
                title: 'CSV export failed',
                description: getUserFriendlyErrorMessage(appError),
            });
        }
    };

    // 90-23: Native filesystem import via Tauri open dialog
    const handleImport = async () => {
        const path = await openDialog({
            multiple: false,
            filters: [{ name: 'NexoRC Vault', extensions: ['json'] }],
        });
        if (!path) return;

        const ok = await confirm('This will OVERWRITE your entire current vault. This cannot be undone.', { title: 'Overwrite Vault?', kind: 'warning' });
        if (!ok) return;

        try {
            await api.vaultImportFile(path as string);
            await fetchData();
            addToast({
                type: 'success',
                title: 'Vault restored',
                description: 'Data synchronization complete.',
            });
        } catch (err: unknown) {
            const appError = parseBackendError(err);
            addToast({
                type: 'error',
                title: 'Import failed',
                description: getUserFriendlyErrorMessage(appError),
            });
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password || password.length < 8) {
            addToast({
                type: 'error',
                title: 'Complexity error',
                description: 'Password must be at least 8 characters.',
            });
            return;
        }

        setLoading(true);
        try {
            await api.setMasterPassword(password);
            addToast({
                type: 'success',
                title: 'Security updated',
                description: 'Master password changed successfully.',
            });
            setPassword('');
            onClose();
        } catch (err: unknown) {
            const appError = parseBackendError(err);
            addToast({
                type: 'error',
                title: 'Critical failure',
                description: getUserFriendlyErrorMessage(appError),
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <AnimatePresence>
            <div
                className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 30 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 30 }}
                    className="flex flex-row glass-card w-full max-w-3xl h-[500px] rounded-2xl overflow-hidden border border-border/50"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Navigation Sidebar */}
                    <div className="w-64 border-r border-border bg-base/30 p-4 flex flex-col gap-2">
                        <div className="px-3 py-6 mb-4">
                            <h2 className="text-xl font-bold tracking-tight">Settings</h2>
                            <p className="text-[10px] font-black uppercase tracking-widest text-text-muted mt-1">
                                System Control
                            </p>
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

                        <button
                            onClick={() => setActiveSection('about')}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${activeSection === 'about' ? 'bg-accent/10 text-accent shadow-sm' : 'text-text-muted hover:bg-accent/5 focus:bg-accent/5'}`}
                        >
                            <RefreshCw className="w-4 h-4" /> About & Updates
                        </button>

                        <div className="mt-auto p-4 border-t border-border opacity-40">
                            <div className="text-[9px] font-bold uppercase tracking-widest">
                                NexoRC v0.1.0-alpha
                            </div>
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
                                            <h3 className="text-lg font-bold mb-2">
                                                Master Vault Security
                                            </h3>
                                            <p className="text-xs text-text-muted leading-relaxed">
                                                Update your master password to re-encrypt your
                                                entire vault. Ensure this is stored safely; it is
                                                the only way to recover your data.
                                            </p>
                                        </div>

                                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex gap-4">
                                            <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0">
                                                <Lock className="w-5 h-5 text-red-400" />
                                            </div>
                                            <div>
                                                <h3 className="text-sm font-bold text-red-300">
                                                    Master Password
                                                </h3>
                                                <p className="text-[11px] text-red-400/70 mt-0.5">
                                                    Protect your vault with high-grade encryption.
                                                </p>
                                            </div>
                                        </div>

                                        <form onSubmit={handlePasswordChange} className="space-y-4">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-text-muted px-1">
                                                    New Password
                                                </label>
                                                <input
                                                    type="password"
                                                    value={password}
                                                    onChange={e => setPassword(e.target.value)}
                                                    className="w-full h-11 bg-accent/5 border border-border rounded-xl px-4 text-sm focus:outline-none focus:ring-1 focus:ring-accent/40 transition-all font-mono"
                                                    placeholder="At least 8 characters..."
                                                />
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={loading || password.length < 8}
                                                className="w-full h-11 bg-accent text-white rounded-xl text-sm font-bold hover:bg-accent/90 transition-all flex items-center justify-center gap-2 group shadow-lg"
                                            >
                                                {loading ? (
                                                    'Processing...'
                                                ) : (
                                                    <>
                                                        Update Security{' '}
                                                        <Save className="w-4 h-4 group-hover:scale-110 transition-transform" />
                                                    </>
                                                )}
                                            </button>
                                        </form>

                                        <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/10 flex gap-4">
                                            <Lock className="w-5 h-5 text-red-500 shrink-0" />
                                            <div>
                                                <p className="text-[11px] font-bold text-red-400 uppercase tracking-wider mb-1">
                                                    Security Impact
                                                </p>
                                                <p className="text-[11px] text-text-muted leading-relaxed">
                                                    Changing your password will re-index all
                                                    encrypted blobs. This may take a moment for
                                                    large vaults.
                                                </p>
                                            </div>
                                        </div>

                                        {/* MED-A11: allow multiple instances toggle */}
                                        <div className="flex items-start gap-4 p-4 rounded-2xl bg-accent/5 border border-border">
                                            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                                                <Layers className="w-4 h-4 text-accent" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-text-primary">
                                                    Allow multiple instances
                                                </p>
                                                <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                                                    By default only one NexoRC window can run at a time.
                                                    Enable to allow multiple simultaneous windows.
                                                    Requires a restart to take effect.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={allowMultipleLoading}
                                                onClick={() => handleAllowMultipleToggle(!allowMultiple)}
                                                className={`relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50 ${allowMultiple ? 'bg-accent' : 'bg-border'}`}
                                            >
                                                <span
                                                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${allowMultiple ? 'translate-x-5' : 'translate-x-0'}`}
                                                />
                                            </button>
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
                                            <h3 className="text-lg font-bold mb-1">
                                                Visual Identity
                                            </h3>
                                            <p className="text-[11px] text-text-muted">
                                                Customize the aesthetic experience of your terminal
                                                environment.
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            {[
                                                {
                                                    id: 'default',
                                                    name: 'Catppuccin Mocha',
                                                    desc: 'Modern & Balanced',
                                                    preview: 'bg-[#1e1e2e]',
                                                },
                                                {
                                                    id: 'light',
                                                    name: 'Day Mode',
                                                    desc: 'Clean & Bright',
                                                    preview: 'bg-[#ffffff]',
                                                },
                                                {
                                                    id: 'stealth',
                                                    name: 'Stealth Mode',
                                                    desc: 'Ultra-Dark Grayscale',
                                                    preview: 'bg-[#0a0a0a]',
                                                },
                                                {
                                                    id: 'matrix',
                                                    name: 'The Matrix',
                                                    desc: 'Neon Green Digital',
                                                    preview: 'bg-[#000000]',
                                                },
                                                {
                                                    id: 'cyberpunk',
                                                    name: 'Night City',
                                                    desc: 'Neon Purple & Cyan',
                                                    preview: 'bg-[#0d0221]',
                                                },
                                            ].map(t => (
                                                <button
                                                    key={t.id}
                                                    onClick={() => setTheme(t.id as Parameters<typeof setTheme>[0])}
                                                    className={`p-4 rounded-xl border transition-all text-left flex items-start gap-4 relative group ${theme === t.id ? 'bg-accent/10 border-accent/50 ring-1 ring-accent/30' : 'bg-base/20 border-border hover:border-accent/30 hover:bg-accent/5'}`}
                                                >
                                                    <div
                                                        className={`w-10 h-10 rounded-lg ${t.preview} border border-border shrink-0 shadow-inner flex items-center justify-center`}
                                                    >
                                                        {theme === t.id && (
                                                            <Check
                                                                className={`w-5 h-5 ${t.id === 'light' ? 'text-black' : 'text-white'}`}
                                                            />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p
                                                            className={`text-[13px] font-bold truncate ${theme === t.id ? 'text-accent' : 'text-text-primary'}`}
                                                        >
                                                            {t.name}
                                                        </p>
                                                        <p className="text-[10px] text-text-muted truncate">
                                                            {t.desc}
                                                        </p>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>

                                        <div className="p-4 rounded-2xl bg-accent/5 border border-accent/10 flex gap-4">
                                            <Palette className="w-5 h-5 text-accent shrink-0" />
                                            <div>
                                                <p className="text-[11px] font-bold text-accent uppercase tracking-wider mb-1">
                                                    Experimental Aesthetics
                                                </p>
                                                <p className="text-[11px] text-text-muted leading-relaxed">
                                                    Themes modify global CSS variables. All
                                                    high-density components automatically inherit
                                                    the selected color palette.
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
                                            <h3 className="text-lg font-bold mb-2">
                                                Infrastructure Lifecycle
                                            </h3>
                                            <p className="text-xs text-text-muted leading-relaxed">
                                                Manage your connection architecture through portable
                                                backups. Exported data remains encrypted with your
                                                current master key.
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
                                                <span className="text-sm font-bold">
                                                    Export Vault
                                                </span>
                                                <p className="text-[10px] text-text-muted mt-1">
                                                    Download encrypted backup
                                                </p>
                                            </button>

                                            <button
                                                onClick={handleImport}
                                                className="flex flex-col items-center justify-center p-6 bg-accent/5 border border-border rounded-2xl hover:bg-accent/10 hover:border-accent/30 transition-all group"
                                            >
                                                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-all">
                                                    <Download className="w-6 h-6 text-accent" />
                                                </div>
                                                <span className="text-sm font-bold">
                                                    Import Vault
                                                </span>
                                                <p className="text-[10px] text-text-muted mt-1">
                                                    Restore from backup file
                                                </p>
                                            </button>

                                            <button
                                                onClick={handleExportCsv}
                                                className="flex flex-col items-center justify-center p-6 bg-accent/5 border border-border rounded-2xl hover:bg-accent/10 hover:border-accent/30 transition-all group col-span-2"
                                            >
                                                <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-all">
                                                    <Download className="w-6 h-6 text-green-400" />
                                                </div>
                                                <span className="text-sm font-bold">
                                                    Export Connections as CSV
                                                </span>
                                                <p className="text-[10px] text-text-muted mt-1">
                                                    Spreadsheet with connection metadata (no passwords)
                                                </p>
                                            </button>
                                        </div>

                                        {/* MED-A8: Proxmox TOFU cert management */}
                                        <button
                                            type="button"
                                            onClick={() => setShowCertsModal(true)}
                                            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-accent/5 border border-border hover:bg-accent/10 hover:border-accent/30 transition-all group text-left"
                                        >
                                            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                                                <ShieldOff className="w-5 h-5 text-accent" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-text-primary">
                                                    Proxmox Pinned Certificates
                                                </p>
                                                <p className="text-[10px] text-text-muted mt-0.5">
                                                    Review and forget TOFU-pinned Proxmox server certificates
                                                </p>
                                            </div>
                                            <ShieldCheck className="w-4 h-4 text-text-muted shrink-0" />
                                        </button>

                                        <div className="p-4 rounded-2xl bg-accent/5 border border-border flex gap-4">
                                            <Database className="w-5 h-5 text-text-muted shrink-0" />
                                            <div>
                                                <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-1">
                                                    Local Identity
                                                </p>
                                                <p className="text-[11px] text-text-muted leading-relaxed">
                                                    NexoRC stores its primary database at{' '}
                                                    <code>%APPDATA%/nexorc/vault.db</code>. Your
                                                    exports include all metadata and encrypted
                                                    secrets.
                                                </p>
                                            </div>
                                        </div>
                                    </motion.section>
                                )}
                            </AnimatePresence>

                            <AnimatePresence mode="wait">
                                {activeSection === 'about' && (
                                    <motion.section
                                        key="about"
                                        initial={{ opacity: 0, x: 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -10 }}
                                        className="space-y-6"
                                    >
                                        <div>
                                            <h2 className="text-lg font-black">About & Updates</h2>
                                            <p className="text-xs text-text-muted mt-1">
                                                NexoRC v1.0.0
                                            </p>
                                        </div>

                                        <div className="p-5 bg-accent/5 border border-border rounded-2xl space-y-4">
                                            <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider">
                                                Software Update
                                            </p>
                                            <button
                                                onClick={handleCheckUpdate}
                                                disabled={updateStatus === 'checking'}
                                                className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:bg-accent/80 transition-colors"
                                            >
                                                <RefreshCw className={`w-4 h-4 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} />
                                                {updateStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
                                            </button>

                                            {updateStatus === 'latest' && (
                                                <p className="text-xs text-green-400 flex items-center gap-1.5">
                                                    <Check className="w-3.5 h-3.5" /> NexoRC is up to date.
                                                </p>
                                            )}
                                            {updateStatus === 'available' && updateInfo && (
                                                <div className="space-y-3">
                                                    <p className="text-xs font-bold text-accent">
                                                        Update available: v{updateInfo.version}
                                                    </p>
                                                    {updateInfo.notes && (
                                                        <p className="text-[10px] text-text-muted whitespace-pre-wrap">
                                                            {updateInfo.notes}
                                                        </p>
                                                    )}
                                                    <button
                                                        onClick={handleInstallUpdate}
                                                        className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-xl text-sm font-bold hover:bg-green-600 transition-colors"
                                                    >
                                                        <Download className="w-4 h-4" />
                                                        Install Now &amp; Restart
                                                    </button>
                                                </div>
                                            )}
                                            {updateStatus === 'installing' && (
                                                <div className="flex items-center gap-2 text-accent text-xs">
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Downloading and installing… app will restart.
                                                </div>
                                            )}
                                            {updateStatus === 'error' && (
                                                <p className="text-xs text-red-400">
                                                    Update check failed. Check your connection.
                                                </p>
                                            )}
                                        </div>
                                    </motion.section>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </motion.div>
            </div>

            {/* MED-A8: Proxmox pinned certs sub-modal — rendered outside the main card
                so it sits on top with its own z-[300] backdrop */}
            <ProxmoxCertsModal
                isOpen={showCertsModal}
                onClose={() => setShowCertsModal(false)}
            />
        </AnimatePresence>
    );
}
