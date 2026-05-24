import { lazy, Suspense, useEffect, useState } from 'react';
import {
    useUIStore,
    useTabStore,
    useConnectionStore,
    useCredentialStore,
    useGlobalDataInitializer,
} from './store';
import * as api from './services/api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UnlockScreen } from './components/UnlockScreen';
import { ServerSidebar } from './components/ServerSidebar';
import { SplitPaneView } from './components/SplitPaneView';
import { QuickConnectBar } from './components/QuickConnectBar';
import { BroadcastBar } from './components/BroadcastBar';
import { AppTopbar } from './components/AppTopbar';
import { AppModals } from './components/AppModals';
import { Toaster } from './components/Toaster';
import { motion, AnimatePresence } from 'framer-motion';
import { eventBus } from './store/events';

// MED-A13: protocol views are heavy (xterm.js, canvas, RDP embed) — lazy-load
// them so the initial JS bundle is smaller and the unlock/dashboard screen
// renders faster.  Each view lands in its own async chunk.
const TerminalView = lazy(() =>
    import('./components/TerminalView').then(m => ({ default: m.TerminalView }))
);
const RdpView = lazy(() =>
    import('./components/RdpView').then(m => ({ default: m.RdpView }))
);
const VncView = lazy(() =>
    import('./components/VncView').then(m => ({ default: m.VncView }))
);
const LocalTerminalView = lazy(() =>
    import('./components/LocalTerminalView').then(m => ({ default: m.LocalTerminalView }))
);
const HealthDashboard = lazy(() =>
    import('./components/HealthDashboard').then(m => ({ default: m.HealthDashboard }))
);
const ProxmoxView = lazy(() =>
    import('./components/ProxmoxView').then(m => ({ default: m.ProxmoxView }))
);
const DockerView = lazy(() =>
    import('./components/DockerView').then(m => ({ default: m.DockerView }))
);
const FileManagerView = lazy(() =>
    import('./components/FileManagerView').then(m => ({ default: m.FileManagerView }))
);

// ── Tab content router ────────────────────────────────────
//
// M-2: only the most-recently-used tabs render the heavy view (xterm,
// VNC canvas, embedded RDP, lazy-loaded panels). Older tabs collapse to
// a lightweight placeholder; the backend session keeps running (Tauri
// state is unaffected by frontend mount), and switching to the tab
// re-mounts the view. MRU_LIMIT picks how many tabs stay mounted in
// addition to the active one and any split partner.

const MRU_LIMIT = 4;

// L-1: shown when a Proxmox / Docker tab is missing its connection record
// (e.g. the underlying ServerConnection was deleted while the tab was open).
// Replaces a previous `tab.connection!` non-null assertion that would have
// crashed the panel at runtime.
function MissingConnectionPlaceholder({ tab }: { tab: { id: string; connectionName: string; protocol: string } }) {
    const closeTab = useTabStore(s => s.closeTab);
    return (
        <div className="w-full h-full flex items-center justify-center bg-base text-text-muted">
            <div className="glass-card rounded-2xl p-8 text-center max-w-sm">
                <div className="text-xs uppercase tracking-[0.2em] font-bold text-red-400 mb-2">
                    Connection missing
                </div>
                <div className="text-text-primary font-semibold mb-3">{tab.connectionName}</div>
                <p className="text-xs text-text-muted mb-5">
                    This {tab.protocol} tab has no associated connection record. The
                    underlying server may have been deleted. Close this tab and reopen
                    it from the sidebar.
                </p>
                <button
                    type="button"
                    onClick={() => closeTab(tab.id)}
                    className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-bold hover:bg-accent/90"
                >
                    Close tab
                </button>
            </div>
        </div>
    );
}

function PausedTabPlaceholder({ tab, onResume }: { tab: { connectionName: string; protocol: string }; onResume: () => void }) {
    return (
        <div className="w-full h-full flex items-center justify-center bg-base text-text-muted">
            <div className="glass-card rounded-2xl p-8 text-center max-w-sm">
                <div className="text-xs uppercase tracking-[0.2em] font-bold text-text-muted mb-2">
                    {tab.protocol} session paused
                </div>
                <div className="text-text-primary font-semibold mb-3">{tab.connectionName}</div>
                <p className="text-xs text-text-muted mb-5">
                    The rendering for this tab has been suspended to save memory.
                    The backend session is still running — reattach to see it again.
                </p>
                <button
                    type="button"
                    onClick={onResume}
                    className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-bold hover:bg-accent/90"
                >
                    Reattach
                </button>
            </div>
        </div>
    );
}

