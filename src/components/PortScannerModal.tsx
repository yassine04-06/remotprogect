import { useState } from 'react';
import { useUIStore, useConnectionStore } from '../store';
import * as api from '../services/api';
import { Search, Loader2, Server, Globe, CheckSquare, Square } from 'lucide-react';
import type { NetworkScanResult } from '../types';

const COMMON_PORTS = [22, 23, 80, 443, 513, 3389, 5900, 5901];

export function PortScannerModal({ onClose }: { onClose: () => void }) {
    const [startIp, setStartIp] = useState('192.168.15.1');
    const [endIp, setEndIp] = useState('192.168.15.254');
    const [timeout, setTimeoutVal] = useState(500); // ms internally
    const [isScanning, setIsScanning] = useState(false);
    const [results, setResults] = useState<NetworkScanResult[]>([]);
    const [selectedIps, setSelectedIps] = useState<Set<string>>(new Set());
    const [importProtocol, setImportProtocol] = useState<'SSH' | 'RDP' | 'VNC'>('SSH');

    const addToast = useUIStore(s => s.addToast);
    const groups = useConnectionStore(s => s.groups);
    const refreshData = useConnectionStore(s => s.fetchConnections);

    const handleScan = async () => {
        setIsScanning(true);
        setResults([]);
        setSelectedIps(new Set());
        try {
            const res = await api.scanNetwork(startIp, endIp, COMMON_PORTS, timeout);
            setResults(res);
            if (res.length === 0) {
                addToast({ type: 'info', title: 'Scan Complete', description: 'No active hosts found responding on those ports.' });
            }
        } catch (err) {
            addToast({ type: 'error', title: 'Scan Failed', description: String(err) });
        } finally {
            setIsScanning(false);
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
                });
                imported++;
            } catch (e) {
                console.error("Failed to import", ip, e);
            }
        }

        if (imported > 0) {
            await refreshData();
            addToast({ type: 'success', title: 'Import Complete', description: `Successfully imported ${imported} connection(s).` });
            setSelectedIps(new Set()); // Clear selection
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-6xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col" style={{ maxHeight: '90vh' }}>
                <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-base/80">
                    <div className="flex items-center gap-2">
                        <Globe className="w-5 h-5 text-accent" />
                        <h2 className="text-md font-bold text-text-primary">Port Scanner (mRemoteNG Style)</h2>
                    </div>
                    <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">✕</button>
                </div>

                <div className="p-4 bg-base border-b border-border flex flex-wrap gap-4 items-end">
                    <div className="flex flex-col gap-1 w-36">
                        <label className="text-[10px] font-bold text-text-muted uppercase">IP iniziale</label>
                        <input type="text" value={startIp} onChange={(e) => setStartIp(e.target.value)}
                            className="h-8 bg-surface border border-border rounded px-2 text-sm focus:border-accent outline-none" placeholder="192.168.1.1" />
                    </div>
                    <div className="flex flex-col gap-1 w-36">
                        <label className="text-[10px] font-bold text-text-muted uppercase">IP finale</label>
                        <input type="text" value={endIp} onChange={(e) => setEndIp(e.target.value)}
                            className="h-8 bg-surface border border-border rounded px-2 text-sm focus:border-accent outline-none" placeholder="192.168.1.254" />
                    </div>
                    <div className="flex flex-col gap-1 w-24">
                        <label className="text-[10px] font-bold text-text-muted uppercase">Timeout (ms)</label>
                        <input type="number" value={timeout} onChange={(e) => setTimeoutVal(parseInt(e.target.value) || 500)}
                            className="h-8 bg-surface border border-border rounded px-2 text-sm focus:border-accent outline-none" min={50} max={5000} />
                    </div>

                    <button
                        onClick={handleScan}
                        disabled={isScanning}
                        className="h-8 px-6 ml-auto bg-surface border border-border hover:bg-white/5 rounded text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                        {isScanning ? <Loader2 className="w-4 h-4 animate-spin text-accent" /> : <Search className="w-4 h-4 text-accent" />}
                        {isScanning ? 'Scansione in corso...' : 'Inizia Scansione'}
                    </button>
                </div>

                <div className="flex-1 overflow-auto bg-base/50 p-2 relative custom-scrollbar min-h-[400px]">
                    {isScanning && results.length === 0 && (
                        <div className="absolute inset-0 flex items-center justify-center bg-base/80 z-10">
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 animate-spin text-accent" />
                                <p className="text-sm text-text-muted font-medium animate-pulse">Scanning IP Range...</p>
                            </div>
                        </div>
                    )}

                    {results.length === 0 && !isScanning ? (
                        <div className="h-full flex flex-col items-center justify-center text-text-muted opacity-50">
                            <Server className="w-12 h-12 mb-3" />
                            <p className="text-sm">Configura l'intervallo IP e clicca Inizia Scansione per scoprire dispositivi.</p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse text-xs">
                            <thead className="sticky top-0 bg-surface/90 backdrop-blur-sm shadow z-20">
                                <tr className="border-b border-border">
                                    <th className="p-2 cursor-pointer text-text-muted hover:text-text-primary" onClick={toggleAll}>
                                        {selectedIps.size === results.length && results.length > 0 ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                                    </th>
                                    <th className="p-2 font-semibold text-text-muted w-32">Nome host / IP</th>
                                    <th className="p-2 font-semibold text-text-muted text-center">SSH</th>
                                    <th className="p-2 font-semibold text-text-muted text-center">Telnet</th>
                                    <th className="p-2 font-semibold text-text-muted text-center">HTTP</th>
                                    <th className="p-2 font-semibold text-text-muted text-center">HTTPS</th>
                                    <th className="p-2 font-semibold text-text-muted text-center">Rlogin</th>
                                    <th className="p-2 font-semibold text-text-muted text-center">RDP</th>
                                    <th className="p-2 font-semibold text-text-muted text-center">VNC</th>
                                    <th className="p-2 font-semibold text-text-muted">Porte aperte</th>
                                    <th className="p-2 font-semibold text-text-muted hidden md:table-cell">Porte chiuse</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.map((r, i) => (
                                    <tr key={i} className={`border-b border-border/50 hover:bg-white/5 cursor-pointer ${selectedIps.has(r.ip) ? 'bg-accent/10' : ''}`} onClick={() => toggleSelection(r.ip)}>
                                        <td className="p-2 text-text-muted">
                                            {selectedIps.has(r.ip) ? <CheckSquare className="w-4 h-4 text-accent" /> : <Square className="w-4 h-4" />}
                                        </td>
                                        <td className="p-2 font-medium">{r.ip}</td>
                                        <td className={`p-2 text-center ${r.ssh ? 'text-green-400 font-bold' : 'text-text-muted opacity-50'}`}>{r.ssh ? 'Sì' : 'No'}</td>
                                        <td className={`p-2 text-center ${r.telnet ? 'text-green-400 font-bold' : 'text-text-muted opacity-50'}`}>{r.telnet ? 'Sì' : 'No'}</td>
                                        <td className={`p-2 text-center ${r.http ? 'text-green-400 font-bold' : 'text-text-muted opacity-50'}`}>{r.http ? 'Sì' : 'No'}</td>
                                        <td className={`p-2 text-center ${r.https ? 'text-green-400 font-bold' : 'text-text-muted opacity-50'}`}>{r.https ? 'Sì' : 'No'}</td>
                                        <td className={`p-2 text-center ${r.rlogin ? 'text-green-400 font-bold' : 'text-text-muted opacity-50'}`}>{r.rlogin ? 'Sì' : 'No'}</td>
                                        <td className={`p-2 text-center ${r.rdp ? 'text-green-400 font-bold' : 'text-text-muted opacity-50'}`}>{r.rdp ? 'Sì' : 'No'}</td>
                                        <td className={`p-2 text-center ${r.vnc ? 'text-green-400 font-bold' : 'text-text-muted opacity-50'}`}>{r.vnc ? 'Sì' : 'No'}</td>
                                        <td className="p-2 text-text-primary">
                                            {r.open_ports.join(', ')}
                                            {r.open_ports.length > 0 && ','}
                                        </td>
                                        <td className="p-2 text-text-muted hidden md:table-cell text-[10px] break-words max-w-[200px]">
                                            {r.closed_ports.join(', ')}
                                            {r.closed_ports.length > 0 && ','}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="px-4 py-3 bg-surface border-t border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <label className="text-[11px] font-bold text-text-muted uppercase">Protocollo da importare:</label>
                        <select
                            value={importProtocol}
                            onChange={(e) => setImportProtocol(e.target.value as any)}
                            className="h-8 bg-base border border-border rounded px-2 text-sm outline-none w-32 focus:border-accent"
                        >
                            <option value="SSH">SSH2</option>
                            <option value="RDP">RDP</option>
                            <option value="VNC">VNC</option>
                        </select>
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
