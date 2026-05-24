// 90-19: Refactored — logs and exec extracted to docker/ sub-components
import React, { useEffect, useCallback, useState } from 'react';
import { ServerConnection, DockerContainer } from '../types';
import * as api from '../services/api';
import { useUIStore } from '../store';
import {
    Play,
    Square,
    RotateCcw,
    Box,
    RefreshCw,
    ServerCrash,
    Activity,
    FileText,
    TerminalSquare,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { DockerLogsModal } from './docker/DockerLogsModal';
import { DockerExecPanel } from './docker/DockerExecPanel';

interface Props {
    connection: ServerConnection;
}

export const DockerView: React.FC<Props> = ({ connection }) => {
    const addToast = useUIStore(s => s.addToast);

    const [containers, setContainers] = useState<DockerContainer[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [logsContainer, setLogsContainer] = useState<DockerContainer | null>(null);
    const [execContainer, setExecContainer] = useState<DockerContainer | null>(null);

    const fetchContainers = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await api.dockerGetContainers(
                connection.host,
                connection.port,
                connection.docker_transport,
                connection.docker_socket_path,
                connection.docker_tls_ca_path,
                connection.docker_tls_cert_path,
                connection.docker_tls_key_path,
            );
            setContainers(data);
        } catch (err: unknown) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, [connection.host, connection.port, connection.docker_transport, connection.docker_socket_path, connection.docker_tls_ca_path, connection.docker_tls_cert_path, connection.docker_tls_key_path]);

    useEffect(() => {
        fetchContainers();
        const interval = setInterval(fetchContainers, 10000);
        return () => clearInterval(interval);
    }, [fetchContainers]);

    const handleAction = async (containerId: string, action: string) => {
        try {
            await api.dockerContainerAction(
                connection.host,
                connection.port,
                containerId,
                action,
                connection.docker_transport,
                connection.docker_socket_path,
                connection.docker_tls_ca_path,
                connection.docker_tls_cert_path,
                connection.docker_tls_key_path,
            );
            fetchContainers();
        } catch (err: unknown) {
            addToast({
                type: 'error',
                title: `Failed to ${action} container`,
                description: String(err),
            });
        }
    };

    if (loading && containers.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-text-muted">
                <RefreshCw className="w-8 h-8 animate-spin mb-4 text-accent" />
                <p>Connecting to Docker Engine...</p>
            </div>
        );
    }

    if (error && containers.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-red-400 p-8 text-center bg-red-500/5 mx-4 my-8 rounded-2xl border border-red-500/10">
                <ServerCrash className="w-12 h-12 mb-4 opacity-80" />
                <h3 className="text-lg font-bold mb-2">Docker API Connection Failed</h3>
                <p className="text-sm opacity-80 max-w-md">{error}</p>
                <button
                    onClick={fetchContainers}
                    className="mt-6 px-4 py-2 bg-red-500/20 text-red-300 rounded-lg text-sm font-semibold hover:bg-red-500/30 transition-colors flex items-center gap-2"
                >
                    <RefreshCw className="w-4 h-4" /> Retry Connection
                </button>
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Container grid */}
            <div className="flex-1 overflow-y-auto p-6 bg-base/50">
                <div className="max-w-7xl mx-auto space-y-6">
                    <div className="flex items-center justify-between border-b border-border pb-6">
                        <div>
                            <h2 className="text-2xl font-black text-text-primary tracking-tight flex items-center gap-3">
                                <div className="p-2.5 bg-sky-500/10 text-sky-400 rounded-xl">
                                    <Box className="w-6 h-6" />
                                </div>
                                Docker Engine
                            </h2>
                            <p className="text-sm text-text-muted mt-2 font-medium flex items-center gap-2">
                                <Activity className="w-4 h-4" />
                                Connected to{' '}
                                <span className="text-sky-400 font-bold">
                                    {connection.host}:{connection.port}
                                </span>
                            </p>
                        </div>
                        <button
                            onClick={fetchContainers}
                            disabled={loading}
                            aria-label="Refresh containers"
                            className="p-2.5 bg-surface border border-border rounded-xl text-text-muted hover:text-text-primary transition-all disabled:opacity-50"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        <AnimatePresence>
                            {containers.map(container => {
                                const isRunning = container.State === 'running';
                                const name = container.Names[0]?.replace('/', '') || 'unknown';
                                const isActiveExec = execContainer?.Id === container.Id;

                                return (
                                    <motion.div
                                        key={container.Id}
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        className={`bg-surface rounded-2xl border overflow-hidden flex flex-col transition-colors group ${isActiveExec ? 'border-sky-500/50' : 'border-border hover:border-accent/30'}`}
                                    >
                                        <div className="px-5 py-4 border-b border-border/50 flex items-start justify-between bg-base/30">
                                            <div className="flex-1 min-w-0 pr-4">
                                                <h3
                                                    className="font-bold text-text-primary truncate text-base"
                                                    title={name}
                                                >
                                                    {name}
                                                </h3>
                                                <p
                                                    className="text-xs text-text-muted truncate mt-1 font-mono"
                                                    title={container.Image}
                                                >
                                                    {container.Image}
                                                </p>
                                            </div>
                                            <div
                                                className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 shadow-sm ${isRunning ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-red-500 shadow-red-500/20'}`}
                                            />
                                        </div>

                                        <div className="p-4 flex-1">
                                            <p className="text-[11px] text-text-muted font-medium mb-1">
                                                STATUS
                                            </p>
                                            <p className="text-sm font-semibold text-text-primary">
                                                {container.Status}
                                            </p>
                                        </div>

                                        <div className="px-4 py-3 bg-base/50 border-t border-border/50 flex items-center justify-between">
                                            <div className="flex gap-2">
                                                {!isRunning ? (
                                                    <button
                                                        onClick={() =>
                                                            handleAction(container.Id, 'start')
                                                        }
                                                        aria-label="Start container"
                                                        className="p-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors"
                                                    >
                                                        <Play className="w-4 h-4 fill-current" />
                                                    </button>
                                                ) : (
                                                    <>
                                                        <button
                                                            onClick={() =>
                                                                handleAction(container.Id, 'stop')
                                                            }
                                                            aria-label="Stop container"
                                                            className="p-2 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded-lg transition-colors"
                                                        >
                                                            <Square className="w-4 h-4 fill-current" />
                                                        </button>
                                                        <button
                                                            onClick={() =>
                                                                handleAction(
                                                                    container.Id,
                                                                    'restart'
                                                                )
                                                            }
                                                            aria-label="Restart container"
                                                            className="p-2 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 rounded-lg transition-colors"
                                                        >
                                                            <RotateCcw className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() =>
                                                                isActiveExec
                                                                    ? setExecContainer(null)
                                                                    : setExecContainer(container)
                                                            }
                                                            aria-label={
                                                                isActiveExec
                                                                    ? 'Close terminal'
                                                                    : 'Open exec terminal'
                                                            }
                                                            className={`p-2 rounded-lg transition-colors ${isActiveExec ? 'bg-sky-500/20 text-sky-300' : 'bg-violet-500/10 text-violet-400 hover:bg-violet-500/20'}`}
                                                        >
                                                            <TerminalSquare className="w-4 h-4" />
                                                        </button>
                                                    </>
                                                )}
                                                <button
                                                    onClick={() => setLogsContainer(container)}
                                                    aria-label="View logs"
                                                    className="p-2 bg-text-muted/10 text-text-muted hover:bg-text-muted/20 rounded-lg transition-colors"
                                                >
                                                    <FileText className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <span
                                                className="text-[10px] font-mono text-text-muted truncate max-w-[80px]"
                                                title={container.Id}
                                            >
                                                {container.Id.substring(0, 8)}
                                            </span>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>

                    {containers.length === 0 && !loading && (
                        <div className="text-center py-20 bg-surface/50 rounded-3xl border border-dashed border-border">
                            <Box className="w-12 h-12 mx-auto text-text-muted opacity-50 mb-4" />
                            <h3 className="text-lg font-bold text-text-primary">
                                No Containers Found
                            </h3>
                            <p className="text-sm text-text-muted mt-2">
                                There are no containers currently running or stopped on this node.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Exec terminal panel */}
            <AnimatePresence>
                {execContainer && (
                    <DockerExecPanel
                        connection={connection}
                        container={execContainer}
                        onClose={() => setExecContainer(null)}
                    />
                )}
            </AnimatePresence>

            {/* Logs modal */}
            <AnimatePresence>
                {logsContainer && (
                    <DockerLogsModal
                        connection={connection}
                        container={logsContainer}
                        onClose={() => setLogsContainer(null)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};
