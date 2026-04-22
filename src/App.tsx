import { lazy, Suspense, useEffect, useState } from 'react';
import { Settings, Shield, Globe, Terminal, KeyRound } from 'lucide-react';
import { useUIStore, useTabStore, useConnectionStore, useGlobalDataInitializer } from './store';
import * as api from './services/api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UnlockScreen } from './components/UnlockScreen';
import { ServerSidebar } from './components/ServerSidebar';
import { ConnectionTabs } from './components/ConnectionTabs';
import { ConnectionForm } from './components/ConnectionForm';
import { TerminalView } from './components/TerminalView';
import { RdpView } from './components/RdpView';
import { VncView } from './components/VncView';
import { LocalTerminalView } from './components/LocalTerminalView';
import { SettingsModal } from './components/SettingsModal';
import { QuickConnectBar } from './components/QuickConnectBar';
import { GroupDialog } from './components/GroupDialog';
import { CredentialManagerModal } from './components/CredentialManagerModal';
import { BroadcastBar } from './components/BroadcastBar';
import { motion, AnimatePresence } from 'framer-motion';

const PortScannerModal = lazy(() =>
  import('./components/PortScannerModal').then(module => ({ default: module.PortScannerModal }))
);
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then(module => ({ default: module.CommandPalette }))
);
const CommandLibraryModal = lazy(() =>
  import('./components/CommandLibraryModal').then(module => ({ default: module.CommandLibraryModal }))
);
const HealthDashboard = lazy(() =>
  import('./components/HealthDashboard').then(module => ({ default: module.HealthDashboard }))
);
const ProxmoxView = lazy(() =>
  import('./components/ProxmoxView').then(module => ({ default: module.ProxmoxView }))
);
const DockerView = lazy(() =>
  import('./components/DockerView').then(module => ({ default: module.DockerView }))
);
const FileManagerView = lazy(() =>
  import('./components/FileManagerView').then(module => ({ default: module.FileManagerView }))
);

