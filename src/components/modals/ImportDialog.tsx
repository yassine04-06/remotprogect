import { useState, useCallback } from 'react';
import { X, Download, Monitor, Server, FileText, RefreshCw, AlertTriangle, Check, ChevronRight, Terminal, Database } from 'lucide-react';
import { useUIStore, useConnectionStore } from '../../store';
import {
    pickImportFile,
    importRdpFile,
    importPuttySessions,
    importMremoteng,
    importSshConfig,
    importRdm,
    importRoyalts,
    importNexorcJson,
    bulkImportConnections,
} from '../../services/api/import';
import type { ImportedConnection } from '../../types/generated';

// ── Protocol badge styles ─────────────────────────────────────────────────────

const PROTO_STYLE: Record<string, string> = {
    SSH:  'bg-green-500/15 text-green-400 border-green-500/30',
    RDP:  'bg-blue-500/15 text-blue-400 border-blue-500/30',
    VNC:  'bg-purple-500/15 text-purple-400 border-purple-500/30',
    SFTP: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    FTP:  'bg-orange-500/15 text-orange-400 border-orange-500/30',
};

type TabId = 'putty' | 'rdp' | 'mremoteng' | 'ssh_config' | 'rdm' | 'royalts' | 'nexorc';

interface TabDef {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    description: string;
}

const TABS: TabDef[] = [
    {
        id: 'putty',
        label: 'PuTTY',
        icon: <Server className="w-4 h-4" />,
        description: 'Import sessions from the Windows registry',
    },
    {
        id: 'rdp',
        label: '.rdp File',
        icon: <Monitor className="w-4 h-4" />,
        description: 'Import from a Windows Remote Desktop file',
    },
    {
        id: 'mremoteng',
        label: 'mRemoteNG',
        icon: <FileText className="w-4 h-4" />,
        description: 'Import from confCons.xml (supports AES-GCM encryption)',
    },
    {
        id: 'ssh_config',
        label: 'SSH Config',
        icon: <Terminal className="w-4 h-4" />,
        description: 'Import Host entries from ~/.ssh/config (or a custom file)',
    },
    {
        id: 'rdm',
        label: 'RDM',
        icon: <Database className="w-4 h-4" />,
        description: 'Import from a Devolutions Remote Desktop Manager XML export (.rdm)',
    },
    {
        id: 'royalts',
        label: 'RoyalTS',
        icon: <Database className="w-4 h-4" />,
        description: 'Import from a RoyalTS export (.rtsx plain XML or .rtsz ZIP archive)',
    },
    {
        id: 'nexorc',
        label: 'NexoRC',
        icon: <Server className="w-4 h-4" />,
        description: 'Merge connections from another NexoRC vault JSON export (passwords not transferred)',
    },
];

// ── Connection preview table ──────────────────────────────────────────────────

