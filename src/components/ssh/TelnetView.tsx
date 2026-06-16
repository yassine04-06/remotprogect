// Telnet terminal view — xterm.js driven by telnet:* Tauri events.
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { listen } from '@tauri-apps/api/event';
import * as api from '../../services/api';
import type { Tab } from '../../types';

interface TelnetDataEvent { session_id: string; data: string }
interface TelnetStatusEvent { session_id: string; status: string; message: string }

interface Props {
    tab: Tab;
    isActive: boolean;
}

export function TelnetView({ tab, isActive }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    useEffect(() => {
        if (!containerRef.current || termRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            theme: { background: '#0a0a14', foreground: '#e0e0e0', cursor: '#00d4ff' },
            fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
            fontSize: 13,
            convertEol: true,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());
        term.open(containerRef.current);
        termRef.current = term;
        fitRef.current = fit;

        const unlisteners: Array<() => void> = [];
        const setup = async () => {
            term.onData(data => { api.telnetSend(tab.id, data).catch(() => {}); });

            unlisteners.push(await listen<TelnetDataEvent>(`telnet:data:${tab.id}`, e => {
                term.write(e.payload.data);
            }));
            unlisteners.push(await listen<TelnetStatusEvent>(`telnet:status:${tab.id}`, e => {
                term.writeln(`\r\n\x1b[90m[${e.payload.message}]\x1b[0m`);
            }));
            unlisteners.push(await listen<TelnetStatusEvent>(`telnet:disconnected:${tab.id}`, () => {
                term.writeln('\r\n\x1b[90m[Connection closed]\x1b[0m');
            }));

            const host = tab.connection?.host ?? '';
            const port = tab.connection?.port ?? 23;
            try {
                await api.telnetConnect(tab.id, host, port);
            } catch (err) {
                term.writeln(`\r\n\x1b[31m[ERROR] ${String(err)}\x1b[0m`);
            }
        };
        setup();
        setTimeout(() => fit.fit(), 100);

        return () => {
            unlisteners.forEach(fn => fn());
            api.telnetDisconnect(tab.id).catch(() => {});
            term.dispose();
            termRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (isActive) setTimeout(() => fitRef.current?.fit(), 50);
    }, [isActive]);

    return (
        <div className={`relative w-full h-full overflow-hidden bg-[#0a0a14] ${isActive ? 'flex flex-col' : 'hidden'}`}>
            <div ref={containerRef} className="absolute inset-0 z-10 custom-scrollbar-terminal" data-no-contextmenu />
        </div>
    );
}