function TabContent() {
    const tabs = useTabStore(s => s.tabs);
    const activeTabId = useTabStore(s => s.activeTabId);
    const splitTabId = useTabStore(s => s.splitTabId);
    const splitDirection = useTabStore(s => s.splitDirection);
    const lastActiveAt = useTabStore(s => s.lastActiveAt);
    const setActiveTab = useTabStore(s => s.setActiveTab);

    // Compute which tabs stay mounted: active + split partner + top MRU_LIMIT.
    const mountedSet = (() => {
        const set = new Set<string>();
        if (activeTabId) set.add(activeTabId);
        if (splitTabId) set.add(splitTabId);
        const ranked = [...tabs]
            .filter(t => !set.has(t.id))
            .sort((a, b) => (lastActiveAt[b.id] ?? 0) - (lastActiveAt[a.id] ?? 0));
        for (const t of ranked.slice(0, MRU_LIMIT)) set.add(t.id);
        return set;
    })();

    return (
        <AnimatePresence mode="wait">
            {tabs.length === 0 ? (
                <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full relative"
                >
                    <ErrorBoundary panelName="Dashboard">
                        <Suspense fallback={<div className="w-full h-full bg-base" />}>
                            <HealthDashboard />
                        </Suspense>
                    </ErrorBoundary>
                </motion.div>
            ) : (
                <div className="w-full h-full">
                    {tabs.map(tab => {
                        const isMounted = mountedSet.has(tab.id);
                        return (
                        <div
                            key={tab.id}
                            className={activeTabId === tab.id ? 'w-full h-full' : 'hidden'}
                        >
                            <ErrorBoundary panelName={tab.connectionName}>
                                {!isMounted ? (
                                    <PausedTabPlaceholder
                                        tab={tab}
                                        onResume={() => setActiveTab(tab.id)}
                                    />
                                ) : tab.protocol === 'SSH' ? (
                                    (() => {
                                        const secondary = splitTabId && activeTabId === tab.id
                                            ? tabs.find(t => t.id === splitTabId)
                                            : undefined;
                                        return secondary ? (
                                            <SplitPaneView
                                                primaryTab={tab}
                                                secondaryTab={secondary}
                                                direction={splitDirection}
                                                isActive={true}
                                            />
                                        ) : (
                                            <Suspense fallback={<div className="w-full h-full bg-base" />}>
                                                <TerminalView tab={tab} isActive={activeTabId === tab.id} />
                                            </Suspense>
                                        );
                                    })()
                                ) : tab.protocol === 'RDP' ? (
                                    <Suspense fallback={<div className="w-full h-full bg-base" />}>
                                        <RdpView tab={tab} isActive={activeTabId === tab.id} />
                                    </Suspense>
                                ) : tab.protocol === 'LOCAL' ? (
                                    <Suspense fallback={<div className="w-full h-full bg-base" />}>
                                        <LocalTerminalView tab={tab} isActive={activeTabId === tab.id} />
                                    </Suspense>
                                ) : tab.protocol === 'SFTP' || tab.protocol === 'FTP' ? (
                                    <Suspense fallback={<div className="w-full h-full bg-base" />}>
                                        <FileManagerView tab={tab} isActive={activeTabId === tab.id} />
                                    </Suspense>
                                ) : tab.protocol === 'PROXMOX' ? (
                                    tab.connection ? (
                                        <Suspense fallback={<div className="w-full h-full bg-base" />}>
                                            <ProxmoxView connection={tab.connection} />
                                        </Suspense>
                                    ) : (
                                        <MissingConnectionPlaceholder tab={tab} />
                                    )
                                ) : tab.protocol === 'DOCKER' ? (
                                    tab.connection ? (
                                        <Suspense fallback={<div className="w-full h-full bg-base" />}>
                                            <DockerView connection={tab.connection} />
                                        </Suspense>
                                    ) : (
                                        <MissingConnectionPlaceholder tab={tab} />
                                    )
                                ) : (
                                    <Suspense fallback={<div className="w-full h-full bg-base" />}>
                                        <VncView tab={tab} isActive={activeTabId === tab.id} />
                                    </Suspense>
                                )}
                            </ErrorBoundary>
                        </div>
                        );
                    })}
                </div>
            )}
        </AnimatePresence>
    );
}

// ── Main layout ───────────────────────────────────────────

