import React, { useEffect, useRef, useState } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useTabStore, useUIStore } from '../store';
import * as api from '../services/api';
import type { Tab, FileNode } from '../types';
import {
    Folder,
    File,
    Upload,
    Download,
    Trash,
    RefreshCw,
    ChevronRight,
    CornerLeftUp,
    Loader2,
    FolderPlus,
    FolderOpen,
    ArrowDown,
    ArrowUp,
    Wifi,
} from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';

interface TransferEntry {
    id: string;
    name: string;
    direction: 'upload' | 'download';
    transferred: number;
    total: number;
    percent: number;
    done: boolean;
}

interface FileManagerViewProps {
    tab: Tab;
    isActive: boolean;
}

/** Parsed payload from a CRIT-2 UNKNOWN_HOST_KEY error. */
interface UnknownHostKeyInfo {
    host: string;
    port: number;
    key_type: string;
    fingerprint: string;
    raw_key_b64: string;
}

/** Extract UnknownHostKeyInfo from an error string, or null if not that error. */
function parseUnknownHostKey(err: string): UnknownHostKeyInfo | null {
    const prefix = 'UNKNOWN_HOST_KEY:';
    if (!err.startsWith(prefix)) return null;
    try {
        return JSON.parse(err.slice(prefix.length)) as UnknownHostKeyInfo;
    } catch {
        return null;
    }
}