function ConnectionRow({
    conn,
    index,
    selected,
    onToggle,
}: {
    conn: ImportedConnection;
    index: number;
    selected: boolean;
    onToggle: (i: number) => void;
}) {
    return (
        <tr
            className={`border-b border-border/40 hover:bg-white/[0.03] transition-colors cursor-pointer ${selected ? 'bg-accent/5' : ''}`}
            onClick={() => onToggle(index)}
        >
            <td className="px-3 py-2.5">
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selected ? 'bg-accent border-accent' : 'border-border'}`}>
                    {selected && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
            </td>
            <td className="px-3 py-2.5 font-medium text-text-primary text-sm max-w-[180px] truncate">
                {conn.name || '—'}
            </td>
            <td className="px-3 py-2.5">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${PROTO_STYLE[conn.protocol] ?? 'bg-white/5 text-text-muted border-border'}`}>
                    {conn.protocol}
                </span>
            </td>
            <td className="px-3 py-2.5 font-mono text-xs text-text-muted max-w-[160px] truncate">
                {conn.host}:{conn.port}
            </td>
            <td className="px-3 py-2.5 text-xs text-text-muted max-w-[120px] truncate">
                {conn.username || '—'}
            </td>
            <td className="px-3 py-2.5 text-xs text-text-muted max-w-[120px] truncate">
                {conn.group_path || '—'}
            </td>
            <td className="px-3 py-2.5">
                {conn.warning && (
                    <span title={conn.warning} className="text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5" />
                    </span>
                )}
            </td>
        </tr>
    );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export function ImportDialog() {
    const showImportDialog = useUIStore(s => s.showImportDialog);
    const setShowImportDialog = useUIStore(s => s.setShowImportDialog);
    const fetchConnections = useConnectionStore(s => s.fetchConnections);
    const addToast = useUIStore(s => s.addToast);

    const [tab, setTab] = useState<TabId>('putty');
    const [connections, setConnections] = useState<ImportedConnection[]>([]);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [mremotengPassword, setMremotengPassword] = useState('mR3m');

    const handleClose = useCallback(() => {
        setShowImportDialog(false);
        // Reset state for next open
        setConnections([]);
        setSelected(new Set());
        setError(null);
        setLoading(false);
    }, [setShowImportDialog]);

    const handleTabChange = (newTab: TabId) => {
        setTab(newTab);
        setConnections([]);
        setSelected(new Set());
        setError(null);
    };

    const loadConnList = (list: ImportedConnection[]) => {
        setConnections(list);
        setSelected(new Set(list.map((_, i) => i)));
        setError(null);
    };

    // ── PuTTY scan ──────────────────────────────────────────────────────
    const handleScanPutty = async () => {
        setLoading(true);
        setError(null);
        try {
            const list = await importPuttySessions();
            if (list.length === 0) {
                setError('No PuTTY SSH sessions found in the registry.');
            } else {
                loadConnList(list);
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    // ── RDP file browse ─────────────────────────────────────────────────
    const handleBrowseRdp = async () => {
        const path = await pickImportFile('RDP Files', ['rdp']).catch(() => null);
        if (!path) return;
        setLoading(true);
        setError(null);
        try {
            const list = await importRdpFile(path);
            loadConnList(list);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    // ── SSH config ──────────────────────────────────────────────────────
    const handleScanSshConfig = async () => {
        setLoading(true);
        setError(null);
        try {
            const list = await importSshConfig();
            if (list.length === 0) {
                setError('No host entries found in ~/.ssh/config.');
            } else {
                loadConnList(list);
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    const handleBrowseSshConfig = async () => {
        const path = await pickImportFile('SSH Config', ['config', '*']).catch(() => null);
        if (!path) return;
        setLoading(true);
        setError(null);
        try {
            const list = await importSshConfig(path);
            if (list.length === 0) {
                setError('No host entries found in the selected file.');
            } else {
                loadConnList(list);
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    // ── mRemoteNG file browse ───────────────────────────────────────────
    const handleBrowseMremoteng = async () => {
        const path = await pickImportFile('mRemoteNG XML', ['xml']).catch(() => null);
        if (!path) return;
        setLoading(true);
        setError(null);
        try {
            const list = await importMremoteng(path, mremotengPassword || 'mR3m');
            if (list.length === 0) {
                setError('No importable connections found (SSH, RDP, VNC, SFTP, FTP only).');
            } else {
                loadConnList(list);
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    // ── RDM file browse ─────────────────────────────────────────────────
    const handleBrowseRdm = async () => {
        const path = await pickImportFile('RDM Export', ['rdm', 'xml']).catch(() => null);
        if (!path) return;
        setLoading(true);
        setError(null);
        try {
            const list = await importRdm(path);
            if (list.length === 0) {
                setError('No importable connections found (RDP, SSH, VNC, SFTP, FTP only).');
            } else {
                loadConnList(list);
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    // ── NexoRC vault JSON ───────────────────────────────────────────────────
    const handleBrowseNexorc = async () => {
        const path = await pickImportFile('NexoRC Vault', ['json']).catch(() => null);
        if (!path) return;
        setLoading(true);
        setError(null);
        try {
            const list = await importNexorcJson(path);
            if (list.length === 0) {
                setError('No connections found in the NexoRC vault file.');
            } else {
                loadConnList(list);
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    // ── RoyalTS file browse ─────────────────────────────────────────────
    const handleBrowseRoyalts = async () => {
        const path = await pickImportFile('RoyalTS Export', ['rtsx', 'rtsz']).catch(() => null);
        if (!path) return;
        setLoading(true);
        setError(null);
        try {
            const list = await importRoyalts(path);
            if (list.length === 0) {
                setError('No importable connections found (RDP, SSH, VNC, SFTP, FTP only).');
            } else {
                loadConnList(list);
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    // ── Toggle selection ────────────────────────────────────────────────
    const toggleSelect = (i: number) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i); else next.add(i);
            return next;
        });
    };

    const toggleAll = () => {
        if (selected.size === connections.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(connections.map((_, i) => i)));
        }
    };

    // ── Bulk import ─────────────────────────────────────────────────────
    const handleImport = async () => {
        const toImport = connections.filter((_, i) => selected.has(i));
        if (toImport.length === 0) return;

        setLoading(true);
        setError(null);
        try {
            const count = await bulkImportConnections(toImport);
            await fetchConnections(true); // force — bypass loaded guard
            addToast({
                type: 'success',
                title: 'Import complete',
                description: `${count} connection${count !== 1 ? 's' : ''} imported successfully.`,
            });
            handleClose();
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    if (!showImportDialog) return null;

    const selectedCount = selected.size;
    const allSelected = connections.length > 0 && selected.size === connections.length;
    const warningCount = connections.filter(c => c.warning).length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent/25 to-accent-secondary/10 ring-1 ring-accent/20 flex items-center justify-center">
                            <Download className="w-5 h-5 text-accent" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-text-primary">Import Connections</h2>
                            <p className="text-xs text-text-muted mt-0.5">
                                PuTTY · .rdp · mRemoteNG · SSH config · RDM · RoyalTS · NexoRC
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Tab bar — horizontally scrollable, single line */}
                <div className="flex gap-1.5 px-6 pt-4 flex-shrink-0 overflow-x-auto custom-scrollbar">
                    {TABS.map(t => (
                        <button
                            key={t.id}
                            onClick={() => handleTabChange(t.id)}
                            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium shrink-0 whitespace-nowrap border transition-all ${
                                tab === t.id
                                    ? 'bg-accent text-white border-accent shadow-[0_4px_14px_-4px_var(--color-accent)]'
                                    : 'text-text-muted border-transparent hover:text-text-primary hover:bg-white/5'
                            }`}
                        >
                            {t.icon}
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* Tab content */}
                <div className="px-6 pt-4 pb-2 flex-shrink-0">
                    <p className="text-xs text-text-muted mb-3">
                        {TABS.find(t => t.id === tab)?.description}
                    </p>

                    {/* PuTTY */}
                    {tab === 'putty' && (
                        <button
                            onClick={handleScanPutty}
                            disabled={loading}
                            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                            Scan Registry
                        </button>
                    )}

                    {/* RDP file */}
                    {tab === 'rdp' && (
                        <button
                            onClick={handleBrowseRdp}
                            disabled={loading}
                            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                        >
                            <ChevronRight className="w-4 h-4" />
                            Browse .rdp file&hellip;
                        </button>
                    )}

                    {/* mRemoteNG */}
                    {tab === 'mremoteng' && (
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 flex-1 max-w-xs">
                                <label className="text-xs text-text-muted whitespace-nowrap">Master password</label>
                                <input
                                    type="password"
                                    value={mremotengPassword}
                                    onChange={e => setMremotengPassword(e.target.value)}
                                    placeholder="mR3m (default)"
                                    className="flex-1 px-3 py-1.5 bg-base border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                                />
                            </div>
                            <button
                                onClick={handleBrowseMremoteng}
                                disabled={loading}
                                className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                            >
                                <ChevronRight className="w-4 h-4" />
                                Browse confCons.xml&hellip;
                            </button>
                        </div>
                    )}

                    {/* SSH Config */}
                    {tab === 'ssh_config' && (
                        <div className="flex items-center gap-3 flex-wrap">
                            <button
                                onClick={handleScanSshConfig}
                                disabled={loading}
                                className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                            >
                                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                                Load ~/.ssh/config
                            </button>
                            <button
                                onClick={handleBrowseSshConfig}
                                disabled={loading}
                                className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium text-text-primary hover:bg-white/5 transition-colors disabled:opacity-50"
                            >
                                <ChevronRight className="w-4 h-4" />
                                Browse custom file&hellip;
                            </button>
                        </div>
                    )}

                    {/* RDM */}
                    {tab === 'rdm' && (
                        <button
                            onClick={handleBrowseRdm}
                            disabled={loading}
                            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                        >
                            <ChevronRight className="w-4 h-4" />
                            Browse .rdm file&hellip;
                        </button>
                    )}

                    {/* RoyalTS */}
                    {tab === 'royalts' && (
                        <button
                            onClick={handleBrowseRoyalts}
                            disabled={loading}
                            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                        >
                            <ChevronRight className="w-4 h-4" />
                            Browse .rtsx / .rtsz file&hellip;
                        </button>
                    )}

                    {/* NexoRC */}
                    {tab === 'nexorc' && (
                        <button
                            onClick={handleBrowseNexorc}
                            disabled={loading}
                            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
                        >
                            <ChevronRight className="w-4 h-4" />
                            Browse NexoRC vault JSON&hellip;
                        </button>
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div className="mx-6 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs flex items-start gap-2 flex-shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        {error}
                    </div>
                )}

                {/* Warning count */}
                {warningCount > 0 && (
                    <div className="mx-6 mb-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-xs flex items-start gap-2 flex-shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        {warningCount} connection{warningCount !== 1 ? 's' : ''} had issues (e.g. password not decrypted). They will be imported without passwords.
                    </div>
                )}

                {/* Preview table */}
                {connections.length > 0 && (
                    <div className="mx-6 mb-2 border border-border rounded-xl overflow-hidden flex-1 min-h-0 flex flex-col">
                        <div className="px-3 py-2 bg-black/20 border-b border-border flex items-center justify-between flex-shrink-0">
                            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                                {connections.length} connection{connections.length !== 1 ? 's' : ''} found
                            </span>
                            <button
                                onClick={toggleAll}
                                className="text-xs text-accent hover:text-accent/80 transition-colors"
                            >
                                {allSelected ? 'Deselect all' : 'Select all'}
                            </button>
                        </div>
                        <div className="overflow-y-auto flex-1">
                            <table className="w-full">
                                <thead className="sticky top-0 bg-surface/95 border-b border-border/60">
                                    <tr className="text-left text-[10px] font-bold text-text-muted uppercase tracking-wider">
                                        <th className="px-3 py-2 w-8"></th>
                                        <th className="px-3 py-2">Name</th>
                                        <th className="px-3 py-2">Protocol</th>
                                        <th className="px-3 py-2">Host:Port</th>
                                        <th className="px-3 py-2">User</th>
                                        <th className="px-3 py-2">Group</th>
                                        <th className="px-3 py-2 w-8"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {connections.map((conn, i) => (
                                        <ConnectionRow
                                            key={i}
                                            conn={conn}
                                            index={i}
                                            selected={selected.has(i)}
                                            onToggle={toggleSelect}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-border flex-shrink-0 mt-auto">
                    <p className="text-xs text-text-muted">
                        {selectedCount > 0
                            ? `${selectedCount} of ${connections.length} selected`
                            : connections.length > 0
                            ? 'Select connections to import'
                            : 'No connections loaded yet'}
                    </p>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleClose}
                            className="px-4 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleImport}
                            disabled={selectedCount === 0 || loading}
                            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                            Import{selectedCount > 0 ? ` (${selectedCount})` : ''}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