function Toaster() {
  const toasts = useUIStore(state => state.toasts);
  const removeToast = useUIStore(state => state.removeToast);

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 20, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 20, scale: 0.9 }}
            className={`px-5 py-4 rounded-2xl shadow-2xl glass-card pointer-events-auto border-l-4 min-w-[300px] cursor-pointer
              ${toast.type === 'error' ? 'border-red-500 bg-red-500/10' : ''}
              ${toast.type === 'success' ? 'border-green-500 bg-green-500/10' : ''}
              ${toast.type === 'info' ? 'border-blue-500 bg-blue-500/10' : ''}
              ${toast.type === 'warning' ? 'border-orange-500 bg-orange-500/10' : ''}
            `}
            onClick={() => removeToast(toast.id)}
          >
            <p className="font-bold text-sm tracking-tight">{toast.title}</p>
            {toast.description && <div className="text-xs mt-1.5 text-text-muted leading-relaxed">{toast.description}</div>}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function MainLayout() {
  useGlobalDataInitializer(); // Robust global data fetching

  const tabs = useTabStore(s => s.tabs);
  const activeTabId = useTabStore(s => s.activeTabId);
  const isBroadcastMode = useTabStore(s => s.isBroadcastMode);
  const setBroadcastMode = useTabStore(s => s.setBroadcastMode);
  const addTab = useTabStore(s => s.addTab);
  const setActiveTabId = useTabStore(s => s.setActiveTabId);

  const setVaultUnlocked = useUIStore(s => s.setVaultUnlocked);
  const addToast = useUIStore(s => s.addToast);
  const isFullscreen = useUIStore(s => s.isFullscreen);
  const theme = useUIStore(s => s.theme);

  const showConnectionDialog = useUIStore(s => s.showConnectionDialog);
  const showSettingsDialog = useUIStore(s => s.showSettingsDialog);
  const showPortScanner = useUIStore(s => s.showPortScanner);
  const showGroupDialog = useUIStore(s => s.showGroupDialog);
  
  const setShowConnectionDialog = useUIStore(s => s.setShowConnectionDialog);
  const setShowSettingsDialog = useUIStore(s => s.setShowSettingsDialog);
  const setShowPortScanner = useUIStore(s => s.setShowPortScanner);
  const setShowGroupDialog = useUIStore(s => s.setShowGroupDialog);
  const setShowCredentialManager = useUIStore(s => s.setShowCredentialManager);

  const editingConnection = useConnectionStore(s => s.editingConnection);
  const editingGroup = useConnectionStore(s => s.editingGroup);

  useEffect(() => {

    const handleContext = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', handleContext);

    return () => document.removeEventListener('contextmenu', handleContext);
  }, []);

  const handleLock = async () => {
    await api.lockVault();
    setVaultUnlocked(false);
    addToast({ type: 'info', title: 'Vault locked', description: 'Your session has been securely closed.' });
  };

  return (
    <div className={`flex h-screen bg-base text-text-primary overflow-hidden font-sans theme-${theme}`}>
      <div className={`${isFullscreen ? 'hidden' : 'flex'}`}>
        <ServerSidebar />
      </div>

      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        <div className={`flex h-12 border-b border-border bg-surface/30 backdrop-blur-md justify-between items-center px-2 ${isFullscreen ? 'hidden' : ''}`}>
          <div className="flex-1 overflow-hidden h-full flex items-center">
            {tabs.length > 0 && <ConnectionTabs />}
          </div>

          <div className="flex items-center px-2 flex-shrink-0 gap-1">
            <button
              onClick={() => setShowPortScanner(true)}
              className="btn-icon"
              title="Network Scanner"
            >
              <Globe className="w-4 h-4" />
            </button>
            <button
              onClick={() => setBroadcastMode(!isBroadcastMode)}
              className={`btn-icon ${isBroadcastMode ? 'text-accent bg-accent/10' : ''}`}
              title="Toggle Broadcast Mode (Multi-Exec)"
            >
              <Terminal className="w-4 h-4 md:hidden" />
              <div className="hidden md:flex items-center gap-2">
                <Terminal className="w-4 h-4" />
                <span className="text-[10px] uppercase font-bold tracking-widest">Multi</span>
              </div>
            </button>
            <button
              onClick={() => {
                const id = `local-${Date.now()}`;
                addTab({
                  id,
                  connectionId: 'local',
                  connectionName: 'Terminal',
                  protocol: 'LOCAL',
                  status: 'connected',
                });
                setActiveTabId(id);
              }}
              className="btn-icon"
              title="Local Terminal"
            >
              <Terminal className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowCredentialManager(true)}
              className="btn-icon"
              title="Credential Profiles"
            >
              <KeyRound className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowSettingsDialog(true)}
              className="btn-icon"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={handleLock}
              className="btn-icon hover:text-red-400"
              title="Lock Vault"
            >
              <Shield className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!isFullscreen && <QuickConnectBar />}
        {!isFullscreen && <BroadcastBar />}

        <div className="flex-1 relative bg-base shadow-inner overflow-hidden">
          <AnimatePresence mode="wait">
            {tabs.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full relative"
              >
                <Suspense fallback={<div className="w-full h-full bg-base" />}>
                  <HealthDashboard />
                </Suspense>
              </motion.div>
            ) : (
              <div className="w-full h-full">
                {tabs.map(tab => (
                  <div key={tab.id} className={activeTabId === tab.id ? "w-full h-full" : "hidden"}>
                    {tab.protocol === 'SSH' ? (
                      <TerminalView tab={tab} isActive={activeTabId === tab.id} />
                    ) : tab.protocol === 'RDP' ? (
                      <RdpView tab={tab} isActive={activeTabId === tab.id} />
                    ) : tab.protocol === 'LOCAL' ? (
                      <LocalTerminalView tab={tab} isActive={activeTabId === tab.id} />
                    ) : tab.protocol === 'SFTP' || tab.protocol === 'FTP' ? (
                      <Suspense fallback={<div className="w-full h-full bg-base" />}>
                        <FileManagerView tab={tab} isActive={activeTabId === tab.id} />
                      </Suspense>
                    ) : tab.protocol === 'PROXMOX' ? (
                      <Suspense fallback={<div className="w-full h-full bg-base" />}>
                        <ProxmoxView connection={tab.connection!} />
                      </Suspense>
                    ) : tab.protocol === 'DOCKER' ? (
                      <Suspense fallback={<div className="w-full h-full bg-base" />}>
                        <DockerView connection={tab.connection!} />
                      </Suspense>
                    ) : (
                      <VncView tab={tab} isActive={activeTabId === tab.id} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </AnimatePresence>
        </div>
      </div >

      <AnimatePresence>
        {showConnectionDialog && (
          <ConnectionForm
            editConnection={editingConnection}
            onClose={() => {
              setShowConnectionDialog(false);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPortScanner && (
          <Suspense fallback={null}>
            <PortScannerModal onClose={() => setShowPortScanner(false)} />
          </Suspense>
        )}
      </AnimatePresence>

      <SettingsModal isOpen={showSettingsDialog} onClose={() => setShowSettingsDialog(false)} />

      <AnimatePresence>
        {showGroupDialog && (
          <GroupDialog
            editGroup={editingGroup}
            onClose={() => setShowGroupDialog(false)}
          />
        )}
      </AnimatePresence>

      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
      <Suspense fallback={null}>
        <CommandLibraryModal />
      </Suspense>
      <CredentialManagerModal />

      <Toaster />
    </div >
  );
}

export default function App() {
  const isVaultUnlocked = useUIStore(s => s.isVaultUnlocked);
  const setVaultUnlocked = useUIStore(s => s.setVaultUnlocked);
  const setFirstLaunch = useUIStore(s => s.setFirstLaunch);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.isVaultUnlocked()
      .then(status => {
        setFirstLaunch(status.first_run);
        setVaultUnlocked(status.unlocked);
      })
      .catch(console.error)
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="h-screen bg-base flex items-center justify-center">
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="text-accent font-black tracking-[0.3em] uppercase text-sm"
        >
          Nexus
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
