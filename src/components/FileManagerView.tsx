import React, { useEffect, useState } from 'react';
import { useConnectionStore, useTabStore, useUIStore } from '../store';
import * as api from '../services/api';
import type { Tab, FileNode } from '../types';
import { Folder, File, Upload, Download, Trash, RefreshCw, ChevronRight, CornerLeftUp, Loader2, FolderPlus, FolderOpen } from 'lucide-react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

interface FileManagerViewProps {
    tab: Tab;
    isActive: boolean;
}

export function FileManagerView({ tab, isActive }: FileManagerViewProps) {
    const connections = useConnectionStore(s => s.connections);
    const updateTabStatus = useTabStore(s => s.updateTabStatus);
    const addToast = useUIStore(s => s.addToast);

    const [currentPath, setCurrentPath] = useState('/');
    const [files, setFiles] = useState<FileNode[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [menuPosition, setMenuPosition] = useState<{ x: number, y: number } | null>(null);
    const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
    const [isDraggingOver, setIsDraggingOver] = useState(false);

    const isSftp = tab.protocol === 'SFTP';

    // ── Data Fetching ──────────────────────────────────────────

    const loadFiles = async (path: string) => {
        setLoading(true);
        setErrorMsg(null);
        try {
            const conn = connections.find(c => c.id === tab.connectionId);
            if (!conn) throw new Error("Connection not found");

            const creds = await api.resolveCredentials(conn.id);
            const username = creds.username || conn.username;

            let res;
            if (isSftp) {
                res = await api.sftpListDir(conn.host, conn.port, username, creds.password_decrypted || null, creds.private_key_decrypted || null, path);
            } else {
                res = await api.ftpListDir(conn.host, conn.port, username, creds.password_decrypted || null, path);
            }

            setFiles(res.files);
            setCurrentPath(res.current_path || '/');
            updateTabStatus(tab.id, 'connected');
        } catch (err) {
            setErrorMsg(String(err));
            updateTabStatus(tab.id, 'error');
            addToast({ type: 'error', title: 'File System Error', description: String(err) });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isActive && files.length === 0 && !errorMsg && !loading) {
            loadFiles('/'); // Initial load
        }
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

    // ── Drag & Drop (OS level) ──────────────────────────────

    useEffect(() => {
        if (!isActive) return;

        let unlistenDrop: UnlistenFn;
        let unlistenEnter: UnlistenFn;
        let unlistenLeave: UnlistenFn;

        const setupDragDrop = async () => {
            unlistenDrop = await listen<{ paths: string[] }>('tauri://file-drop', async (event) => {
                setIsDraggingOver(false);
                if (!isActive || !event.payload.paths || event.payload.paths.length === 0) return;

                // Process each dropped file
                const paths = event.payload.paths;
                for (const localPath of paths) {
                    await uploadSingleFile(localPath);
                }
                loadFiles(currentPath);
            });

            unlistenEnter = await listen('tauri://file-drop-hover', () => {
                if (isActive) setIsDraggingOver(true);
            });

            unlistenLeave = await listen('tauri://file-drop-cancelled', () => {
                setIsDraggingOver(false);
            });
        };

        setupDragDrop();

        return () => {
            if (unlistenDrop) unlistenDrop();
            if (unlistenEnter) unlistenEnter();
            if (unlistenLeave) unlistenLeave();
        };
    }, [isActive, currentPath, connections, tab.id]);

    // ── Actions ───────────────────────────────────────────────

    const uploadSingleFile = async (localFile: string) => {
        setLoading(true);
        try {
            const conn = connections.find(c => c.id === tab.connectionId);
            if (!conn) throw new Error("Connection not found");

            const creds = await api.resolveCredentials(conn.id);
            const username = creds.username || conn.username;

            // Extract filename from local path (naive cross-platform split)
            const fileName = localFile.split(/[/\\]/).pop();
            const remotePath = `${currentPath === '/' ? '' : currentPath}/${fileName}`;

            addToast({ type: 'info', title: 'Upload Started', description: `Uploading ${fileName}...` });

            if (isSftp) {
                await api.sftpUpload(conn.host, conn.port, username, creds.password_decrypted || null, creds.private_key_decrypted || null, remotePath, localFile);
            } else {
                await api.ftpUpload(conn.host, conn.port, username, creds.password_decrypted || null, remotePath, localFile);
            }
            addToast({ type: 'success', title: 'Upload Complete', description: fileName! });
        } catch (err) {
            addToast({ type: 'error', title: 'Upload Failed', description: String(err) });
        } finally {
            setLoading(false);
        }
    };

    const handleUpload = async () => {
        try {
            const localFile = await open({
                multiple: false,
                title: 'Select File to Upload'
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

        try {
            const localDest = await save({
                title: 'Save Download As...',
                defaultPath: selectedFile.name
            });
            if (!localDest) return;

            setLoading(true);
            const conn = connections.find(c => c.id === tab.connectionId);
            if (!conn) throw new Error("Connection not found");

            const creds = await api.resolveCredentials(conn.id);
            const username = creds.username || conn.username;

            addToast({ type: 'info', title: 'Download Started', description: `Downloading ${selectedFile.name}...` });

            if (isSftp) {
                await api.sftpDownload(conn.host, conn.port, username, creds.password_decrypted || null, creds.private_key_decrypted || null, selectedFile.path, localDest);
            } else {
                await api.ftpDownload(conn.host, conn.port, username, creds.password_decrypted || null, selectedFile.path, localDest);
            }
            addToast({ type: 'success', title: 'Download Complete', description: selectedFile.name });
        } catch (err) {
            addToast({ type: 'error', title: 'Download Failed', description: String(err) });
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedFile) return;
        setMenuPosition(null);

        if (!confirm(`Are you sure you want to delete ${selectedFile.name}?`)) return;

        try {
            setLoading(true);
            const conn = connections.find(c => c.id === tab.connectionId);
            if (!conn) throw new Error("Connection not found");

            const creds = await api.resolveCredentials(conn.id);
            const username = creds.username || conn.username;

            if (isSftp) {
                await api.sftpDelete(conn.host, conn.port, username, creds.password_decrypted || null, creds.private_key_decrypted || null, selectedFile.path, selectedFile.is_dir);
            } else {
                await api.ftpDelete(conn.host, conn.port, username, creds.password_decrypted || null, selectedFile.path, selectedFile.is_dir);
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
        const name = prompt("Enter new folder name:");
        if (!name) return;

        try {
            setLoading(true);
            const conn = connections.find(c => c.id === tab.connectionId);
            if (!conn) throw new Error("Connection not found");

            const creds = await api.resolveCredentials(conn.id);
            const username = creds.username || conn.username;

            const remotePath = `${currentPath === '/' ? '' : currentPath}/${name}`;

            if (isSftp) {
                await api.sftpMkdir(conn.host, conn.port, username, creds.password_decrypted || null, creds.private_key_decrypted || null, remotePath);
            } else {
                await api.ftpMkdir(conn.host, conn.port, username, creds.password_decrypted || null, remotePath);
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
                        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                    </button>
                    <div className="h-6 w-px bg-border mx-2" />
                    <div className="flex items-center overflow-hidden bg-surface border border-border rounded-lg px-3 py-1.5 flex-1 shadow-inner">
                        <span className="text-sm font-mono text-text-primary truncate">{currentPath}</span>
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
            <div className={`flex-1 overflow-auto custom-scrollbar relative p-2 ${isDraggingOver ? 'bg-accent/10 border-2 border-dashed border-accent m-2 rounded-lg' : ''}`}>
                {isDraggingOver && (
                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-base/80 backdrop-blur-sm pointer-events-none rounded-lg">
                        <Upload className="w-16 h-16 text-accent mb-4 animate-bounce" />
                        <h3 className="text-xl font-bold text-white">Drop files to upload</h3>
                        <p className="text-text-muted mt-2 text-sm">Uploading to {currentPath}</p>
                    </div>
                )}

                {errorMsg ? (
                    <div className="absolute inset-0 flex items-center justify-center p-8">
                        <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-2xl max-w-md text-center">
                            <Trash className="w-10 h-10 text-red-400 mx-auto mb-3" />
                            <h3 className="text-red-400 font-bold mb-2 uppercase tracking-wide">Connection Error</h3>
                            <p className="text-red-300/80 text-sm whitespace-pre-wrap">{errorMsg}</p>
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
                            {files.map((file, idx) => (
                                <tr
                                    key={idx}
                                    onDoubleClick={() => handleNavigate(file)}
                                    onContextMenu={(e) => handleRightClick(e, file)}
                                    className="group hover:bg-white/5 border-b border-border/20 transition-colors cursor-pointer"
                                >
                                    <td className="py-3 px-4 text-center">
                                        {file.is_dir ? <Folder className="w-5 h-5 text-blue-400 fill-blue-400/20 mx-auto" /> : <File className="w-5 h-5 text-slate-400 mx-auto" />}
                                    </td>
                                    <td className="py-3 px-4 text-sm font-medium text-text-primary relative">
                                        {file.name}
                                        {file.is_dir && <ChevronRight className="w-4 h-4 text-text-muted absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity" />}
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

            {/* Context Menu */}
            {menuPosition && selectedFile && (
                <div
                    className="fixed z-[999] bg-[#1e1e2e] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[160px]"
                    style={{ top: menuPosition.y, left: menuPosition.x }}
                    onClick={(e) => e.stopPropagation()}
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
