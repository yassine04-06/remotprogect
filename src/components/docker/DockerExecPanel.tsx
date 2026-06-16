// 90-19: Extracted from DockerView — exec terminal panel with self-contained xterm lifecycle
import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { ServerConnection, DockerContainer } from '../../types';
import * as api from '../../services/api';
import { useUIStore } from '../../store';
import { TerminalSquare, X, Circle } from 'lucide-react';
import { motion } from 'framer-motion';

interface DockerExecDataEvent {
    session_id: string;
    data: string;
}
interface DockerExecStatusEvent {
    session_id: string;
    status: string;
    message: string;
}

interface Props {
    connection: ServerConnection;
    container: DockerContainer;
    onClose: () => void;
}

export const DockerExecPanel: React.FC<Props> = ({ connection, container, onClose }) => {
    const addToast = useUIStore(s => s.addToast);

    const [execSessionId, setExecSessionId] = useState<string | null>(null);
    const [execExecId, setExecExecId] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);

    // M2: asciicast recording for docker exec sessions.
    const handleRecordingToggle = async () => {
        const sid = sessionIdRef.current;
        const term = termRef.current;
        if (!sid) return;
        try {
            if (!isRecording && term) {
                await api.sshRecordingStart(sid, term.cols, term.rows);
                setIsRecording(true);
            } else {
                await api.sshRecordingStop(sid);
                setIsRecording(false);
            }
        } catch (e) {
            addToast({ type: 'error', title: 'Recording failed', description: String(e) });
        }
    };
    useEffect(() => {
        return () => {
            if (isRecording && sessionIdRef.current) {
                api.sshRecordingStop(sessionIdRef.current).catch(() => {});
            }
        };
    }, [isRecording]);
    const [execStatus, setExecStatus] = useState<'connecting' | 'connected' | 'disconnected'>(
        'connecting'
    );

    const termContainerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const unlistenDataRef = useRef<UnlistenFn | null>(null);
    const unlistenStatusRef = useRef<UnlistenFn | null>(null);
    const sessionIdRef = useRef<string | null>(null);

    // Start exec session on mount
    useEffect(() => {
        const sessionId = `docker-exec-${Date.now()}`;
        sessionIdRef.current = sessionId;
        setExecSessionId(sessionId);
        setExecStatus('connecting');

        api
            .dockerExecStart(
                connection.host,
                connection.port,
                container.Id,
                sessionId,
                connection.docker_transport,
                connection.docker_tls_ca_path,
                connection.docker_tls_cert_path,
                connection.docker_tls_key_path,
            )
            .then(execId => setExecExecId(execId))
            .catch(err => {
                addToast({ type: 'error', title: 'Exec failed', description: String(err) });
                onClose();
            });

        return () => {
            unlistenDataRef.current?.();
            unlistenStatusRef.current?.();
            if (sessionIdRef.current) {
                api.dockerExecStop(sessionIdRef.current).catch(() => {});
            }
            termRef.current?.dispose();
            termRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Init xterm.js
    useEffect(() => {
        if (!termContainerRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            theme: {
                background: '#0a0a0a',
                foreground: '#d4d4d4',
                cursor: '#ffffff',
                selectionBackground: 'rgba(255,255,255,0.2)',
            },
            fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
            fontSize: 13,
            lineHeight: 1.2,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(termContainerRef.current);

        setTimeout(() => {
            try {
                fitAddon.fit();
            } catch {
                /* ignore race */
            }
        }, 50);

        termRef.current = term;
        fitAddonRef.current = fitAddon;

        term.onData(data => {
            if (sessionIdRef.current) {
                api.dockerExecInput(sessionIdRef.current, data).catch(() => {});
            }
        });

        return () => {
            term.dispose();
            termRef.current = null;
            fitAddonRef.current = null;
        };
    }, []);

    // Fit after session ID is set (panel fully mounted)
    useEffect(() => {
        if (!execSessionId) return;
        const timer = setTimeout(() => {
            try {
                fitAddonRef.current?.fit();
            } catch {
                /* ignore */
            }
        }, 100);
        return () => clearTimeout(timer);
    }, [execSessionId]);

    // Subscribe to exec events
    useEffect(() => {
        if (!execSessionId) return;

        let active = true;

        const setup = async () => {
            const unlistenData = await listen<DockerExecDataEvent>(
                `docker:data:${execSessionId}`,
                event => {
                    if (!active) return;
                    termRef.current?.write(event.payload.data);
                }
            );

            const unlistenStatus = await listen<DockerExecStatusEvent>(
                `docker:status:${execSessionId}`,
                event => {
                    if (!active) return;
                    const { status, message } = event.payload;
                    if (status === 'connected') {
                        setExecStatus('connected');
                        termRef.current?.write('\r\n\x1b[32m[Connected]\x1b[0m\r\n');
                    } else if (status === 'disconnected') {
                        setExecStatus('disconnected');
                        termRef.current?.write(
                            `\r\n\x1b[33m[Disconnected: ${message}]\x1b[0m\r\n`
                        );
                    }
                }
            );

            unlistenDataRef.current = unlistenData;
            unlistenStatusRef.current = unlistenStatus;
        };

        setup();

        return () => {
            active = false;
            unlistenDataRef.current?.();
            unlistenStatusRef.current?.();
            unlistenDataRef.current = null;
            unlistenStatusRef.current = null;
        };
    }, [execSessionId]);

    // Send resize to Docker
    useEffect(() => {
        if (!execExecId || !termRef.current) return;

        const term = termRef.current;
        const disposable = term.onResize(({ cols, rows }) => {
            api
                .dockerExecResize(
                    connection.host,
                    connection.port,
                    execExecId,
                    rows,
                    cols,
                    connection.docker_transport,
                    connection.docker_tls_ca_path,
                    connection.docker_tls_cert_path,
                    connection.docker_tls_key_path,
                )
                .catch(() => {});
        });
        return () => disposable.dispose();
    }, [execExecId, connection.host, connection.port, connection.docker_transport, connection.docker_tls_ca_path, connection.docker_tls_cert_path, connection.docker_tls_key_path]);

    const name =
        container.Names[0]?.replace('/', '') || container.Id.substring(0, 8);

    return (
        <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 320, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border bg-[#0a0a0a] flex flex-col shrink-0"
        >
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-surface/30">
                <div className="flex items-center gap-2 text-sm">
                    <TerminalSquare className="w-4 h-4 text-violet-400" />
                    <span className="font-semibold text-text-primary">{name}</span>
                    <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            execStatus === 'connected'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : execStatus === 'disconnected'
                                  ? 'bg-red-500/15 text-red-400'
                                  : 'bg-amber-500/15 text-amber-400'
                        }`}
                    >
                        {execStatus}
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={handleRecordingToggle}
                        title={isRecording ? 'Stop Recording' : 'Start Recording'}
                        className={`p-1.5 rounded-lg transition-colors ${isRecording ? 'text-red-400 hover:bg-red-500/10' : 'text-text-muted hover:text-text-primary hover:bg-surface'}`}
                    >
                        <Circle className={`w-4 h-4 ${isRecording ? 'fill-red-500 animate-pulse' : ''}`} />
                    </button>
                    <button
                        onClick={onClose}
                        aria-label="Close terminal"
                        className="p-1.5 text-text-muted hover:text-text-primary hover:bg-surface rounded-lg transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
            <div ref={termContainerRef} className="flex-1 overflow-hidden p-1" />
        </motion.div>
    );
};
