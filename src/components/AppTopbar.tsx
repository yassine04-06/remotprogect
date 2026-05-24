import { Settings, Shield, Globe, Terminal, KeyRound, ClipboardList, Film } from 'lucide-react';
import { useUIStore, useTabStore } from '../store';
import { ConnectionTabs } from './ConnectionTabs';

interface AppTopbarProps {
    onLock: () => void;
}

/**
 * The top bar with the tab strip on the left and action buttons on the right.
 * Extracted from App.tsx (MED-4 refactor).
 */
export function AppTopbar({ onLock }: AppTopbarProps) {
    const setShowPortScanner = useUIStore(s => s.setShowPortScanner);
    const setShowSettingsDialog = useUIStore(s => s.setShowSettingsDialog);
    const setShowCredentialManager = useUIStore(s => s.setShowCredentialManager);
    const setShowAuditLog = useUIStore(s => s.setShowAuditLog);
    const setShowRecordings = useUIStore(s => s.setShowRecordings);

    const tabs = useTabStore(s => s.tabs);
    const addTab = useTabStore(s => s.addTab);
    const setActiveTabId = useTabStore(s => s.setActiveTabId);
    const isBroadcastMode = useTabStore(s => s.isBroadcastMode);
    const setBroadcastMode = useTabStore(s => s.setBroadcastMode);

    return (
        <div className="flex h-12 border-b border-border bg-surface/30 backdrop-blur-md justify-between items-center px-2">
            <div className="flex-1 overflow-hidden h-full flex items-center">
                {tabs.length > 0 && <ConnectionTabs />}
            </div>

            <div className="flex items-center px-2 flex-shrink-0 gap-1">
                <button
                    type="button"
                    onClick={() => setShowPortScanner(true)}
                    className="btn-icon"
                    title="Network Scanner"
                    aria-label="Network Scanner"
                >
                    <Globe className="w-4 h-4" />
                </button>

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

                <button
                    type="button"
                    onClick={() => {
                        const id = `local-${Date.now()}`;
                        addTab({ id, connectionId: 'local', connectionName: 'Terminal', protocol: 'LOCAL', status: 'connected' });
                        setActiveTabId(id);
                    }}
                    className="btn-icon"
                    title="Local Terminal"
                    aria-label="Open local terminal"
                >
                    <Terminal className="w-4 h-4" />
                </button>

                <button type="button" onClick={() => setShowCredentialManager(true)} className="btn-icon" title="Credential Profiles" aria-label="Credential Profiles">
                    <KeyRound className="w-4 h-4" />
                </button>

                <button type="button" onClick={() => setShowRecordings(true)} className="btn-icon" title="Session Recordings" aria-label="Session Recordings">
                    <Film className="w-4 h-4" />
                </button>

                <button type="button" onClick={() => setShowAuditLog(true)} className="btn-icon" title="Audit Log" aria-label="Audit Log">
                    <ClipboardList className="w-4 h-4" />
                </button>

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
