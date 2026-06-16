import { useEffect, useRef, useState } from 'react';
import {
    Settings,
    Shield,
    ShieldCheck,
    Globe,
    Terminal,
    KeyRound,
    ClipboardList,
    Film,
    LayoutGrid,
    Library,
} from 'lucide-react';
import { useUIStore, useTabStore } from '../store';
import { ConnectionTabs } from './sidebar/ConnectionTabs';

interface AppTopbarProps {
    onLock: () => void;
}

/**
 * Top bar: tab strip on the left, primary actions + a collapsible "Tools" menu
 * (secondary actions) on the right — keeps the bar compact.
 */
export function AppTopbar({ onLock }: AppTopbarProps) {
    const setShowPortScanner = useUIStore(s => s.setShowPortScanner);
    const setShowSettingsDialog = useUIStore(s => s.setShowSettingsDialog);
    const setShowCredentialManager = useUIStore(s => s.setShowCredentialManager);
    const setShowAuditLog = useUIStore(s => s.setShowAuditLog);
    const setShowRecordings = useUIStore(s => s.setShowRecordings);
    const setShowTotpModal = useUIStore(s => s.setShowTotpModal);
    const setShowCommandLibraryDialog = useUIStore(s => s.setShowCommandLibraryDialog);

    const tabs = useTabStore(s => s.tabs);
    const addTab = useTabStore(s => s.addTab);
    const setActiveTabId = useTabStore(s => s.setActiveTabId);
    const isBroadcastMode = useTabStore(s => s.isBroadcastMode);
    const setBroadcastMode = useTabStore(s => s.setBroadcastMode);

    const [toolsOpen, setToolsOpen] = useState(false);
    const toolsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!toolsOpen) return;
        const onDown = (e: MouseEvent) => {
            if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setToolsOpen(false); };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [toolsOpen]);

    const openLocalTerminal = () => {
        const id = `local-${Date.now()}`;
        addTab({ id, connectionId: 'local', connectionName: 'Terminal', protocol: 'LOCAL', status: 'connected' });
        setActiveTabId(id);
    };

    const tools = [
        { icon: Globe, label: 'Network Scanner', action: () => setShowPortScanner(true) },
        { icon: Library, label: 'Command Library', action: () => setShowCommandLibraryDialog(true) },
        { icon: KeyRound, label: 'Credential Profiles', action: () => setShowCredentialManager(true) },
        { icon: Film, label: 'Session Recordings', action: () => setShowRecordings(true) },
        { icon: ClipboardList, label: 'Audit Log', action: () => setShowAuditLog(true) },
        { icon: ShieldCheck, label: '2FA Codes', action: () => setShowTotpModal(true) },
    ];

    return (
        <div className="relative z-[100] flex h-12 border-b border-border bg-surface/30 backdrop-blur-md justify-between items-center px-2">
            <div className="flex-1 overflow-hidden h-full flex items-center">
                {tabs.length > 0 && <ConnectionTabs />}
            </div>

            <div className="flex items-center px-2 flex-shrink-0 gap-1">
                {/* Primary: broadcast + local terminal */}
                <button
                    type="button"
                    onClick={() => setBroadcastMode(!isBroadcastMode)}
                    className={`btn-icon ${isBroadcastMode ? 'text-accent bg-accent/10' : ''}`}
                    title="Toggle Broadcast Mode (Multi-Exec)"
                    aria-label="Toggle broadcast mode"
                    aria-pressed={isBroadcastMode}
                >
                    <Terminal className="w-4 h-4 md:hidden" />
                    <div className="hidden md:flex items-center gap-2">
                        <Terminal className="w-4 h-4" />
                        <span className="text-[10px] uppercase font-bold tracking-widest">Multi</span>
                    </div>
                </button>

                <button type="button" onClick={openLocalTerminal} className="btn-icon" title="Local Terminal" aria-label="Open local terminal">
                    <Terminal className="w-4 h-4" />
                </button>

                {/* Tools dropdown (secondary actions) */}
                <div className="relative" ref={toolsRef}>
                    <button
                        type="button"
                        onClick={() => setToolsOpen(o => !o)}
                        className={`btn-icon ${toolsOpen ? 'text-accent bg-accent/10' : ''}`}
                        title="Tools"
                        aria-label="Tools"
                        aria-haspopup="menu"
                        aria-expanded={toolsOpen}
                    >
                        <LayoutGrid className="w-4 h-4" />
                    </button>
                    {toolsOpen && (
                        <div
                            role="menu"
                            className="absolute right-0 top-full mt-1.5 w-56 z-[200] rounded-xl p-1.5 border border-border bg-surface shadow-2xl shadow-black/50 animate-[float-up_0.12s_ease]"
                        >
                            {tools.map(t => (
                                <button
                                    key={t.label}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { t.action(); setToolsOpen(false); }}
                                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-primary hover:bg-accent/10 hover:text-accent transition-colors"
                                >
                                    <t.icon className="w-4 h-4 shrink-0" />
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="w-px h-5 bg-border mx-1" />

                <button type="button" onClick={() => setShowSettingsDialog(true)} className="btn-icon" title="Settings" aria-label="Settings">
                    <Settings className="w-4 h-4" />
                </button>

                <button type="button" onClick={onLock} className="btn-icon hover:text-red-400" title="Lock Vault" aria-label="Lock vault">
                    <Shield className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
