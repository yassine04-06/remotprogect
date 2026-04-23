import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { motion, AnimatePresence } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';
import { useConnectionStore, useTabStore, useUIStore } from '../store';
import * as api from '../services/api';
import type { Tab, SshStatusEvent, SshDataEvent } from '../types';
import { RefreshCw, TerminalSquare } from 'lucide-react';
import { useResolvedCredentials } from '../hooks/useResolvedCredentials';

interface TerminalViewProps {
    tab: Tab;
    isActive: boolean;
}

export function TerminalView({ tab, isActive }: TerminalViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    const connections = useConnectionStore(s => s.connections);
    const updateTabStatus = useTabStore(s => s.updateTabStatus);
    const setShowCommandPalette = useUIStore(s => s.setShowCommandPalette);
    const appTheme = useUIStore(s => s.theme);
    const [sessionState, setSessionState] = useState(tab.status);
    const { resolve: resolveCreds } = useResolvedCredentials(tab.connectionId);

    const [menuPosition, setMenuPosition] = useState<{ x: number, y: number } | null>(null);

    const handleCopy = () => {
        if (termRef.current) {
            const selection = termRef.current.getSelection();
            if (selection) {
                navigator.clipboard.writeText(selection);
            }
        }
        setMenuPosition(null);
    };

    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text && termRef.current) {
                await api.sshSendInput(tab.id, text);
            }
        } catch (err) {
            console.error("Paste failed", err);
        }
        setMenuPosition(null);
    };

    const handleRightClick = (e: React.MouseEvent) => {
        e.preventDefault();
        setMenuPosition({ x: e.clientX, y: e.clientY });
    };

    useEffect(() => {
        const handleGlobalClick = () => setMenuPosition(null);
        window.addEventListener('click', handleGlobalClick);
        return () => window.removeEventListener('click', handleGlobalClick);
    }, []);

    useEffect(() => {
        if (!isActive) return;

        const handleInjectCommand = (e: Event) => {
            const customEvent = e as CustomEvent<string>;
            const command = customEvent.detail;
            if (command) {
                api.sshSendInput(tab.id, command + '\n').catch(console.error);
                termRef.current?.focus();
            }
        };

        window.addEventListener('inject-command', handleInjectCommand);
        return () => window.removeEventListener('inject-command', handleInjectCommand);
    }, [isActive, tab.id]);

    useEffect(() => {
        // Only initialize when container is available and not already initialized
        if (!containerRef.current || termRef.current) return;

        console.log("TerminalView: Initializing xterm.js for", tab.connectionName);

        const term = new Terminal({
            cursorBlink: true,
            theme: appTheme === 'light' ? {
                background: '#ffffff',
                foreground: '#000000',
                cursor: '#000000',
                selectionBackground: '#007aff',
            } : {
                background: '#0a0a0a',
                foreground: '#ffffff',
                cursor: '#ffffff',
                selectionBackground: 'rgba(255, 255, 255, 0.3)',
            },
            convertEol: true,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        try {
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => webglAddon.dispose());
            term.loadAddon(webglAddon);
        } catch (e) {
            console.warn("WebGL addon could not be loaded, falling back to canvas/dom", e);
        }

        term.open(containerRef.current);

        // Immediate confirmation text - NO ESCAPE CODES FIRST
        term.writeln(">>> TERMINAL INITIALIZED");

        // KEYBOARD CLIPBOARD HANDLING
        term.attachCustomKeyEventHandler((e) => {
            // Ctrl+C (when text is selected)
            if (e.ctrlKey && e.code === 'KeyC' && term.hasSelection()) {
                if (e.type === 'keydown') handleCopy();
                return false;
            }
            // Ctrl+V
            if (e.ctrlKey && e.code === 'KeyV') {
                if (e.type === 'keydown') handlePaste();
                return false;
            }
            return true;
        });

        termRef.current = term;
        fitAddonRef.current = fitAddon;

        const unlisteners: Array<() => void> = [];

        const setupListeners = async () => {
            term.onData(async (data) => {
                try {
                    await api.sshSendInput(tab.id, data);
                } catch (e) {
                    console.error("Failed to send input", e);
                }
            });

            // Listen for data
            const unlistenData = await listen<SshDataEvent>(`ssh:data:${tab.id}`, (e) => {
                term.write(e.payload.data);
            });
            unlisteners.push(unlistenData);

            // Listen for status
            const unlistenStatus = await listen<SshStatusEvent>(`ssh:status:${tab.id}`, (e) => {
                setSessionState(e.payload.status as any);
                updateTabStatus(tab.id, e.payload.status as any);

                if (e.payload.status === 'error') {
                    term.writeln(`\r\n[ERROR] ${e.payload.message}`);
                }
            });
            unlisteners.push(unlistenStatus);

            // Start connection
            const conn = connections.find(c => c.id === tab.connectionId) || tab.connection;
            if (conn) {
                try {
                    const creds = await resolveCreds();
                    if (!creds) throw new Error("Failed to resolve credentials");
                    
                    await api.sshConnect(
                        tab.id, 
                        conn.host, 
                        conn.port, 
                        creds.username || conn.username, 
                        creds.password_decrypted, 
                        creds.private_key_decrypted
                    );
                } catch (err) {
                    const errMsg = `[INTERNAL FAILURE] ${String(err)}`;
                    term.writeln(`\r\n${errMsg}`);
                    setSessionState('error');
                    updateTabStatus(tab.id, 'error');
                }
            }
        };

        setupListeners();

        // Fit after a short delay to ensure DOM is ready
        setTimeout(() => fitAddon.fit(), 100);

        return () => {
            unlisteners.forEach(fn => fn());
            term.dispose();
            termRef.current = null;
            api.sshDisconnect(tab.id).catch(() => { });
        };
    }, [tab.id, connections]); // Initialize once when component mounts

    useEffect(() => {
        if (isActive && fitAddonRef.current) {
            setTimeout(() => {
                fitAddonRef.current?.fit();
                termRef.current?.focus();
            }, 50);
        }
    }, [isActive]);

    const handleReconnect = async () => {
        if (termRef.current) {
            termRef.current.clear();
        }
        setSessionState('connecting');
        updateTabStatus(tab.id, 'connecting');
        await api.sshDisconnect(tab.id).catch(() => { });

        const conn = connections.find(c => c.id === tab.connectionId);
        if (conn) {
            try {
                const creds = await resolveCreds();
                if (!creds) throw new Error("Failed to resolve credentials");
                
                await api.sshConnect(
                    tab.id, 
                    conn.host, 
                    conn.port, 
                    creds.username || conn.username, 
                    creds.password_decrypted, 
                    creds.private_key_decrypted
                );
            } catch (e) {
                setSessionState('error');
                updateTabStatus(tab.id, 'error');
            }
        }
    };

    return (
        <div
            className={`relative w-full h-full bg-base overflow-hidden ${isActive ? 'flex flex-col' : 'hidden'}`}
            onContextMenu={handleRightClick}
        >
            {/* Overlay Utilities */}
            <div className="absolute top-4 right-6 z-20 flex gap-2">
                <button
                    onClick={() => setShowCommandPalette(true)}
                    className="p-2 glass-card rounded-lg border border-border hover:bg-accent/10 hover:border-accent text-text-muted hover:text-accent transition-all shadow-lg flex items-center gap-2"
                    title="Command Palette (Ctrl+P)"
                >
                    <TerminalSquare className="w-4 h-4" />
                    <span className="text-xs font-semibold pr-1">Snippets</span>
                </button>
            </div>
            <div className="flex-1 w-full relative">
                {/* Real Terminal */}
                <div
                    className="absolute inset-0 z-10"
                    ref={containerRef}
                    style={{ backgroundColor: appTheme === 'light' ? '#ffffff' : '#0a0a0a' }}
                />
            </div>

            {/* Context Menu */}
            <AnimatePresence>
                {menuPosition && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="fixed z-[100] bg-surface/90 backdrop-blur-xl border border-border shadow-2xl rounded-xl p-1.5 min-w-[160px]"
                        style={{ top: menuPosition.y, left: menuPosition.x }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={handleCopy}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-text-primary hover:bg-accent/10 rounded-lg transition-all"
                        >
                            Copy <span className="opacity-40 text-[10px]">Ctrl+C</span>
                        </button>
                        <button
                            onClick={handlePaste}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-text-primary hover:bg-accent/10 rounded-lg transition-all"
                        >
                            Paste <span className="opacity-40 text-[10px]">Ctrl+V</span>
                        </button>
                        <div className="h-px bg-border/50 my-1" />
                        <button
                            onClick={() => { termRef.current?.selectAll(); setMenuPosition(null); }}
                            className="w-full text-left px-3 py-2 text-xs font-bold text-text-muted hover:text-text-primary hover:bg-accent/10 rounded-lg transition-all"
                        >
                            Select All
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Simple Status Notification */}
            <AnimatePresence>
                {(sessionState === 'disconnected' || sessionState === 'error') && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-[100] flex items-center justify-center bg-base/80 backdrop-blur-sm"
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="p-10 glass-card border border-border/50 shadow-2xl text-center min-w-[360px] rounded-[2.5rem]"
                        >
                            <div className={`w-16 h-16 rounded-3xl mx-auto mb-6 flex items-center justify-center ${sessionState === 'error' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-accent/10 text-accent border border-accent/20'}`}>
                                <RefreshCw className={`w-8 h-8 ${sessionState === 'error' ? '' : 'animate-spin-slow'}`} />
                            </div>
                            <h3 className="text-2xl font-black text-text-primary mb-2 uppercase tracking-tight">
                                {sessionState === 'error' ? 'Handshake Failed' : 'Session Terminated'}
                            </h3>
                            <p className="text-xs text-text-muted mb-8 leading-relaxed max-w-[240px] mx-auto opacity-70">
                                {sessionState === 'error' ? 'The remote host rejected the encrypted tunnel request.' : 'The secure channel was closed by the remote gateway.'}
                            </p>
                            <button
                                onClick={handleReconnect}
                                className={`w-full h-14 rounded-2xl text-sm font-black transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 ${sessionState === 'error' ? 'bg-red-500 text-white hover:bg-red-600 shadow-red-500/20' : 'bg-accent text-white hover:bg-accent/90 shadow-accent/20'}`}
                            >
                                <RefreshCw className="w-4 h-4" /> RE-ESTABLISH SESSION
                            </button>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
