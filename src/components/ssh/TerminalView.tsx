import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';

// ── LOW-A4: WebGL context budget ─────────────────────────────────────────────
//
// Chromium (Tauri's WebView) enforces a hard cap of ~16 WebGL contexts per
// page.  Exceeding it causes the *oldest* context to be silently revoked by
// the GPU process, leaving that terminal black/unresponsive.  We cap voluntary
// creation at WEBGL_CONTEXT_LIMIT to keep a safe margin for other UI elements
// and guarantee that every terminal remains functional regardless of tab count.
// Terminals beyond the cap use xterm's built-in Canvas renderer — visually
// identical, slightly lower GPU throughput, perfectly stable.
const WEBGL_CONTEXT_LIMIT = 12;
let webglContextCount = 0;
import '@xterm/xterm/css/xterm.css';
import { motion, AnimatePresence } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';
import { useTabStore, useUIStore } from '../../store';
import * as api from '../../services/api';
import type { Tab, SshStatusEvent, SshDataEvent, TabStatus } from '../../types';
import { RefreshCw, TerminalSquare, Circle, Search, ChevronUp, ChevronDown, X, Columns2, Rows2 } from 'lucide-react';

interface TerminalViewProps {
    tab: Tab;
    isActive: boolean;
}

export function TerminalView({ tab, isActive }: TerminalViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);

    const updateTabStatus = useTabStore(s => s.updateTabStatus);
    const setSplitTab = useTabStore(s => s.setSplitTab);
    const splitTabId = useTabStore(s => s.splitTabId);
    const tabs = useTabStore(s => s.tabs);
    const setShowCommandPalette = useUIStore(s => s.setShowCommandPalette);
    const addToast = useUIStore(s => s.addToast);
    const appTheme = useUIStore(s => s.theme);
    const [sessionState, setSessionState] = useState(tab.status);

    const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

    // 90-3: session recording
    const [isRecording, setIsRecording] = useState(false);

    // 90-4: auto-reconnect
    const connectStartRef = useRef<number>(0);
    const reconnectCountRef = useRef<number>(0);
    const [reconnecting, setReconnecting] = useState(false);
    const [reconnectAttempt, setReconnectAttempt] = useState(0);

    // SSH key passphrase prompt
    const [passphrasePrompt, setPassphrasePrompt] = useState<{
        visible: boolean;
        input: string;
        wrongPassphrase: boolean;
    } | null>(null);
    // Keep the last successful passphrase so auto-reconnect doesn't re-ask.
    const passphraseRef = useRef<string | undefined>(undefined);

    // 90-5: terminal search
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Mutable refs so key-handler closures always call the latest version
    const openSearchRef = useRef<() => void>(() => {});
    const closeSearchRef = useRef<() => void>(() => {});
    openSearchRef.current = () => {
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
    };
    closeSearchRef.current = () => {
        setSearchOpen(false);
        setSearchQuery('');
    };

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
            if (text && termRef.current) await api.sshSendInput(tab.id, text);
        } catch (err) {
            console.error('Paste failed', err);
            addToast({ type: 'warning', title: 'Paste failed', description: String(err) });
        }
        setMenuPosition(null);
    };

    const handleRightClick = (e: React.MouseEvent) => {
        e.preventDefault();
        setMenuPosition({ x: e.clientX, y: e.clientY });
    };

    useEffect(() => {
        const handler = () => setMenuPosition(null);
        window.addEventListener('click', handler);
        return () => window.removeEventListener('click', handler);
    }, []);

    useEffect(() => {
        if (!isActive) return;
        const handler = (e: Event) => {
            const cmd = (e as CustomEvent<string>).detail;
            if (cmd) {
                api.sshSendInput(tab.id, cmd + '\n').catch(console.error);
                termRef.current?.focus();
            }
        };
        window.addEventListener('inject-command', handler);
        return () => window.removeEventListener('inject-command', handler);
    }, [isActive, tab.id]);

    // 90-3: stop recording on unmount if still active
    useEffect(() => {
        return () => {
            if (isRecording) api.sshRecordingStop(tab.id).catch(() => {});
        };
    }, [isRecording, tab.id]);

    /**
     * Attempt (or retry) an SSH connection.
     * On first call pass `passphrase = undefined`.
     * If the backend returns `KEY_ENCRYPTED`, shows the passphrase overlay;
     * when the user confirms we call back with their input.
     */
    const doConnect = useCallback(async (passphrase?: string) => {
        connectStartRef.current = Date.now();
        try {
            // CRIT-A4: only session + connection IDs; backend resolves credentials.
            await api.sshConnect(tab.id, tab.connectionId, passphrase);
            // On success, cache passphrase for transparent reconnects.
            passphraseRef.current = passphrase;
            setPassphrasePrompt(null);
        } catch (err) {
            const e = err as { code?: string };
            if (e?.code === 'KEY_ENCRYPTED') {
                // Show passphrase prompt (wrong=true only when retrying with a passphrase)
                setPassphrasePrompt({
                    visible: true,
                    input: '',
                    wrongPassphrase: passphrase !== undefined,
                });
                return;
            }
            termRef.current?.writeln(`\r\n[INTERNAL FAILURE] ${String(err)}`);
            setSessionState('error');
            updateTabStatus(tab.id, 'error');
        }
    }, [tab.id, tab.connectionId, updateTabStatus]);

    const doConnectRef = useRef(doConnect);
    useEffect(() => { doConnectRef.current = doConnect; }, [doConnect]);

    const handleReconnect = useCallback(async () => {
        reconnectCountRef.current = 0;
        if (termRef.current) termRef.current.clear();
        setSessionState('connecting');
        updateTabStatus(tab.id, 'connecting');
        await api.sshDisconnect(tab.id).catch(() => {});
        // Re-use cached passphrase so the user isn't prompted again after a
        // temporary disconnect.
        doConnectRef.current(passphraseRef.current);
    }, [tab.id, updateTabStatus]);

    // Ref so the auto-reconnect timer always calls the latest version
    const handleReconnectRef = useRef(handleReconnect);
    useEffect(() => { handleReconnectRef.current = handleReconnect; }, [handleReconnect]);

    // 90-3: recording toggle
    const handleRecordingToggle = async () => {
        const term = termRef.current;
        if (!isRecording && term) {
            try {
                await api.sshRecordingStart(tab.id, term.cols, term.rows);
                setIsRecording(true);
            } catch (e) {
                console.error('Recording start failed', e);
                addToast({ type: 'error', title: 'Recording failed', description: String(e) });
            }
        } else {
            try {
                await api.sshRecordingStop(tab.id);
                setIsRecording(false);
            } catch (e) {
                console.error('Recording stop failed', e);
                addToast({ type: 'error', title: 'Recording failed', description: String(e) });
            }
        }
    };

    // 90-5: search helpers
    const searchNext = () => {
        if (searchAddonRef.current && searchQuery)
            searchAddonRef.current.findNext(searchQuery, { caseSensitive: false, incremental: false });
    };
    const searchPrev = () => {
        if (searchAddonRef.current && searchQuery)
            searchAddonRef.current.findPrevious(searchQuery, { caseSensitive: false });
    };

    // Terminal initialization
    useEffect(() => {
        if (!containerRef.current || termRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            theme:
                appTheme === 'light'
                    ? { background: '#ffffff', foreground: '#000000', cursor: '#000000', selectionBackground: '#007aff' }
                    : { background: '#0a0a0a', foreground: '#ffffff', cursor: '#ffffff', selectionBackground: 'rgba(255,255,255,0.3)' },
            convertEol: true,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        });

        const fitAddon = new FitAddon();
        const searchAddon = new SearchAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.loadAddon(searchAddon);

        // LOW-A4: only claim a WebGL context if we are below the budget.
        // `ownedWebGL` is captured by both the context-loss callback and the
        // effect cleanup so exactly one decrement happens regardless of which
        // path releases the context first.
        let ownedWebGL = false;
        if (webglContextCount < WEBGL_CONTEXT_LIMIT) {
            try {
                const webglAddon = new WebglAddon();
                webglAddon.onContextLoss(() => {
                    // Browser reclaimed the context (GPU process killed it or
                    // the tab was hidden for too long).  Release our slot so a
                    // future terminal can take it.
                    webglAddon.dispose();
                    if (ownedWebGL) {
                        webglContextCount = Math.max(0, webglContextCount - 1);
                        ownedWebGL = false;
                    }
                });
                term.loadAddon(webglAddon);
                webglContextCount++;
                ownedWebGL = true;
            } catch (e) {
                console.warn('[TerminalView] WebGL addon failed, falling back to canvas renderer', e);
            }
        } else {
            console.warn(
                `[TerminalView] WebGL context cap (${WEBGL_CONTEXT_LIMIT}) reached — ` +
                `tab ${tab.id} will use canvas renderer`
            );
        }

        term.open(containerRef.current);
        term.writeln('>>> TERMINAL INITIALIZED');

        term.attachCustomKeyEventHandler(e => {
            if (e.ctrlKey && e.code === 'KeyC' && term.hasSelection()) {
                if (e.type === 'keydown') handleCopy();
                return false;
            }
            if (e.ctrlKey && e.code === 'KeyV') {
                if (e.type === 'keydown') handlePaste();
                return false;
            }
            // 90-5: Ctrl+F → open search
            if (e.ctrlKey && e.code === 'KeyF') {
                if (e.type === 'keydown') openSearchRef.current();
                return false;
            }
            if (e.code === 'Escape' && e.type === 'keydown') {
                closeSearchRef.current();
                return false;
            }
            return true;
        });

        termRef.current = term;
        fitAddonRef.current = fitAddon;
        searchAddonRef.current = searchAddon;

        const unlisteners: Array<() => void> = [];

        const setupListeners = async () => {
            term.onData(async data => {
                try { await api.sshSendInput(tab.id, data); }
                catch (e) { console.error('Failed to send input', e); }
            });

            // H-1: propagate every terminal resize to the remote PTY.
            term.onResize(({ rows, cols }) => {
                api.sshResize(tab.id, rows, cols).catch(() => {});
            });

            const unlistenData = await listen<SshDataEvent>(`ssh:data:${tab.id}`, e => {
                term.write(e.payload.data);
            });
            unlisteners.push(unlistenData);

            const unlistenStatus = await listen<SshStatusEvent>(`ssh:status:${tab.id}`, e => {
                const status = e.payload.status;

                if (status === 'connected') {
                    reconnectCountRef.current = 0;
                }

                // 90-4: auto-reconnect on rapid disconnect
                if (status === 'disconnected') {
                    const elapsed = Date.now() - connectStartRef.current;
                    if (elapsed < 5000 && reconnectCountRef.current < 3) {
                        const attempt = reconnectCountRef.current + 1;
                        reconnectCountRef.current = attempt;
                        setReconnectAttempt(attempt);
                        setReconnecting(true);
                        setTimeout(() => {
                            setReconnecting(false);
                            handleReconnectRef.current();
                        }, attempt * 2000);
                        return;
                    }
                    reconnectCountRef.current = 0;
                }

                setSessionState(status as TabStatus);
                updateTabStatus(tab.id, status as TabStatus);
                if (status === 'error') {
                    term.writeln(`\r\n[ERROR] ${e.payload.message}`);
                }
            });
            unlisteners.push(unlistenStatus);

            // Initial connection attempt — doConnectRef handles KEY_ENCRYPTED.
            doConnectRef.current(passphraseRef.current);
        };

        setupListeners();
        setTimeout(() => {
            fitAddon.fit();
            // H-1: send the post-fit size to the backend PTY.
            api.sshResize(tab.id, term.rows, term.cols).catch(() => {});
        }, 100);

        return () => {
            unlisteners.forEach(fn => fn());
            // LOW-A4: release the WebGL slot before disposing the terminal so
            // the next terminal to open can claim it.
            if (ownedWebGL) {
                webglContextCount = Math.max(0, webglContextCount - 1);
                ownedWebGL = false;
            }
            term.dispose();
            termRef.current = null;
            searchAddonRef.current = null;
            api.sshDisconnect(tab.id).catch(() => {});
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab.id]);

    useEffect(() => {
        if (isActive && fitAddonRef.current) {
            setTimeout(() => {
                fitAddonRef.current?.fit();
                // H-1: send the post-fit size to the backend PTY.
                const t = termRef.current;
                if (t) api.sshResize(tab.id, t.rows, t.cols).catch(() => {});
                t?.focus();
            }, 50);
        }
        // tab.id is stable for this component instance — only re-fit on activation
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive]);

    // 90-5: live incremental search as user types
    useEffect(() => {
        if (searchAddonRef.current && searchQuery)
            searchAddonRef.current.findNext(searchQuery, { caseSensitive: false, incremental: true });
    }, [searchQuery]);

    return (
        <div
            className={`relative w-full h-full bg-base overflow-hidden ${isActive ? 'flex flex-col' : 'hidden'}`}
            onContextMenu={handleRightClick}
        >
            {/* ── SSH key passphrase overlay ─────────────────────────────────── */}
            {passphrasePrompt?.visible && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="bg-surface border border-border rounded-2xl p-6 w-80 shadow-2xl">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                                <RefreshCw className="w-5 h-5 text-amber-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-text-primary">SSH Key Passphrase</h3>
                                <p className="text-xs text-text-muted mt-0.5">The private key is encrypted</p>
                            </div>
                        </div>

                        {passphrasePrompt.wrongPassphrase && (
                            <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5">
                                <X className="w-3.5 h-3.5" />
                                Incorrect passphrase — try again
                            </p>
                        )}

                        <input
                            type="password"
                            autoFocus
                            value={passphrasePrompt.input}
                            onChange={e =>
                                setPassphrasePrompt(p =>
                                    p ? { ...p, input: e.target.value, wrongPassphrase: false } : null
                                )
                            }
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    const pp = passphrasePrompt.input;
                                    doConnectRef.current(pp);
                                }
                                if (e.key === 'Escape') {
                                    setPassphrasePrompt(null);
                                    setSessionState('error');
                                    updateTabStatus(tab.id, 'error');
                                    termRef.current?.writeln('\r\n[CANCELLED] Passphrase entry cancelled.');
                                }
                            }}
                            placeholder="Enter passphrase…"
                            className="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent mb-4"
                        />

                        <div className="flex items-center justify-end gap-2">
                            <button
                                onClick={() => {
                                    setPassphrasePrompt(null);
                                    setSessionState('error');
                                    updateTabStatus(tab.id, 'error');
                                    termRef.current?.writeln('\r\n[CANCELLED] Passphrase entry cancelled.');
                                }}
                                className="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => doConnectRef.current(passphrasePrompt.input)}
                                className="px-4 py-1.5 bg-accent text-white rounded-lg text-sm font-semibold hover:bg-accent/90 transition-colors"
                            >
                                Connect
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toolbar */}
            <div className="absolute top-4 right-6 z-20 flex gap-2">
                {/* 90-3: Recording button */}
                <button
                    onClick={handleRecordingToggle}
                    title={isRecording ? 'Stop Recording' : 'Start Recording'}
                    className={`p-2 glass-card rounded-lg border transition-all shadow-lg flex items-center gap-2 ${isRecording ? 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'border-border hover:bg-accent/10 hover:border-accent text-text-muted hover:text-accent'}`}
                >
                    <Circle className={`w-3 h-3 ${isRecording ? 'fill-red-400 animate-pulse' : ''}`} />
                    <span className="text-xs font-semibold pr-1">{isRecording ? 'REC' : 'Record'}</span>
                </button>
                {/* 90-5: Search button */}
                <button
                    onClick={openSearchRef.current}
                    title="Search (Ctrl+F)"
                    className="p-2 glass-card rounded-lg border border-border hover:bg-accent/10 hover:border-accent text-text-muted hover:text-accent transition-all shadow-lg"
                >
                    <Search className="w-4 h-4" />
                </button>
                <button
                    onClick={() => setShowCommandPalette(true)}
                    title="Command Palette (Ctrl+P)"
                    className="p-2 glass-card rounded-lg border border-border hover:bg-accent/10 hover:border-accent text-text-muted hover:text-accent transition-all shadow-lg flex items-center gap-2"
                >
                    <TerminalSquare className="w-4 h-4" />
                    <span className="text-xs font-semibold pr-1">Snippets</span>
                </button>
                {/* 90-6: Split pane buttons — only show when there are other SSH tabs */}
                {tabs.filter(t => t.id !== tab.id && t.protocol === 'SSH').length > 0 && (
                    <>
                        <button
                            onClick={() => {
                                const other = tabs.find(t => t.id !== tab.id && t.protocol === 'SSH');
                                if (other) setSplitTab(splitTabId === other.id ? null : other.id, 'h');
                            }}
                            title="Split Horizontal"
                            className={`p-2 glass-card rounded-lg border transition-all shadow-lg ${splitTabId ? 'border-accent/50 text-accent bg-accent/10' : 'border-border text-text-muted hover:bg-accent/10 hover:border-accent hover:text-accent'}`}
                        >
                            <Columns2 className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => {
                                const other = tabs.find(t => t.id !== tab.id && t.protocol === 'SSH');
                                if (other) setSplitTab(splitTabId === other.id ? null : other.id, 'v');
                            }}
                            title="Split Vertical"
                            className={`p-2 glass-card rounded-lg border transition-all shadow-lg ${splitTabId ? 'border-accent/50 text-accent bg-accent/10' : 'border-border text-text-muted hover:bg-accent/10 hover:border-accent hover:text-accent'}`}
                        >
                            <Rows2 className="w-4 h-4" />
                        </button>
                    </>
                )}
            </div>

            {/* 90-5: Search bar overlay */}
            <AnimatePresence>
                {searchOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-surface border border-border rounded-xl shadow-2xl px-3 py-2"
                    >
                        <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        <input
                            ref={searchInputRef}
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') { if (e.shiftKey) searchPrev(); else searchNext(); }
                                else if (e.key === 'Escape') { closeSearchRef.current(); }
                            }}
                            placeholder="Search…"
                            className="bg-transparent outline-none text-sm text-text-primary w-48"
                        />
                        <button
                            onClick={searchPrev}
                            title="Previous (Shift+Enter)"
                            className="p-1 rounded hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
                        >
                            <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={searchNext}
                            title="Next (Enter)"
                            className="p-1 rounded hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
                        >
                            <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={closeSearchRef.current}
                            className="p-1 rounded hover:bg-white/10 text-text-muted hover:text-text-primary transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="flex-1 w-full relative">
                <div
                    className="absolute inset-0 z-10"
                    ref={containerRef}
                    data-no-contextmenu
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
                        onClick={e => e.stopPropagation()}
                    >
                        <button onClick={handleCopy} className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-text-primary hover:bg-accent/10 rounded-lg transition-all">
                            Copy <span className="opacity-40 text-[10px]">Ctrl+C</span>
                        </button>
                        <button onClick={handlePaste} className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-text-primary hover:bg-accent/10 rounded-lg transition-all">
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

            {/* 90-4: Reconnecting overlay */}
            <AnimatePresence>
                {reconnecting && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 z-[100] flex items-center justify-center bg-base/70 backdrop-blur-sm"
                    >
                        <div className="flex items-center gap-3 px-6 py-4 glass-card border border-border rounded-2xl shadow-xl">
                            <RefreshCw className="w-4 h-4 text-accent animate-spin" />
                            <span className="text-sm font-semibold text-text-primary">
                                Reconnecting ({reconnectAttempt}/3)…
                            </span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Session disconnected / error overlay */}
            <AnimatePresence>
                {!reconnecting && (sessionState === 'disconnected' || sessionState === 'error') && (
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
                                {sessionState === 'error'
                                    ? 'The remote host rejected the encrypted tunnel request.'
                                    : 'The secure channel was closed by the remote gateway.'}
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