export function FileManagerView({ tab, isActive }: FileManagerViewProps) {
    const updateTabStatus = useTabStore(s => s.updateTabStatus);
    const addToast = useUIStore(s => s.addToast);

    const [currentPath, setCurrentPath] = useState('/');
    const [files, setFiles] = useState<FileNode[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    /** Set when an SFTP connection encounters an unknown host key — shows the trust dialog. */
    const [unknownHostKey, setUnknownHostKey] = useState<UnknownHostKeyInfo | null>(null);
    const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
    const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [transfers, setTransfers] = useState<Map<string, TransferEntry>>(new Map());
    const transferTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const isSftp = tab.protocol === 'SFTP';

    // Refs so the single drag-drop subscription always reads the latest values
    // without re-subscribing (which would leak listeners + duplicate uploads).
    const isActiveRef = useRef(isActive);
    isActiveRef.current = isActive;
    const currentPathRef = useRef(currentPath);
    currentPathRef.current = currentPath;

    // ── MED-A3: evict SFTP pool entry on unmount ───────────────
    // Closes the idle TCP socket promptly; without this the backend TTL sweep
    // would only fire every ~5 minutes.
    useEffect(() => {
        return () => {
            if (isSftp) {
                api.sftpDisconnect(tab.connectionId).catch(() => {});
            }
        };
    }, [isSftp, tab.connectionId]);

    // ── Transfer progress listener ─────────────────────────────

    useEffect(() => {
        const unlisten = listen<{
            transfer_id: string;
            transferred: number;
            total: number;
            percent: number;
            done: boolean;
        }>('transfer:progress', event => {
            const { transfer_id, transferred, total, percent, done } = event.payload;
            setTransfers(prev => {
                const next = new Map(prev);
                const existing = next.get(transfer_id);
                if (existing) {
                    next.set(transfer_id, { ...existing, transferred, total, percent, done });
                }
                return next;
            });
            if (done) {
                // Auto-remove after 2s
                const timer = setTimeout(() => {
                    setTransfers(prev => {
                        const next = new Map(prev);
                        next.delete(transfer_id);
                        return next;
                    });
                    transferTimers.current.delete(transfer_id);
                }, 2000);
                transferTimers.current.set(transfer_id, timer);
            }
        });
        const timers = transferTimers.current;
        return () => {
            unlisten.then(fn => fn());
            timers.forEach(t => clearTimeout(t));
        };
    }, []);

    // ── Data Fetching ──────────────────────────────────────────

    const loadFiles = async (path: string) => {
        setLoading(true);
        setErrorMsg(null);
        setUnknownHostKey(null);
        try {
            // CRIT-A4: backend resolves host/port/credentials from connectionId.
            let res;
            if (isSftp) {
                res = await api.sftpListDir(tab.connectionId, path);
            } else {
                res = await api.ftpListDir(tab.connectionId, path);
            }

            setFiles(res.files);
            setCurrentPath(res.current_path || '/');
            updateTabStatus(tab.id, 'connected');
        } catch (err) {
            const errStr = String(err);
            // CRIT-2: detect unknown host key and surface a trust dialog instead
            // of a raw error string.
            const hostKeyInfo = isSftp ? parseUnknownHostKey(errStr) : null;
            if (hostKeyInfo) {
                setUnknownHostKey(hostKeyInfo);
                updateTabStatus(tab.id, 'error');
            } else {
                setErrorMsg(errStr);
                updateTabStatus(tab.id, 'error');
                addToast({ type: 'error', title: 'File System Error', description: errStr });
            }
        } finally {
            setLoading(false);
        }
    };

    /** Trust the host key shown in the unknownHostKey dialog and retry. */
    const handleTrustHostKey = async () => {
        if (!unknownHostKey) return;
        try {
            await api.sshTrustHostKey(
                unknownHostKey.host,
                unknownHostKey.port,
                unknownHostKey.key_type,
                unknownHostKey.raw_key_b64,
            );
            setUnknownHostKey(null);
            loadFiles('/');
        } catch (e) {
            addToast({ type: 'error', title: 'Trust failed', description: String(e) });
        }
    };

    useEffect(() => {
        if (isActive && files.length === 0 && !errorMsg && !unknownHostKey && !loading) {
            loadFiles('/'); // Initial load
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive, tab.id]);

    // ── Navigation ────────────────────────────────────────────

    const handleNavigate = (node: FileNode) => {
        if (node.is_dir) {
            loadFiles(node.path);
        }
    };

    const handleGoUp = () => {
        if (currentPath === '/' || currentPath === '') return;
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop();
        const newPath = '/' + parts.join('/');
        loadFiles(newPath);
    };

    // ── Actions ───────────────────────────────────────────────

    const mkTransferId = () => `tf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const registerTransfer = (id: string, name: string, direction: 'upload' | 'download') => {
        setTransfers(prev => {
            const next = new Map(prev);
            next.set(id, { id, name, direction, transferred: 0, total: 0, percent: 0, done: false });
            return next;
        });
    };

    const uploadSingleFile = async (localFile: string) => {
        setLoading(true);
        const fileName = localFile.split(/[/\\]/).pop() ?? localFile;
        const transferId = mkTransferId();
        registerTransfer(transferId, fileName, 'upload');
        try {
            const remotePath = `${currentPath === '/' ? '' : currentPath}/${fileName}`;
            // CRIT-A4: backend resolves credentials from connectionId.
            if (isSftp) {
                await api.sftpUpload(tab.connectionId, remotePath, localFile, transferId);
            } else {
                await api.ftpUpload(tab.connectionId, remotePath, localFile, transferId);
            }
            addToast({ type: 'success', title: 'Upload Complete', description: fileName });
        } catch (err) {
            addToast({ type: 'error', title: 'Upload Failed', description: String(err) });
            setTransfers(prev => {
                const next = new Map(prev);
                next.delete(transferId);
                return next;
            });
        } finally {
            setLoading(false);
        }
    };

    // ── Drag & Drop (OS level) ──────────────────────────────

    useEffect(() => {
        if (!isActive) return;

        // Tauri v2: the legacy `tauri://file-drop` events were renamed. Use the
        // unified webview API which delivers 'enter'|'over'|'drop'|'leave' in one
        // callback. Subscribe ONCE (deps []) and read live state via refs so we
        // never re-subscribe (re-subscribing leaked listeners and caused one drop
        // to trigger N duplicate uploads).
        let cancelled = false;
        let unlisten: UnlistenFn | undefined;

        getCurrentWebview()
            .onDragDropEvent(async event => {
                const t = event.payload.type;
                if (t === 'enter' || t === 'over') {
                    if (isActiveRef.current) setIsDraggingOver(true);
                } else if (t === 'leave') {
                    setIsDraggingOver(false);
                } else if (t === 'drop') {
                    setIsDraggingOver(false);
                    const paths = event.payload.paths ?? [];
                    if (!isActiveRef.current || paths.length === 0) return;
                    for (const localPath of paths) {
                        await uploadSingleFile(localPath);
                    }
                    loadFiles(currentPathRef.current);
                }
            })
            .then(fn => {
                if (cancelled) fn();
                else unlisten = fn;
            })
            .catch(() => {});

        return () => {
            cancelled = true;
            unlisten?.();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab.id]);

    const handleUpload = async () => {
        try {
            const localFile = await open({
                multiple: false,
                title: 'Select File to Upload',
            });
            if (!localFile) return;

            await uploadSingleFile(localFile as string);
            loadFiles(currentPath);
        } catch (err) {
            // Error handling is inside uploadSingleFile but if dialog fails catch here
            addToast({ type: 'error', title: 'Upload Dialog Error', description: String(err) });
        }
    };
    const handleDownload = async () => {
        if (!selectedFile || selectedFile.is_dir) return;
        setMenuPosition(null);

        const transferId = mkTransferId();
        registerTransfer(transferId, selectedFile.name, 'download');
        try {
            const localDest = await save({
                title: 'Save Download As...',
                defaultPath: selectedFile.name,
            });
            if (!localDest) {
                setTransfers(prev => { const next = new Map(prev); next.delete(transferId); return next; });
                return;
            }

            setLoading(true);
            // CRIT-A4: backend resolves credentials from connectionId.
            if (isSftp) {
                await api.sftpDownload(tab.connectionId, selectedFile.path, localDest, transferId);
            } else {
                await api.ftpDownload(tab.connectionId, selectedFile.path, localDest, transferId);
            }
            addToast({
                type: 'success',
                title: 'Download Complete',
                description: selectedFile.name,
            });
        } catch (err) {
            addToast({ type: 'error', title: 'Download Failed', description: String(err) });
            setTransfers(prev => { const next = new Map(prev); next.delete(transferId); return next; });
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedFile) return;
        setMenuPosition(null);

        const ok = await confirm(`Delete "${selectedFile.name}"?`, { title: 'Confirm Delete', kind: 'warning' });
        if (!ok) return;

        try {
            setLoading(true);
            // CRIT-A4: backend resolves credentials from connectionId.
            if (isSftp) {
                await api.sftpDelete(tab.connectionId, selectedFile.path, selectedFile.is_dir);
            } else {
                await api.ftpDelete(tab.connectionId, selectedFile.path, selectedFile.is_dir);
            }

            addToast({ type: 'success', title: 'Deleted', description: selectedFile.name });
            loadFiles(currentPath);
        } catch (err) {
            addToast({ type: 'error', title: 'Delete Failed', description: String(err) });
        } finally {
            setLoading(false);
        }
    };

    const handleCreateDirectory = async () => {
        const name = prompt('Enter new folder name:');
        if (!name) return;

        try {
            setLoading(true);
            const remotePath = `${currentPath === '/' ? '' : currentPath}/${name}`;
            // CRIT-A4: backend resolves credentials from connectionId.
            if (isSftp) {
                await api.sftpMkdir(tab.connectionId, remotePath);
            } else {
                await api.ftpMkdir(tab.connectionId, remotePath);
            }

            addToast({ type: 'success', title: 'Folder Created', description: name });
            loadFiles(currentPath);
        } catch (err) {
            addToast({ type: 'error', title: 'Create Folder Failed', description: String(err) });
        } finally {
            setLoading(false);
        }
    };

    // ── Context Menu ──────────────────────────────────────────

    const handleRightClick = (e: React.MouseEvent, file: FileNode) => {
        e.preventDefault();
        e.stopPropagation();
        setSelectedFile(file);
        setMenuPosition({ x: e.clientX, y: e.clientY });
    };

    const handleGlobalClick = () => setMenuPosition(null);
    useEffect(() => {
        window.addEventListener('click', handleGlobalClick);
        return () => window.removeEventListener('click', handleGlobalClick);
    }, []);

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    return (
        <div className={`w-full h-full flex flex-col bg-surface ${isActive ? 'block' : 'hidden'}`}>
            {/* Toolbar */}
            <div className="flex-none p-4 border-b border-border bg-base/50 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <button
                        onClick={handleGoUp}
                        disabled={currentPath === '/' || loading}
                        className="p-2 text-text-muted hover:text-text-primary hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
                        title="Up One Level"
                    >
                        <CornerLeftUp className="w-5 h-5" />
                    </button>
                    <button
                        onClick={() => loadFiles(currentPath)}
                        disabled={loading}
                        className="p-2 text-text-muted hover:text-text-primary hover:bg-white/5 rounded-lg transition-colors disabled:opacity-50"
                        title="Refresh"
                    >
                        {loading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <RefreshCw className="w-5 h-5" />
                        )}
                    </button>
                    <div className="h-6 w-px bg-border mx-2" />
                    <div className="flex items-center overflow-hidden bg-surface border border-border rounded-lg px-3 py-1.5 flex-1 shadow-inner">
                        <span className="text-sm font-mono text-text-primary truncate">
                            {currentPath}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleCreateDirectory}
                        disabled={loading}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-text-primary bg-base border border-border rounded-lg hover:border-accent/40 transition-colors disabled:opacity-50"
                    >
                        <FolderPlus className="w-4 h-4 text-emerald-400" />
                        <span>New Folder</span>
                    </button>
                    <button
                        onClick={handleUpload}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-1.5 text-sm font-bold text-white bg-accent rounded-lg shadow-lg hover:bg-accent/90 transition-colors disabled:opacity-50 shadow-accent/20"
                    >
                        <Upload className="w-4 h-4" />
                        <span>Upload</span>
                    </button>
                </div>
            </div>

            {/* File List */}
            <div
                className={`flex-1 overflow-auto custom-scrollbar relative p-2 ${isDraggingOver ? 'bg-accent/10 border-2 border-dashed border-accent m-2 rounded-lg' : ''}`}
            >
                {isDraggingOver && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-base/80 backdrop-blur-sm pointer-events-none rounded-lg">
                        <Upload className="w-16 h-16 text-accent mb-4 animate-bounce" />
                        <h3 className="text-xl font-bold text-white">Drop files to upload</h3>
                        <p className="text-text-muted mt-2 text-sm">Uploading to {currentPath}</p>
                    </div>
                )}

                {unknownHostKey ? (
                    /* CRIT-2: Unknown SFTP host key — require explicit user confirmation */
                    <div className="absolute inset-0 flex items-center justify-center p-8 bg-base/90 backdrop-blur-sm z-10">
                        <div className="bg-surface border border-yellow-500/30 p-6 rounded-2xl max-w-lg w-full shadow-2xl">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2 rounded-xl bg-yellow-500/10">
                                    <Wifi className="w-6 h-6 text-yellow-400" />
                                </div>
                                <h3 className="text-yellow-400 font-bold text-lg">
                                    Unknown Host Key
                                </h3>
                            </div>
                            <p className="text-text-muted text-sm mb-3">
                                The authenticity of host{' '}
                                <span className="font-mono text-accent">
                                    {unknownHostKey.host}:{unknownHostKey.port}
                                </span>{' '}
                                can't be established. This is the first time you've connected.
                            </p>
                            <div className="bg-black/30 rounded-lg p-3 mb-4 font-mono text-xs text-text-muted break-all">
                                <span className="text-text-secondary">{unknownHostKey.key_type}</span>{' '}
                                {unknownHostKey.fingerprint}
                            </div>
                            <p className="text-yellow-300/70 text-xs mb-5">
                                ⚠ Only trust this key if you have verified the fingerprint with the server administrator.
                                Trusting an unknown key risks a man-in-the-middle attack.
                            </p>
                            <div className="flex gap-3">
                                <button
                                    onClick={handleTrustHostKey}
                                    className="flex-1 px-4 py-2 bg-yellow-500/20 text-yellow-300 font-bold rounded-lg hover:bg-yellow-500/30 transition-colors"
                                >
                                    Trust &amp; Connect
                                </button>
                                <button
                                    onClick={() => { setUnknownHostKey(null); updateTabStatus(tab.id, 'error'); }}
                                    className="flex-1 px-4 py-2 bg-surface border border-border text-text-primary rounded-lg hover:bg-white/5 transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                ) : errorMsg ? (
                    <div className="absolute inset-0 flex items-center justify-center p-8">
                        <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-2xl max-w-md text-center">
                            <Trash className="w-10 h-10 text-red-400 mx-auto mb-3" />
                            <h3 className="text-red-400 font-bold mb-2 uppercase tracking-wide">
                                Connection Error
                            </h3>
                            <p className="text-red-300/80 text-sm whitespace-pre-wrap">
                                {errorMsg}
                            </p>
                            <button
                                onClick={() => loadFiles(currentPath)}
                                className="mt-4 px-6 py-2 bg-red-500/20 text-red-300 font-bold rounded-lg hover:bg-red-500/30 transition-colors"
                            >
                                Retry Connection
                            </button>
                        </div>
                    </div>
                ) : files.length === 0 && !loading ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center text-text-muted">
                            <FolderOpen className="w-16 h-16 mx-auto mb-4 opacity-50" />
                            <p className="text-sm">Folder is empty</p>
                        </div>
                    </div>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-border/50 text-xs text-text-muted uppercase font-bold tracking-wider">
                                <th className="py-3 px-4 w-10"></th>
                                <th className="py-3 px-4">Name</th>
                                <th className="py-3 px-4 w-32">Size</th>
                            </tr>
                        </thead>
                        <tbody>
                            {files.map(file => (
                                <tr
                                    key={file.path}
                                    onDoubleClick={() => handleNavigate(file)}
                                    onContextMenu={e => handleRightClick(e, file)}
                                    className="group hover:bg-white/5 border-b border-border/20 transition-colors cursor-pointer"
                                >
                                    <td className="py-3 px-4 text-center">
                                        {file.is_dir ? (
                                            <Folder className="w-5 h-5 text-blue-400 fill-blue-400/20 mx-auto" />
                                        ) : (
                                            <File className="w-5 h-5 text-slate-400 mx-auto" />
                                        )}
                                    </td>
                                    <td className="py-3 px-4 text-sm font-medium text-text-primary relative">
                                        {file.name}
                                        {file.is_dir && (
                                            <ChevronRight className="w-4 h-4 text-text-muted absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        )}
                                    </td>
                                    <td className="py-3 px-4 text-xs font-mono text-text-muted opacity-80">
                                        {file.is_dir ? '--' : formatSize(file.size)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Transfer Progress Panel */}
            {transfers.size > 0 && (
                <div className="flex-none border-t border-border bg-base/80 px-4 py-2 flex flex-col gap-1.5 max-h-40 overflow-y-auto">
                    {[...transfers.values()].map(t => (
                        <div key={t.id} className="flex items-center gap-3 text-xs">
                            {t.direction === 'upload' ? (
                                <ArrowUp className="w-3.5 h-3.5 text-blue-400 flex-none" />
                            ) : (
                                <ArrowDown className="w-3.5 h-3.5 text-emerald-400 flex-none" />
                            )}
                            <span className="truncate max-w-[160px] text-text-muted">{t.name}</span>
                            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-200 ${t.done ? 'bg-emerald-500' : t.direction === 'upload' ? 'bg-blue-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${t.total > 0 ? t.percent : 100}%`, opacity: t.total > 0 ? 1 : 0.4 }}
                                />
                            </div>
                            <span className="font-mono text-text-muted w-9 text-right flex-none">
                                {t.done ? '✓' : t.total > 0 ? `${t.percent}%` : '…'}
                            </span>
                            {t.total > 0 && (
                                <span className="font-mono text-text-muted/60 w-20 text-right flex-none">
                                    {formatSize(t.transferred)}/{formatSize(t.total)}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Context Menu */}
            {menuPosition && selectedFile && (
                <div
                    className="fixed z-[999] bg-[#1e1e2e] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[160px]"
                    style={{ top: menuPosition.y, left: menuPosition.x }}
                    onClick={e => e.stopPropagation()}
                >
                    {!selectedFile.is_dir && (
                        <button
                            onClick={handleDownload}
                            className="w-full text-left px-4 py-2 text-xs text-white hover:bg-accent transition-colors flex items-center gap-2"
                        >
                            <Download className="w-4 h-4" /> Download
                        </button>
                    )}
                    {/* Add Rename here if needed */}

                    <div className="h-px bg-white/5 my-1" />

                    <button
                        onClick={handleDelete}
                        className="w-full text-left px-4 py-2 text-xs text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-2"
                    >
                        <Trash className="w-4 h-4" /> Delete
                    </button>
                </div>
            )}
        </div>
    );
}
