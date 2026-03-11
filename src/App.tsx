import { useEffect, useState } from 'react';
import { Settings, Shield, Globe, Terminal } from 'lucide-react';
import { useAppStore } from './store/useAppStore';
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
import { FileManagerView } from './components/FileManagerView';
import { SettingsModal } from './components/SettingsModal';
import { QuickConnectBar } from './components/QuickConnectBar';
import { PortScannerModal } from './components/PortScannerModal';
import { GroupDialog } from './components/GroupDialog';
import { CommandPalette } from './components/CommandPalette';
import { CommandLibraryModal } from './components/CommandLibraryModal';
import { BroadcastBar } from './components/BroadcastBar';
import { HealthDashboard } from './components/HealthDashboard';
import { ProxmoxView } from './components/ProxmoxView';
import { DockerView } from './components/DockerView';
import { motion, AnimatePresence } from 'framer-motion';

function Toaster() {
  const toasts = useAppStore(state => state.toasts);
  const removeToast = useAppStore(state => state.removeToast);

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
  const {
    tabs,
    activeTabId,
    fetchData,
    setVaultUnlocked,
    addToast,
    isBroadcastMode,
    setBroadcastMode,
    showConnectionDialog,
    showSettingsDialog,
    showPortScanner,
    showGroupDialog,
    setShowConnectionDialog,
    setShowSettingsDialog,
    setShowPortScanner,
    setShowGroupDialog,
    editingConnection,
    editingGroup,
    addTab,
    setActiveTabId,
    theme
  } = useAppStore();

  useEffect(() => {
    fetchData().catch(console.error);

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
      <ServerSidebar />

      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        <div className="flex h-12 border-b border-border bg-surface/30 backdrop-blur-md justify-between items-center px-2">
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

        <QuickConnectBar />
        <BroadcastBar />

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
                <HealthDashboard />
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
                      <FileManagerView tab={tab} isActive={activeTabId === tab.id} />
                    ) : tab.protocol === 'PROXMOX' ? (
                      <ProxmoxView connection={tab.connection!} />
                    ) : tab.protocol === 'DOCKER' ? (
                      <DockerView connection={tab.connection!} />
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
          <PortScannerModal onClose={() => setShowPortScanner(false)} />
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

      <CommandPalette />
      <CommandLibraryModal />

      <Toaster />
    </div >
  );
}

export default function App() {
  const { isVaultUnlocked, setVaultUnlocked, setFirstLaunch } = useAppStore();
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