function MainLayout() {
    useGlobalDataInitializer();

    const isFullscreen   = useUIStore(s => s.isFullscreen);
    const theme          = useUIStore(s => s.theme);
    const setVaultUnlocked = useUIStore(s => s.setVaultUnlocked);
    const addToast       = useUIStore(s => s.addToast);

    // MED-A12: context menu suppressed only on terminal/canvas elements
    // (data-no-contextmenu attribute), NOT globally on the document.
    // Global suppression breaks accessibility: users can't right-click text
    // in modals, inputs, or the sidebar to access OS clipboard/spell-check.
    useEffect(() => {
        const handleContext = (e: MouseEvent) => {
            if ((e.target as Element)?.closest('[data-no-contextmenu]')) {
                e.preventDefault();
            }
        };
        document.addEventListener('contextmenu', handleContext);
        return () => document.removeEventListener('contextmenu', handleContext);
    }, []);

    // MED-A4: subscribe to connection_deleted here (React useEffect) instead of
    // inside the Zustand create() call.  The store-level approach used a module-
    // level flag that reset on every Vite HMR cycle while the eventBus singleton
    // survived, causing N duplicate listeners after N hot-reloads.  React's
    // useEffect cleanup removes the old listener before each re-mount, so there
    // is always exactly one subscriber regardless of how many HMR cycles occur.
    useEffect(() => {
        return eventBus.on('connection_deleted', (id: string) => {
            const { tabs, closeTab } = useTabStore.getState();
            const tabToClose = tabs.find(t => t.connectionId === id);
            if (tabToClose) closeTab(tabToClose.id);
        });
    }, []);

    // LOW-A5: Global tab switching shortcuts.
    //
    // Registered in the CAPTURE phase so the handler fires before xterm.js
    // (which listens on the canvas element in the bubbling phase).  This lets
    // us call e.preventDefault() early enough to stop the key from being sent
    // to the remote shell.
    //
    //   Ctrl+Tab          → next tab (wraps around)
    //   Ctrl+Shift+Tab    → previous tab (wraps around)
    //   Ctrl+1 … Ctrl+9  → jump to tab by 1-based index
    //
    // The handler is a no-op when focus is inside a text input/textarea/select
    // so form fields inside modals still receive normal keyboard input.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't steal keystrokes from editable fields.
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if ((e.target as HTMLElement)?.isContentEditable) return;

            const { tabs, activeTabId, setActiveTab } = useTabStore.getState();
            if (tabs.length === 0) return;

            // Ctrl+Shift+I → open import dialog
            // NB: with Shift held, e.key is 'I' (uppercase) on most layouts —
            // compare case-insensitively so the shortcut fires regardless.
            if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i') {
                e.preventDefault();
                useUIStore.getState().setShowImportDialog(true);
                return;
            }

            // Ctrl+Tab → next tab
            if (e.ctrlKey && !e.shiftKey && e.key === 'Tab') {
                e.preventDefault();
                const idx = tabs.findIndex(t => t.id === activeTabId);
                setActiveTab(tabs[(idx + 1) % tabs.length].id);
                return;
            }

            // Ctrl+Shift+Tab → previous tab
            if (e.ctrlKey && e.shiftKey && e.key === 'Tab') {
                e.preventDefault();
                const idx = tabs.findIndex(t => t.id === activeTabId);
                setActiveTab(tabs[(idx - 1 + tabs.length) % tabs.length].id);
                return;
            }

            // Ctrl+1…9 → jump to tab by index (1-based)
            if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
                const n = parseInt(e.key, 10);
                if (n >= 1 && n <= 9) {
                    const target = tabs[n - 1];
                    if (target) {
                        e.preventDefault();
                        setActiveTab(target.id);
                    }
                }
            }
        };

        // Capture phase: fires before xterm canvas handlers.
        document.addEventListener('keydown', handleKeyDown, { capture: true });
        return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
    }, []);

    const handleLock = async () => {
        await api.lockVault();
        useConnectionStore.getState().resetForLock();
        useCredentialStore.getState().resetForLock();
        useTabStore.getState().closeAllTabs();
        setVaultUnlocked(false);
        addToast({ type: 'info', title: 'Vault locked', description: 'Your session has been securely closed.' });
    };

    return (
        <div className={`flex h-screen bg-base text-text-primary overflow-hidden font-sans theme-${theme}`}>
            {/* Sidebar */}
            <div className={isFullscreen ? 'hidden' : 'flex'}>
                <ErrorBoundary panelName="Sidebar">
                    <ServerSidebar />
                </ErrorBoundary>
            </div>

            {/* Main column */}
            <div className="flex-1 flex flex-col min-w-0 h-full relative">
                {!isFullscreen && <AppTopbar onLock={handleLock} />}
                {!isFullscreen && <QuickConnectBar />}
                {!isFullscreen && <BroadcastBar />}

                <div className="flex-1 relative bg-base shadow-inner overflow-hidden">
                    <TabContent />
                </div>
            </div>

            <AppModals />
            <Toaster />
        </div>
    );
}

// ── Root ─────────────────────────────────────────────────

export default function App() {
    const isVaultUnlocked = useUIStore(s => s.isVaultUnlocked);
    const setVaultUnlocked = useUIStore(s => s.setVaultUnlocked);
    const setFirstLaunch = useUIStore(s => s.setFirstLaunch);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // MED-A7: first_run is now a separate call so VaultStatus doesn't
        // bundle unrelated state into a single pre-auth response.
        Promise.all([api.isVaultUnlocked(), api.isFirstRun()])
            .then(([status, firstRun]) => {
                setFirstLaunch(firstRun);
                setVaultUnlocked(status.unlocked);
            })
            .catch(() => {
                // Backend unreachable at startup — proceed to unlock screen
            })
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (loading) {
        return (
            <div className="h-screen bg-base flex items-center justify-center">
                <motion.div
                    animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="text-accent font-black tracking-[0.3em] uppercase text-sm"
                >
                    NexoRC
                </motion.div>
            </div>
        );
    }

    return (
        <ErrorBoundary>
            <AnimatePresence mode="wait">
                {isVaultUnlocked ? (
                    <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full h-full">
                        <MainLayout />
                    </motion.div>
                ) : (
                    <motion.div key="unlock" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="w-full h-full">
                        <UnlockScreen />
                    </motion.div>
                )}
            </AnimatePresence>
        </ErrorBoundary>
    );
}
