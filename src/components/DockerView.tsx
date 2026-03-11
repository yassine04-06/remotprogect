import React, { useEffect, useState } from 'react';
import { ServerConnection, DockerContainer } from '../types';
import * as api from '../services/api';
import { Play, Square, RotateCcw, Box, RefreshCw, ServerCrash, Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Props {
    connection: ServerConnection;
}

export const DockerView: React.FC<Props> = ({ connection }) => {
    const [containers, setContainers] = useState<DockerContainer[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchContainers = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await api.dockerGetContainers(connection.host, connection.port);
            setContainers(data);
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchContainers();
        const interval = setInterval(fetchContainers, 10000); // 10s auto-refresh
        return () => clearInterval(interval);
    }, [connection]);

    const handleAction = async (containerId: string, action: string) => {
        try {
            await api.dockerContainerAction(connection.host, connection.port, containerId, action);
            fetchContainers(); // Refresh after action
        } catch (err: any) {
            alert(`Failed to ${action} container: ${err.toString()}`);
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
                            Connected to <span className="text-sky-400 font-bold">{connection.host}:{connection.port}</span>
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={fetchContainers}
                            disabled={loading}
                            className="p-2.5 bg-surface border border-border rounded-xl text-text-muted hover:text-text-primary transition-all disabled:opacity-50"
                        >
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    <AnimatePresence>
                        {containers.map((container) => {
                            const isRunning = container.State === 'running';
                            const name = container.Names[0]?.replace('/', '') || 'unknown';

                            return (
                                <motion.div
                                    key={container.Id}
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className="bg-surface rounded-2xl border border-border overflow-hidden flex flex-col hover:border-accent/30 transition-colors group"
                                >
                                    <div className="px-5 py-4 border-b border-border/50 flex items-start justify-between bg-base/30">
                                        <div className="flex-1 min-w-0 pr-4">
                                            <h3 className="font-bold text-text-primary truncate text-base" title={name}>{name}</h3>
                                            <p className="text-xs text-text-muted truncate mt-1 font-mono" title={container.Image}>{container.Image}</p>
                                        </div>
                                        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 shadow-sm ${isRunning ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-red-500 shadow-red-500/20'}`} />
                                    </div>

                                    <div className="p-4 flex-1">
                                        <p className="text-[11px] text-text-muted font-medium mb-1">STATUS</p>
                                        <p className="text-sm font-semibold text-text-primary">{container.Status}</p>
                                    </div>

                                    <div className="px-4 py-3 bg-base/50 border-t border-border/50 flex items-center justify-between">
                                        <div className="flex gap-2">
                                            {!isRunning ? (
                                                <button
                                                    onClick={() => handleAction(container.Id, 'start')}
                                                    className="p-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors"
                                                    title="Start"
                                                >
                                                    <Play className="w-4 h-4 fill-current" />
                                                </button>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => handleAction(container.Id, 'stop')}
                                                        className="p-2 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded-lg transition-colors"
                                                        title="Stop"
                                                    >
                                                        <Square className="w-4 h-4 fill-current" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleAction(container.Id, 'restart')}
                                                        className="p-2 bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 rounded-lg transition-colors"
                                                        title="Restart"
                                                    >
                                                        <RotateCcw className="w-4 h-4" />
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                        <span className="text-[10px] font-mono text-text-muted truncate max-w-[80px]" title={container.Id}>
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
                        <h3 className="text-lg font-bold text-text-primary">No Containers Found</h3>
                        <p className="text-sm text-text-muted mt-2">There are no containers currently running or stopped on this node.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
