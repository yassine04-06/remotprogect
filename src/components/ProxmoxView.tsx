import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Square, RefreshCw, PowerOff, Loader2, RotateCcw, Server, Box, AlertCircle, Monitor } from 'lucide-react';
import * as api from '../services/api';
import type { ProxmoxResource, ProxmoxAuthResponse, ServerConnection } from '../types';
import { useAppStore } from '../store/useAppStore';

interface Props {
    connection: ServerConnection;
}

export const ProxmoxView: React.FC<Props> = ({ connection }) => {
    const { addToast } = useAppStore();
    const [authData, setAuthData] = useState<ProxmoxAuthResponse | null>(null);
    const [resources, setResources] = useState<ProxmoxResource[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Auth & Init
    const initProxmox = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const auth = await api.proxmoxAuth(
                connection.host,
                connection.port,
                connection.username,
                connection.password_encrypted ?? '',
                null // Cleartext password handling relies on standard vault decryption flow outside this scope
                // Actually, the vault decrypts it in rust, but proxmox_auth currently takes raw password.
                // For MVP, assuming the user inputs it without vault or we will amend API to decrypt.
            );
            setAuthData(auth);

            const res = await api.proxmoxGetResources(connection.host, connection.port, auth.ticket);
            setResources(res);
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setIsLoading(false);
        }
    }, [connection]);

    useEffect(() => {
        initProxmox();
    }, [initProxmox]);

    // Polling Loop
    useEffect(() => {
        if (!authData) return;
        let mounted = true;

        const tick = async () => {
            if (!mounted) return;
            try {
                const res = await api.proxmoxGetResources(connection.host, connection.port, authData.ticket);
                if (mounted) setResources(res);
            } catch (ignored) { }
        };

        const interval = setInterval(tick, 5000);
        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, [authData, connection.host, connection.port]);

    const handleAction = async (vmid: string, node: string, type: string, action: string) => {
        if (!authData) return;
        setActionLoading(vmid);
        try {
            await api.proxmoxVmAction(
                connection.host,
                connection.port,
                authData.ticket,
                authData.CSRFPreventionToken,
                node,
                vmid,
                type,
                action
            );
            addToast({ type: 'success', title: 'Action Sent', description: `${action.toUpperCase()} initiated on VM ${vmid}` });

            // Optimistic fast refresh
            setTimeout(async () => {
                try {
                    const res = await api.proxmoxGetResources(connection.host, connection.port, authData.ticket);
                    setResources(res);
                } catch (ignored) { }
            }, 2000);

        } catch (err: any) {
            addToast({ type: 'error', title: 'Action Failed', description: err.toString() });
        } finally {
            setActionLoading(null);
        }
    };

    if (isLoading && !resources.length) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-base text-text-muted">
                <Loader2 className="w-8 h-8 animate-spin text-accent mb-4" />
                <p>Authenticating with Proxmox VE...</p>
            </div>
        );
    }

    if (error && !resources.length) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-base text-red-400 p-6 text-center">
                <AlertCircle className="w-12 h-12 mb-4 opacity-50" />
                <h2 className="text-xl font-bold text-red-300 mb-2">Connection Failed</h2>
                <p className="max-w-md opacity-80">{error}</p>
                <button
                    onClick={initProxmox}
                    className="mt-6 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-text-primary transition-colors flex items-center gap-2"
                >
                    <RefreshCw className="w-4 h-4" /> Retry Connection
                </button>
            </div>
        );
    }

    const runningCount = resources.filter(r => r.status === 'running').length;
    const stoppedCount = resources.filter(r => r.status === 'stopped').length;

    return (
        <div className="w-full h-full flex flex-col bg-base overflow-hidden">
            {/* Header */}
            <div className="h-16 shrink-0 border-b border-border flex items-center justify-between px-6 bg-surface/30 backdrop-blur-md">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-pink-500/10 flex items-center justify-center border border-pink-500/20">
                        <Server className="w-5 h-5 text-pink-400" />
                    </div>
                    <div>
                        <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
                            {connection.name} Dashboard
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-mono border border-accent/20 uppercase tracking-widest">
                                PROXMOX VE
                            </span>
                        </h1>
                        <p className="text-xs text-text-muted flex gap-4">
                            <span><strong className="text-text-primary">{resources.length}</strong> Total Node(s)</span>
                            <span className="text-green-400"><strong className="text-green-400">{runningCount}</strong> Running</span>
                            <span className="text-red-400"><strong className="text-red-400">{stoppedCount}</strong> Stopped</span>
                        </p>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto custom-scrollbar p-6">
                <div className="overflow-hidden rounded-xl border border-border shadow-2xl glass-card">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-accent/5 text-[10px] uppercase tracking-wider text-text-muted font-bold">
                                <th className="p-4 border-b border-border">Status</th>
                                <th className="p-4 border-b border-border">ID</th>
                                <th className="p-4 border-b border-border w-1/4">Name</th>
                                <th className="p-4 border-b border-border">Type</th>
                                <th className="p-4 border-b border-border">Node</th>
                                <th className="p-4 border-b border-border w-1/4">CPU & RAM Usage</th>
                                <th className="p-4 border-b border-border text-right w-[150px]">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            <AnimatePresence>
                                {resources.map((res) => {
                                    const isRunning = res.status === 'running';
                                    const cpuPercent = (res.cpu ?? 0) * 100;
                                    const memPercent = res.maxmem && res.mem ? (res.mem / res.maxmem) * 100 : 0;

                                    return (
                                        <motion.tr
                                            key={res.id}
                                            layout
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            className="border-b border-border hover:bg-accent/5 transition-colors"
                                        >
                                            <td className="p-4">
                                                <div className={`flex items-center gap-2 text-xs font-bold ${isRunning ? 'text-green-400' : 'text-red-400 text-opacity-70'}`}>
                                                    <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)]' : 'bg-red-500/50'}`} />
                                                    {res.status.toUpperCase()}
                                                </div>
                                            </td>
                                            <td className="p-4 text-xs font-mono font-bold opacity-60">
                                                {res.id}
                                            </td>
                                            <td className="p-4">
                                                <div className="font-semibold text-text-primary">{res.name}</div>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex items-center gap-1.5 text-xs text-text-muted bg-accent/5 w-min px-2 py-1 rounded inline-flex">
                                                    {res.type === 'qemu' ? <Monitor className="w-3 h-3" /> : <Box className="w-3 h-3" />}
                                                    <span className="uppercase font-bold tracking-wider">{res.type}</span>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="text-xs text-text-muted">{res.node}</div>
                                            </td>
                                            <td className="p-4">
                                                {isRunning ? (
                                                    <div className="flex flex-col gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] w-8 text-text-muted uppercase font-bold">CPU</span>
                                                            <div className="flex-1 h-1.5 bg-accent/10 rounded-full overflow-hidden">
                                                                <div className="h-full bg-accent transition-all duration-500" style={{ width: `${Math.min(100, cpuPercent)}%` }} />
                                                            </div>
                                                            <span className="text-[10px] font-mono text-text-muted">{cpuPercent.toFixed(1)}%</span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] w-8 text-text-muted uppercase font-bold">RAM</span>
                                                            <div className="flex-1 h-1.5 bg-accent/10 rounded-full overflow-hidden">
                                                                <div className="h-full bg-accent-secondary transition-all duration-500" style={{ width: `${Math.min(100, memPercent)}%` }} />
                                                            </div>
                                                            <span className="text-[10px] font-mono text-text-muted">{memPercent.toFixed(1)}%</span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] text-text-muted/40 font-bold uppercase">— Offline —</span>
                                                )}
                                            </td>
                                            <td className="p-4 text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    {isRunning ? (
                                                        <>
                                                            <button
                                                                onClick={() => handleAction(res.id.split('/')[1], res.node, res.type, 'stop')}
                                                                disabled={actionLoading === res.id.split('/')[1]}
                                                                className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-white/5 transition-colors" title="Stop">
                                                                {actionLoading === res.id.split('/')[1] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                                                            </button>
                                                            <button
                                                                onClick={() => handleAction(res.id.split('/')[1], res.node, res.type, 'reboot')}
                                                                disabled={actionLoading === res.id.split('/')[1]}
                                                                className="p-1.5 rounded-lg text-text-muted hover:text-orange-400 hover:bg-white/5 transition-colors" title="Reboot">
                                                                {actionLoading === res.id.split('/')[1] ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                                                            </button>
                                                            <button
                                                                onClick={() => handleAction(res.id.split('/')[1], res.node, res.type, 'shutdown')}
                                                                disabled={actionLoading === res.id.split('/')[1]}
                                                                className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors" title="Shutdown">
                                                                {actionLoading === res.id.split('/')[1] ? <Loader2 className="w-4 h-4 animate-spin" /> : <PowerOff className="w-4 h-4" />}
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleAction(res.id.split('/')[1], res.node, res.type, 'start')}
                                                            disabled={actionLoading === res.id.split('/')[1]}
                                                            className="p-1.5 rounded-lg text-text-muted hover:text-green-400 hover:bg-green-400/10 transition-colors" title="Start">
                                                            {actionLoading === res.id.split('/')[1] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </motion.tr>
                                    );
                                })}
                            </AnimatePresence>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
