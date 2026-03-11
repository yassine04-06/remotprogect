import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { listen } from '@tauri-apps/api/event';
import * as api from '../services/api';
import type { Tab } from '../types';
import { useAppStore } from '../store/useAppStore';
import { TerminalSquare } from 'lucide-react';

interface ShellDataEvent {
    session_id: string;
    data: string;
}

interface ShellStatusEvent {
    session_id: string;
    status: string;
    message: string;
}

interface Props {
    tab: Tab;
    isActive: boolean;
}

export function LocalTerminalView({ tab, isActive }: Props) {
    const { setShowCommandPalette } = useAppStore();
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

    const handleCopy = () => {
        if (termRef.current) {
            const selection = termRef.current.getSelection();
            if (selection) navigator.clipboard.writeText(selection);
        }
        setMenuPosition(null);
    };

    const handlePaste = async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (text && termRef.current) {
                await api.shellSendInput(tab.id, text);
            }
        } catch (err) {
            console.error("Paste failed", err);
        }
        setMenuPosition(null);
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
                // Send command and execute immediately with a newline
                api.shellSendInput(tab.id, command + '\r').catch(console.error);
                termRef.current?.focus();
            }
        };

        window.addEventListener('inject-command', handleInjectCommand);
        return () => window.removeEventListener('inject-command', handleInjectCommand);
    }, [isActive, tab.id]);

    useEffect(() => {
        if (!containerRef.current || termRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            theme: {
                background: '#0a0a14',
                foreground: '#e0e0e0',
                cursor: '#00d4ff',
                selectionBackground: '#00d4ff33',
            },
            fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
            fontSize: 13,
            convertEol: true,
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

        // Keyboard clipboard handling
        term.attachCustomKeyEventHandler((e) => {
            if (e.ctrlKey && e.code === 'KeyC' && term.hasSelection()) {
                if (e.type === 'keydown') handleCopy();
                return false;
            }
            if (e.ctrlKey && e.code === 'KeyV') {
                if (e.type === 'keydown') handlePaste();
                return false;
            }
            return true;
        });

        termRef.current = term;
        fitAddonRef.current = fitAddon;

        const unlisteners: Array<() => void> = [];

        const setup = async () => {
            term.onData(async (data) => {
                try {
                    await api.shellSendInput(tab.id, data);
                } catch (e) {
                    console.error("Failed to send shell input", e);
                }
            });

            const unData = await listen<ShellDataEvent>(`shell:data:${tab.id}`, (e) => {
                term.write(e.payload.data);
            });
            unlisteners.push(unData);

            const unStatus = await listen<ShellStatusEvent>(`shell:status:${tab.id}`, (e) => {
                if (e.payload.status === 'disconnected') {
                    term.writeln('\r\n\x1b[90m[Shell exited]\x1b[0m');
                }
            });
            unlisteners.push(unStatus);

            // Spawn the local shell
            try {
                await api.shellSpawn(tab.id);
            } catch (err) {
                term.writeln(`\r\n\x1b[31m[ERROR] ${String(err)}\x1b[0m`);
            }
        };

        setup();
        setTimeout(() => {
            fitAddon.fit();
            // Sync PTY size with xterm
            api.shellResize(tab.id, term.rows, term.cols).catch(() => { });
        }, 100);

        return () => {
            unlisteners.forEach(fn => fn());
            term.dispose();
            termRef.current = null;
            api.shellDisconnect(tab.id).catch(() => { });
        };
    }, [tab.id]);

    useEffect(() => {
        if (isActive && fitAddonRef.current) {
            setTimeout(() => {
                fitAddonRef.current?.fit();
                termRef.current?.focus();
                // Sync PTY size on tab switch
                if (termRef.current) {
                    api.shellResize(tab.id, termRef.current.rows, termRef.current.cols).catch(() => { });
                }
            }, 50);
        }
    }, [isActive]);

    return (
        <div
            className={`relative w-full h-full overflow-hidden ${isActive ? 'flex flex-col' : 'hidden'}`}
            style={{ background: '#0a0a14' }}
            onContextMenu={(e) => {
                e.preventDefault();
                setMenuPosition({ x: e.clientX, y: e.clientY });
            }}
        >
            {/* Overlay Utilities */}
            <div className="absolute top-4 right-6 z-20 flex gap-2">
                <button
                    onClick={() => setShowCommandPalette(true)}
                    className="p-2 glass-card rounded-lg border border-white/5 hover:bg-white/10 hover:border-accent text-text-muted hover:text-accent transition-all shadow-lg flex items-center gap-2"
                    title="Command Palette (Ctrl+P)"
                >
                    <TerminalSquare className="w-4 h-4" />
                    <span className="text-xs font-semibold pr-1">Snippets</span>
                </button>
            </div>

            <div className="flex-1 w-full relative">
                <div
                    className="absolute inset-0 z-10 custom-scrollbar-terminal"
                    style={{ background: '#0a0a14' }}
                    ref={containerRef}
                />
            </div>

            {/* Context Menu */}
            {menuPosition && (
                <div
                    className="fixed z-[999] bg-[#1e1e2e] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[120px]"
                    style={{ top: menuPosition.y, left: menuPosition.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={handleCopy}
                        className="w-full text-left px-4 py-2 text-xs text-white hover:bg-accent transition-colors flex items-center gap-2"
                        disabled={!termRef.current?.hasSelection()}
                    >
                        <span className={termRef.current?.hasSelection() ? '' : 'opacity-50'}>Copy</span>
                    </button>
                    <button
                        onClick={handlePaste}
                        className="w-full text-left px-4 py-2 text-xs text-white hover:bg-accent transition-colors"
                    >
                        Paste
                    </button>
                    <div className="h-px bg-white/5 my-1" />
                    <button
                        onClick={() => { termRef.current?.selectAll(); setMenuPosition(null); }}
                        className="w-full text-left px-4 py-2 text-xs text-white hover:bg-accent transition-colors"
                    >
                        Select All
                    </button>
                </div>
            )}
        </div>
    );
}
