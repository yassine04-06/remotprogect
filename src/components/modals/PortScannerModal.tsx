import { useEffect, useRef, useState } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useUIStore, useConnectionStore } from '../../store';
import * as api from '../../services/api';
import { Search, Loader2, Server, Globe, CheckSquare, Square, X, StopCircle } from 'lucide-react';
import type { NetworkScanResult } from '../../types';

const COMMON_PORTS = [22, 23, 80, 443, 513, 3389, 5900, 5901];

interface NetworkScanProgress {
    scan_id: string;
    scanned: number;
    total: number;
    percent: number;
    result: NetworkScanResult | null;
    done: boolean;
    cancelled: boolean;
}

export function PortScannerModal({ onClose }: { onClose: () => void }) {
    const [startIp, setStartIp] = useState('192.168.15.1');
    const [endIp, setEndIp] = useState('192.168.15.254');
    const [timeout, setTimeoutVal] = useState(500);
    const [isScanning, setIsScanning] = useState(false);
    const [results, setResults] = useState<NetworkScanResult[]>([]);
    const [progress, setProgress] = useState({ scanned: 0, total: 0, percent: 0 });
    const [wasCancelled, setWasCancelled] = useState(false);
    const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set());
    const [importProtocol, setImportProtocol] = useState<'SSH' | 'RDP' | 'VNC'>('SSH');
    const [dnsQuery, setDnsQuery] = useState('');
    const [dnsResult, setDnsResult] = useState<string | null>(null);
    const [dnsBusy, setDnsBusy] = useState(false);
    const [traceHops, setTraceHops] = useState<api.TracerouteHop[] | null>(null);
    const [traceBusy, setTraceBusy] = useState(false);

    const runTraceroute = async () => {
        const q = dnsQuery.trim();
        if (!q) return;
        setTraceBusy(true);
        setTraceHops(null);
        try {
            setTraceHops(await api.traceroute(q));
        } catch (err) {
            setDnsResult(`✕ ${String(err)}`);
        } finally {
            setTraceBusy(false);
        }
    };

    const runDnsLookup = async () => {
        const q = dnsQuery.trim();
        if (!q) return;
        setDnsBusy(true);
        setDnsResult(null);
        try {
            // IP → reverse PTR, hostname → forward A/AAAA.
            const isIp = /^[0-9.]+$|:/.test(q);
            if (isIp) {
                const host = await api.reverseDns(q);
                setDnsResult(`${q}  →  ${host}`);
            } else {
                const ips = await api.dnsLookup(q);
                setDnsResult(`${q}  →  ${ips.join(', ')}`);
            }
        } catch (err) {
            setDnsResult(`✕ ${String(err)}`);
        } finally {
            setDnsBusy(false);
        }
    };

    const unlistenRef = useRef<UnlistenFn | null>(null);
    const scanIdRef = useRef<string>('');
    const resultsCountRef = useRef(0);

    const addToast = useUIStore(s => s.addToast);
    const groups = useConnectionStore(s => s.groups);
    const refreshData = useConnectionStore(s => s.fetchConnections);

    // 90-22: ESC closes the modal
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    // Cleanup listener on unmount
    useEffect(() => {
        return () => {
            unlistenRef.current?.();
            // If modal is closed while scanning, cancel the backend task too
            if (scanIdRef.current) {
                api.cancelNetworkScan(scanIdRef.current).catch(() => {});
            }
        };
    }, []);

    const handleScan = async () => {
        // Clean up any previous listener
        unlistenRef.current?.();
        unlistenRef.current = null;

        const scanId = `scan-${Date.now()}`;
        scanIdRef.current = scanId;

        setIsScanning(true);
        setResults([]);
        setSelectedIps(new Set());
        setWasCancelled(false);
        setProgress({ scanned: 0, total: 0, percent: 0 });
        resultsCountRef.current = 0;

        // Listen before starting the scan to avoid missing early events
        try {
            unlistenRef.current = await listen<NetworkScanProgress>(
                `network:progress:${scanId}`,
                event => {
                    const p = event.payload;

                    setProgress({ scanned: p.scanned, total: p.total, percent: p.percent });

                    if (p.result) {
                        resultsCountRef.current += 1;
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        setResults(prev => [...prev, p.result!]);
                    }

                    if (p.done) {
                        setIsScanning(false);
                        scanIdRef.current = '';
                        unlistenRef.current?.();
                        unlistenRef.current = null;

                        if (p.cancelled) {
                            setWasCancelled(true);
                        } else if (resultsCountRef.current === 0) {
                            addToast({
                                type: 'info',
                                title: 'Scan Complete',
                                description: 'No active hosts found on those ports.',
                            });
                        }
                    }
                }
            );
        } catch (err) {
            addToast({ type: 'error', title: 'Listener error', description: String(err) });
            setIsScanning(false);
            return;
        }

        try {
            await api.scanNetwork(scanId, startIp, endIp, COMMON_PORTS, timeout);
        } catch (err) {
            addToast({ type: 'error', title: 'Scan Failed', description: String(err) });
            unlistenRef.current?.();
            unlistenRef.current = null;
            scanIdRef.current = '';
            setIsScanning(false);
        }
    };

    const handleCancel = async () => {
        try {
            if (scanIdRef.current) {
                await api.cancelNetworkScan(scanIdRef.current);
            }
        } catch (err) {
            addToast({ type: 'error', title: 'Cancel failed', description: String(err) });
        }
    };

    const toggleSelection = (ip: string) => {
        const next = new Set(selectedIps);
        if (next.has(ip)) next.delete(ip);
        else next.add(ip);
        setSelectedIps(next);
    };

    const toggleAll = () => {
        if (selectedIps.size === results.length) setSelectedIps(new Set());
        else setSelectedIps(new Set(results.map(r => r.ip)));
    };

    const handleBatchImport = async () => {
        if (selectedIps.size === 0) return;

        const groupId = groups.length > 0 ? groups[0].id : null;
        let imported = 0;

        for (const ip of selectedIps) {
            const hostData = results.find(r => r.ip === ip);
            if (!hostData) continue;

            let port = 22;
            if (importProtocol === 'RDP') port = 3389;
            if (importProtocol === 'VNC') port = 5900;

            try {
                await api.createConnection({
                    name: `${ip} (${importProtocol})`,
                    host: ip,
                    port,
                    protocol: importProtocol,
                    username: 'root',
                    use_private_key: false,
                    group_id: groupId,
                    password_encrypted: null,
                    private_key_encrypted: null,
                    rdp_width: 1920,
                    rdp_height: 1080,
                    rdp_fullscreen: false,
                    domain: null,
                    rdp_color_depth: null,
                    rdp_redirect_audio: null,
                    rdp_redirect_printers: null,
                    rdp_redirect_drives: null,
                    ssh_tunnels: null,
                    credential_profile_id: null,
                    override_credentials: null,
                    jump_host_id: null,
                    ssh_key_id: null,
                    use_ssh_agent: null,
                    tags: null,
                    notes: null,
                    use_ftps: null,
                    rdp_nla: null,
                    docker_transport: null,
                    docker_socket_path: null,
                    docker_tls_ca_path: null,
                    docker_tls_cert_path: null,
                    docker_tls_key_path: null,
                    proxmox_api_token_id: null,
                    proxmox_api_token_secret_encrypted: null,
                    mac_address: null,
                });
                imported++;
            } catch (e) {
                console.error('Failed to import', ip, e);
                addToast({
                    type: 'error',
                    title: `Import failed for ${ip}`,
                    description: String(e),
                });
            }
        }

        if (imported > 0) {
            await refreshData(true);
            addToast({
                type: 'success',
                title: 'Import Complete',
                description: `Successfully imported ${imported} connection(s).`,
            });
            setSelectedIps(new Set());
        }
    };

    const progressBarWidth = progress.total > 0 ? `${progress.percent}%` : '0%';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div
                className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-6xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col"
                style={{ maxHeight: '90vh' }}
            >
                {/* Header */}
                <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-base/80">
                    <div className="flex items-center gap-2">
                        <Globe className="w-5 h-5 text-accent" />
                        <h2 className="text-md font-bold text-text-primary">Port Scanner</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-text-muted hover:text-text-primary transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Network tools: DNS + traceroute */}
                <div className="px-4 py-2.5 bg-base/60 border-b border-border flex items-center gap-2">
                    <span className="text-[10px] font-bold text-text-muted uppercase shrink-0">Net</span>
                    <input
                        type="text"
                        value={dnsQuery}
                        onChange={e => setDnsQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') runDnsLookup(); }}
                        placeholder="hostname o IP…"
                        className="flex-1 min-w-0 h-8 bg-surface border border-border rounded px-2 text-sm focus:border-accent outline-none"
                    />
                    <button
                        onClick={runDnsLookup}
                        disabled={dnsBusy || !dnsQuery.trim()}
                        className="shrink-0 h-8 px-3 bg-accent/10 border border-accent/30 text-accent rounded text-xs font-semibold hover:bg-accent/20 disabled:opacity-40"
                    >
                        {dnsBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'DNS'}
                    </button>
                    <button
                        onClick={runTraceroute}
                        disabled={traceBusy || !dnsQuery.trim()}
                        className="shrink-0 h-8 px-3 bg-white/5 border border-white/10 text-text-muted rounded text-xs font-semibold hover:bg-white/10 disabled:opacity-40"
                    >
                        {traceBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Trace'}
                    </button>
                    {dnsResult && (
                        <span className="shrink-0 max-w-[35%] truncate text-xs font-mono text-text-primary" title={dnsResult}>
                            {dnsResult}
                        </span>
                    )}
                </div>
                {traceHops && (
                    <div className="px-4 py-2 bg-base/40 border-b border-border max-h-40 overflow-auto">
                        <table className="w-full text-xs font-mono">
                            <tbody>
                                {traceHops.map(h => (
                                    <tr key={h.hop} className="text-text-muted">
                                        <td className="py-0.5 pr-3 text-right text-text-muted/60 w-8">{h.hop}</td>
                                        <td className="py-0.5 pr-3 text-text-primary">{h.ip || '* * *'}</td>
                                        <td className="py-0.5 text-right text-accent">{h.rtt_ms != null ? `${h.rtt_ms} ms` : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Controls */}
                <div className="p-4 bg-base border-b border-border flex flex-wrap gap-4 items-end">
                    <div className="flex flex-col gap-1 w-36">
                        <label className="text-[10px] font-bold text-text-muted uppercase">
                            IP iniziale
                        </label>
                        <input
                            type="text"
                            value={startIp}
                            onChange={e => setStartIp(e.target.value)}
                            disabled={isScanning}
                            className="h-8 bg-surface border border-border rounded px-2 text-sm focus:border-accent outline-none disabled:opacity-50"
                            placeholder="192.168.1.1"
                        />
                    </div>
                    <div className="flex flex-col gap-1 w-36">
                        <label className="text-[10px] font-bold text-text-muted uppercase">
                            IP finale
                        </label>
                        <input
                            type="text"
                            value={endIp}
                            onChange={e => setEndIp(e.target.value)}
                            disabled={isScanning}
                            className="h-8 bg-surface border border-border rounded px-2 text-sm focus:border-accent outline-none disabled:opacity-50"
                            placeholder="192.168.1.254"
                        />
                    </div>
                    <div className="flex flex-col gap-1 w-24">
                        <label className="text-[10px] font-bold text-text-muted uppercase">
                            Timeout (ms)
                        </label>
                        <input
                            type="number"
                            value={timeout}
                            onChange={e => setTimeoutVal(parseInt(e.target.value) || 500)}
                            disabled={isScanning}
                            className="h-8 bg-surface border border-border rounded px-2 text-sm focus:border-accent outline-none disabled:opacity-50"
                            min={50}
                            max={5000}
                        />
                    </div>

                    <div className="ml-auto flex gap-2">
                        {isScanning && (
                            <button
                                onClick={handleCancel}
                                className="h-8 px-4 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-400 rounded text-sm font-medium flex items-center gap-2 transition-colors"
                            >
                                <StopCircle className="w-4 h-4" />
                                Cancel
                            </button>
                        )}
                        <button
                            onClick={handleScan}
                            disabled={isScanning}
                            className="h-8 px-6 bg-surface border border-border hover:bg-white/5 rounded text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                        >
                            {isScanning ? (
                                <Loader2 className="w-4 h-4 animate-spin text-accent" />
                            ) : (
                                <Search className="w-4 h-4 text-accent" />
                            )}
                            {isScanning ? 'Scanning...' : 'Start Scan'}
                        </button>
                    </div>
                </div>

                {/* Progress bar */}
                {(isScanning || progress.total > 0) && (
                    <div className="px-4 py-2 bg-base/60 border-b border-border flex items-center gap-3">
                        <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                            <div
                                className="h-full bg-accent rounded-full transition-all duration-150"
                                style={{ width: progressBarWidth }}
                            />
                        </div>
                        <span className="text-[11px] text-text-muted font-mono shrink-0">
                            {progress.scanned}/{progress.total} ({progress.percent}%)
                            {wasCancelled && <span className="text-amber-400 ml-2">cancelled</span>}
                            {!isScanning && !wasCancelled && progress.total > 0 && (
                                <span className="text-emerald-400 ml-2">completata</span>
                            )}
                        </span>
                    </div>
                )}

                {/* Results table */}
                <div className="flex-1 overflow-auto bg-base/50 p-2 relative custom-scrollbar min-h-[400px]">
                    {isScanning && results.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center bg-base/80 z-10">
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 animate-spin text-accent" />
                                <p className="text-sm text-text-muted font-medium animate-pulse">
                                    Scanning{' '}
                                    {progress.scanned > 0
                                        ? `${progress.scanned}/${progress.total}`
                                        : 'IP Range'}
                                    …
                                </p>
                            </div>
                        </div>
                    )}

                    {results.length === 0 && !isScanning ? (
                        <div className="h-full flex flex-col items-center justify-center text-text-muted opacity-50">
                            <Server className="w-12 h-12 mb-3" />
                            <p className="text-sm">
                                Configura l'intervallo IP e clicca Inizia Scansione per scoprire
                                dispositivi.
                            </p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse text-xs">
                            <thead className="sticky top-0 bg-surface/90 backdrop-blur-sm shadow z-20">
                                <tr className="border-b border-border">
                                    <th
                                        className="p-2 cursor-pointer text-text-muted hover:text-text-primary"
                                        onClick={toggleAll}
                                    >
                                        {selectedIps.size === results.length &&
                                        results.length > 0 ? (
                                            <CheckSquare className="w-4 h-4" />
                                        ) : (
                                            <Square className="w-4 h-4" />
                                        )}
                                    </th>
                                    <th className="p-2 font-semibold text-text-muted w-32">IP</th>
                                    <th className="p-2 font-semibold text-text-muted text-center">
                                        SSH
                                    </th>
                                    <th className="p-2 font-semibold text-text-muted text-center">
                                        Telnet
                                    </th>
                                    <th className="p-2 font-semibold text-text-muted text-center">
                                        HTTP
                                    </th>
                                    <th className="p-2 font-semibold text-text-muted text-center">
                                        HTTPS
                                    </th>
                                    <th className="p-2 font-semibold text-text-muted text-center">
                                        Rlogin
                                    </th>
                                    <th className="p-2 font-semibold text-text-muted text-center">
                                        RDP
                                    </th>
                                    <th className="p-2 font-semibold text-text-muted text-center">
                                        VNC
                                    </th>
                                    <th className="p-2 font-semibold text-text-muted">
                                        Porte aperte
                                    </th>
                                    <th className="p-2 font-semibold text-text-muted hidden md:table-cell">
                                        Porte chiuse
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.map((r, i) => (
                                    <tr
                                        key={i}
                                        className={`border-b border-border/50 hover:bg-white/5 cursor-pointer ${selectedIps.has(r.ip) ? 'bg-accent/10' : ''}`}
                                        onClick={() => toggleSelection(r.ip)}
                                    >
                                        <td className="p-2 text-text-muted">
                                            {selectedIps.has(r.ip) ? (
                                                <CheckSquare className="w-4 h-4 text-accent" />
                                            ) : (
                                                <Square className="w-4 h-4" />
                                            )}
                                        </td>
                                        <td className="p-2 font-medium font-mono">{r.ip}</td>
                                        <td
                                            className={`p-2 text-center ${r.ssh ? 'text-green-400 font-bold' : 'text-text-muted opacity-40'}`}
                                        >
                                            {r.ssh ? 'Sì' : '–'}
                                        </td>
                                        <td
                                            className={`p-2 text-center ${r.telnet ? 'text-green-400 font-bold' : 'text-text-muted opacity-40'}`}
                                        >
                                            {r.telnet ? 'Sì' : '–'}
                                        </td>
                                        <td
                                            className={`p-2 text-center ${r.http ? 'text-green-400 font-bold' : 'text-text-muted opacity-40'}`}
                                        >
                                            {r.http ? 'Sì' : '–'}
                                        </td>
                                        <td
                                            className={`p-2 text-center ${r.https ? 'text-green-400 font-bold' : 'text-text-muted opacity-40'}`}
                                        >
                                            {r.https ? 'Sì' : '–'}
                                        </td>
                                        <td
                                            className={`p-2 text-center ${r.rlogin ? 'text-green-400 font-bold' : 'text-text-muted opacity-40'}`}
                                        >
                                            {r.rlogin ? 'Sì' : '–'}
                                        </td>
                                        <td
                                            className={`p-2 text-center ${r.rdp ? 'text-green-400 font-bold' : 'text-text-muted opacity-40'}`}
                                        >
                                            {r.rdp ? 'Sì' : '–'}
                                        </td>
                                        <td
                                            className={`p-2 text-center ${r.vnc ? 'text-green-400 font-bold' : 'text-text-muted opacity-40'}`}
                                        >
                                            {r.vnc ? 'Sì' : '–'}
                                        </td>
                                        <td className="p-2 text-text-primary font-mono">
                                            {r.open_ports.join(', ')}
                                        </td>
                                        <td className="p-2 text-text-muted hidden md:table-cell text-[10px] break-words max-w-[200px] font-mono">
                                            {r.closed_ports.join(', ')}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-3 bg-surface border-t border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <label className="text-[11px] font-bold text-text-muted uppercase">
                            Protocollo:
                        </label>
                        <select
                            value={importProtocol}
                            onChange={e =>
                                setImportProtocol(e.target.value as 'SSH' | 'RDP' | 'VNC')
                            }
                            className="h-8 bg-base border border-border rounded px-2 text-sm outline-none w-24 focus:border-accent"
                        >
                            <option value="SSH">SSH</option>
                            <option value="RDP">RDP</option>
                            <option value="VNC">VNC</option>
                        </select>
                        {results.length > 0 && (
                            <span className="text-[11px] text-text-muted">
                                {results.length} host {results.length === 1 ? 'trovato' : 'trovati'}
                            </span>
                        )}
                    </div>

                    <button
                        onClick={handleBatchImport}
                        disabled={selectedIps.size === 0 || isScanning}
                        className="h-8 px-6 bg-accent text-white rounded text-sm font-bold hover:bg-accent/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-accent/20"
                    >
                        Importa ({selectedIps.size})
                    </button>
                </div>
            </div>
        </div>
    );
}
