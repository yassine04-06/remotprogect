import { lazy, Suspense } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useUIStore } from '../../store';
import { useConnectionStore } from '../../store';
import { ConnectionForm } from '../ConnectionForm';
import { SettingsModal } from './SettingsModal';
import { GroupDialog } from './GroupDialog';
import { CredentialManagerModal } from './CredentialManagerModal';
import { ImportDialog } from './ImportDialog';

const PortScannerModal = lazy(() =>
    import('./PortScannerModal').then(m => ({ default: m.PortScannerModal }))
);
const CommandPalette = lazy(() =>
    import('../CommandPalette').then(m => ({ default: m.CommandPalette }))
);
const CommandLibraryModal = lazy(() =>
    import('./CommandLibraryModal').then(m => ({ default: m.CommandLibraryModal }))
);
const AuditLogModal = lazy(() =>
    import('./AuditLogModal').then(m => ({ default: m.AuditLogModal }))
);
const RecordingsView = lazy(() =>
    import('../ssh/RecordingsView').then(m => ({ default: m.RecordingsView }))
);
const TotpModal = lazy(() =>
    import('./TotpModal').then(m => ({ default: m.TotpModal }))
);

/**
 * All application-level modals, dialogs, and overlays.
 * Extracted from App.tsx (MED-4 refactor).
 */
export function AppModals() {
    const showConnectionDialog  = useUIStore(s => s.showConnectionDialog);
    const showSettingsDialog    = useUIStore(s => s.showSettingsDialog);
    const showPortScanner       = useUIStore(s => s.showPortScanner);
    const showGroupDialog       = useUIStore(s => s.showGroupDialog);
    const showAuditLog          = useUIStore(s => s.showAuditLog);
    const showRecordings        = useUIStore(s => s.showRecordings);
    const showTotpModal         = useUIStore(s => s.showTotpModal);

    const setShowConnectionDialog = useUIStore(s => s.setShowConnectionDialog);
    const setShowSettingsDialog   = useUIStore(s => s.setShowSettingsDialog);
    const setShowPortScanner      = useUIStore(s => s.setShowPortScanner);
    const setShowGroupDialog      = useUIStore(s => s.setShowGroupDialog);
    const setShowAuditLog         = useUIStore(s => s.setShowAuditLog);
    const setShowRecordings       = useUIStore(s => s.setShowRecordings);
    const setShowTotpModal        = useUIStore(s => s.setShowTotpModal);

    const editingConnection = useConnectionStore(s => s.editingConnection);
    const templateConnection = useConnectionStore(s => s.templateConnection);
    const setTemplateConnection = useConnectionStore(s => s.setTemplateConnection);
    const editingGroup      = useConnectionStore(s => s.editingGroup);

    return (
        <>
            <AnimatePresence>
                {showConnectionDialog && (
                    <ConnectionForm
                        editConnection={editingConnection}
                        templateFrom={templateConnection}
                        onClose={() => { setShowConnectionDialog(false); setTemplateConnection(null); }}
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

            <SettingsModal
                isOpen={showSettingsDialog}
                onClose={() => setShowSettingsDialog(false)}
            />

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

            <ImportDialog />

            <AnimatePresence>
                {showAuditLog && (
                    <Suspense fallback={null}>
                        <AuditLogModal onClose={() => setShowAuditLog(false)} />
                    </Suspense>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showRecordings && (
                    <Suspense fallback={null}>
                        <RecordingsView onClose={() => setShowRecordings(false)} />
                    </Suspense>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showTotpModal && (
                    <Suspense fallback={null}>
                        <TotpModal onClose={() => setShowTotpModal(false)} />
                    </Suspense>
                )}
            </AnimatePresence>
        </>
    );
}
