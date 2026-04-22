import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useConnectionStore, useTabStore } from '../store';
import * as api from '../services/api';
import { Monitor, Server, Terminal, Lock, HardDrive, MonitorStop, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { ServerConnection } from '../types';

interface PingHistory {
    [connectionId: string]: {
        online: boolean;
        latency: number | null;
        history: (number | null)[];
    };
}

export const HealthDashboard: React.FC = () => {
    const connections = useConnectionStore(s => s.connections);
    const addTab = useTabStore(s => s.addTab);
    const setActiveTabId = useTabStore(s => s.setActiveTabId);
    const [healthData, setHealthData] = useState<PingHistory>({});
    const [isPinging, setIsPinging] = useState(false);

    const openTab = (conn: ServerConnection) => {
        const id = `${conn.id}-${Date.now()}`;
        addTab({
            id,
            connectionId: conn.id,
            connectionName: conn.name,
            protocol: conn.protocol,
            status: 'connecting',
            connection: conn
        });
        setActiveTabId(id);
    };

    // Initial ping & Interval setup
    useEffect(() => {
        let mounted = true;

        const runPings = async () => {
            if (!mounted) return;
            setIsPinging(true);

            const results: PingHistory = { ...healthData };

            const promises = connections.map(async (conn) => {
                try {
                    // Start from 0 since we measure locally in rust anyway, this avoids await blocking
                    const latency = await api.pingServer(conn.host, conn.port);
                    if (!results[conn.id]) {
                        results[conn.id] = { online: true, latency, history: [latency] };
                    } else {
                        const history = [...results[conn.id].history, latency].slice(-20); // Keep last 20
                        results[conn.id] = { online: true, latency, history };
                    }
                } catch (e) {
                    if (!results[conn.id]) {
                        results[conn.id] = { online: false, latency: null, history: [null] };
                    } else {
                        const history = [...results[conn.id].history, null].slice(-20);
                        results[conn.id] = { online: false, latency: null, history };
                    }
                }
            });

            await Promise.allSettled(promises);

            if (mounted) {
                setHealthData({ ...results });
                setIsPinging(false);
            }
        };

        runPings();
        const interval = setInterval(runPings, 10000); // Ping every 10 seconds

        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, [connections]);

    const getProtocolIcon = (protocol: string) => {
        switch (protocol.toUpperCase()) {
            case 'SSH': return <Terminal className="w-4 h-4" />;
            case 'RDP': return <Monitor className="w-4 h-4" />;
            case 'VNC': return <MonitorStop className="w-4 h-4" />;
            case 'SFTP': return <Lock className="w-4 h-4" />;
            case 'FTP': return <HardDrive className="w-4 h-4" />;
            default: return <Server className="w-4 h-4" />;
        }
    };

    if (connections.length === 0) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex items-center justify-center flex-col text-text-muted"
            >
                <div className="relative mb-8">
                    <div className="absolute inset-0 bg-accent/20 blur-3xl rounded-full" />
                    <div className="relative w-24 h-24 bg-surface/50 backdrop-blur-xl border border-white/5 rounded-3xl flex items-center justify-center shadow-2xl">
                        <Monitor className="w-10 h-10 text-accent opacity-50" />
                    </div>
                </div>
                <h2 className="text-2xl font-bold text-text-primary mb-3 tracking-tight">Health Dashboard</h2>
                <p className="text-[13px] opacity-60 max-w-[280px] text-center leading-relaxed">
                    No connections found. Add servers from the sidebar to start monitoring their status and uptime.
                </p>
            </motion.div>
        );
    }

    return (
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-6 bg-base">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Active Monitoring</h1>
                        <p className="text-sm text-text-muted mt-1">Real-time health status of your infrastructure</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/5 bg-surface text-xs font-semibold ${isPinging ? 'text-accent' : 'text-text-muted'}`}>
                            <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`} />
                            {isPinging ? 'Pinging...' : 'Up to date'}
                        </div>
                    </div>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {connections.map((conn) => {
                        const data = healthData[conn.id];
                        const isOnline = data?.online ?? false;
                        const latency = data?.latency ?? 0;
                        const hasData = !!data;

                        return (
                            <motion.div
                                key={conn.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                onClick={() => openTab(conn)}
                                className="bg-surface/50 border border-border rounded-xl p-5 hover:border-accent/50 hover:bg-surface transition-all shadow-lg flex flex-col gap-4 relative overflow-hidden group cursor-pointer"
                            >
                                {/* Background glow for online/offline */}
                                <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-20 transition-colors duration-1000 ${hasData ? (isOnline ? 'bg-green-500' : 'bg-red-500') : 'bg-gray-500'}`} />

                                <div className="flex justify-between items-start z-10">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2.5 rounded-lg border flex items-center justify-center ${hasData ? (isOnline ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20') : 'bg-accent/5 text-text-muted border-white/10'}`}>
                                            {getProtocolIcon(conn.protocol)}
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-sm text-text-primary truncate max-w-[120px]">{conn.name}</h3>
                                            <div className="text-[10px] uppercase font-bold tracking-wider text-text-muted mt-0.5 opacity-70">
                                                {conn.host}:{conn.port}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center">
                                        {hasData ? (
                                            isOnline ? (
                                                <div className="flex items-center gap-1.5 text-green-400 bg-green-400/10 px-2 py-1 rounded text-xs font-bold">
                                                    <CheckCircle2 className="w-3 h-3" /> Online
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5 text-red-400 bg-red-400/10 px-2 py-1 rounded text-xs font-bold">
                                                    <AlertCircle className="w-3 h-3" /> Offline
                                                </div>
                                            )
                                        ) : (
                                            <div className="text-xs text-text-muted font-mono animate-pulse">Wait...</div>
                                        )}
                                    </div>
                                </div>

                                <div className="z-10 mt-2">
                                    <div className="flex justify-between items-end mb-2">
                                        <span className="text-xs font-bold text-text-muted uppercase tracking-widest">Latency</span>
                                        {hasData && isOnline && (
                                            <span className="text-lg font-mono font-bold text-text-primary">
                                                {latency} <span className="text-xs text-text-muted">ms</span>
                                            </span>
                                        )}
                                        {hasData && !isOnline && (
                                            <span className="text-sm font-mono font-bold text-red-400">TIMEOUT</span>
                                        )}
                                    </div>

                                    {/* Sparkline block */}
                                    <div className="h-10 w-full flex items-end justify-between gap-1 mt-3">
                                        {(data?.history || Array(20).fill(null)).map((val, idx) => {
                                            // Max latency scale for visualization: let's say 200ms
                                            const normalizedHeight = val === null ? 4 : Math.min(100, Math.max(10, (val / 200) * 100));
                                            return (
                                                <div
                                                    key={idx}
                                                    style={{ height: `${normalizedHeight}%` }}
                                                    className={`flex-1 rounded-sm transition-all duration-300 ${val === null ? 'bg-red-500/40 hover:bg-red-400/60' : 'bg-accent/40 hover:bg-accent'}`}
                                                    title={val === null ? 'Timeout' : `${val}ms`}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            </motion.div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
