import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ClipboardList, Download, FileText, RefreshCw, Loader2, ShieldCheck, ShieldAlert, ShieldOff, AlertTriangle } from 'lucide-react';
import * as api from '../../services/api';
import type { AuditEntry, AuditVerifyResult } from '../../types';

interface Props {
    onClose: () => void;
}

const ACTION_COLORS: Record<string, string> = {
    connect: 'text-green-400 bg-green-500/10',
    create: 'text-blue-400 bg-blue-500/10',
    delete: 'text-red-400 bg-red-500/10',
    unlock: 'text-yellow-400 bg-yellow-500/10',
    lock: 'text-orange-400 bg-orange-500/10',
};

function formatTs(ts: number): string {
    return new Date(ts * 1000).toLocaleString();
}

/** CRIT-A3: chain integrity banner component */
function ChainBanner({ result, onClose }: { result: AuditVerifyResult; onClose: () => void }) {
    if (result.tampered_count > 0) {
        return (
            <div className="mx-4 mt-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3">
                <ShieldAlert className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                    <p className="text-red-400 text-xs font-bold">
                        Audit log tampered — {result.tampered_count} invalid {result.tampered_count === 1 ? 'hash' : 'hashes'} detected
                    </p>
                    <p className="text-red-400/70 text-[11px] mt-0.5">
                        Hash-chain integrity broken. Rows may have been inserted, deleted, or modified outside the application.
                        {result.legacy_count > 0 && ` (${result.legacy_count} legacy pre-v13 entries excluded from check)`}
                    </p>
                </div>
                <button onClick={onClose} className="text-red-400/50 hover:text-red-400 transition-colors">
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        );
    }
    if (result.legacy_count > 0 && result.entries.length === result.legacy_count) {
        return (
            <div className="mx-4 mt-3 px-4 py-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                    <p className="text-yellow-400 text-xs font-bold">
                        Hash-chain not yet established
                    </p>
                    <p className="text-yellow-400/70 text-[11px] mt-0.5">
                        All {result.legacy_count} entries are from before v13 and cannot be verified. New entries will be hash-chained automatically.
                    </p>
                </div>
                <button onClick={onClose} className="text-yellow-400/50 hover:text-yellow-400 transition-colors">
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        );
    }
    return (
        <div className="mx-4 mt-3 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20 flex items-start gap-3">
            <ShieldCheck className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
            <div className="flex-1">
                <p className="text-green-400 text-xs font-bold">Audit log chain intact</p>
                <p className="text-green-400/70 text-[11px] mt-0.5">
                    {result.entries.length - result.legacy_count} verified {result.entries.length - result.legacy_count === 1 ? 'entry' : 'entries'}
                    {result.legacy_count > 0 && `, ${result.legacy_count} legacy (pre-v13)`}.
                    No tampering detected.
                </p>
            </div>
            <button onClick={onClose} className="text-green-400/50 hover:text-green-400 transition-colors">
                <X className="w-3.5 h-3.5" />
            </button>
        </div>
    );
}

/** Per-row chain hash indicator */
function HashBadge({ entry, verifyResult }: { entry: AuditEntry; verifyResult: AuditVerifyResult | null }) {
    if (!verifyResult) return null;
    const ve = verifyResult.entries.find(v => v.entry.id === entry.id);
    if (!ve) return null;
    if (ve.is_legacy) {
        return (
            <span title="Pre-v13 entry — hash-chain not available" className="inline-flex items-center">
                <ShieldOff className="w-3 h-3 text-text-muted opacity-50" />
            </span>
        );
    }
    if (!ve.hash_valid) {
        return (
            <span title="Hash invalid — possible tampering!" className="inline-flex items-center">
                <ShieldAlert className="w-3 h-3 text-red-400" />
            </span>
        );
    }
    return (
        <span title={`Chain hash: ${entry.chain_hash.slice(0, 12)}…`} className="inline-flex items-center">
            <ShieldCheck className="w-3 h-3 text-green-400/60" />
        </span>
    );
}

export function AuditLogModal({ onClose }: Props) {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [verifyResult, setVerifyResult] = useState<AuditVerifyResult | null>(null);
    const [verifying, setVerifying] = useState(false);
    const [showBanner, setShowBanner] = useState(false);

    const load = async () => {
        setLoading(true);
        setError(null);
        setVerifyResult(null);
        setShowBanner(false);
        try {
            setEntries(await api.auditLogList(500, 0));
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };

    const verify = async () => {
        setVerifying(true);
        try {
            const result = await api.auditLogVerify();
            setVerifyResult(result);
            setShowBanner(true);
        } catch (e) {
            setError(String(e));
        } finally {
            setVerifying(false);
        }
    };

    useEffect(() => { load(); }, []);

    // 90-22: ESC closes the modal
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const exportCsv = () => {
        const header = 'timestamp,action,entity_type,entity_name,entity_id,outcome,details\n';
        const rows = entries.map(e =>
            [formatTs(e.timestamp), e.action, e.entity_type, `"${e.entity_name}"`, e.entity_id, e.outcome, `"${e.details}"`].join(',')
        ).join('\n');
        const blob = new Blob([header + rows], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nexorc-audit-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Print-to-PDF: opens a formatted report window and triggers the browser's
    // print dialog (user picks "Save as PDF"). No PDF library dependency.
    const exportPdf = () => {
        const esc = (s: string) =>
            s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const chain = verifyResult
            ? verifyResult.chain_intact
                ? '<span style="color:#16a34a">Chain intact</span>'
                : `<span style="color:#dc2626">Chain TAMPERED — ${verifyResult.tampered_count} invalid</span>`
            : 'Not verified';
        const rows = entries.map(e => `<tr>
            <td>${esc(formatTs(e.timestamp))}</td><td>${esc(e.action)}</td>
            <td>${esc(e.entity_type)}</td><td>${esc(e.entity_name)}</td>
            <td>${esc(e.outcome)}</td><td>${esc(e.details)}</td></tr>`).join('');
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>NexoRC Audit Report</title>
            <style>
              body{font-family:system-ui,sans-serif;margin:32px;color:#111}
              h1{font-size:20px;margin:0 0 4px}
              .meta{color:#666;font-size:12px;margin-bottom:16px}
              table{width:100%;border-collapse:collapse;font-size:11px}
              th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
              th{background:#f3f4f6}
              tr:nth-child(even){background:#fafafa}
            </style></head><body>
            <h1>NexoRC — Audit Report</h1>
            <div class="meta">Generated ${new Date().toLocaleString()} · ${entries.length} entries · Integrity: ${chain}</div>
            <table><thead><tr><th>Time</th><th>Action</th><th>Type</th><th>Entity</th><th>Outcome</th><th>Details</th></tr></thead>
            <tbody>${rows}</tbody></table>
            <script>window.onload=()=>{window.print()}</script>
            </body></html>`;
        const w = window.open('', '_blank');
        if (!w) return;
        w.document.write(html);
        w.document.close();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-3xl bg-surface border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                style={{ maxHeight: '85vh' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div className="flex items-center gap-3">
                        <ClipboardList className="w-5 h-5 text-accent" />
                        <h2 className="text-base font-bold text-text-primary">Audit Log</h2>
                        <span className="text-xs text-text-muted">({entries.length} entries)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* CRIT-A3: Verify chain integrity button */}
                        <button
                            onClick={verify}
                            disabled={verifying || loading || entries.length === 0}
                            title="Verify hash-chain integrity (CRIT-A3)"
                            aria-label="Verify audit log integrity"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
                        >
                            {verifying ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : verifyResult ? (
                                verifyResult.tampered_count > 0
                                    ? <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                                    : <ShieldCheck className="w-3.5 h-3.5 text-green-400" />
                            ) : (
                                <ShieldCheck className="w-3.5 h-3.5" />
                            )}
                            <span>Verify</span>
                        </button>
                        <button onClick={load} disabled={loading} aria-label="Refresh audit log" className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors">
                            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={exportCsv} disabled={entries.length === 0} aria-label="Export as CSV" className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors">
                            <Download className="w-4 h-4" />
                        </button>
                        <button onClick={exportPdf} disabled={entries.length === 0} aria-label="Export as PDF" className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors">
                            <FileText className="w-4 h-4" />
                        </button>
                        <button onClick={onClose} aria-label="Close audit log" className="p-1.5 rounded-lg hover:bg-white/5 text-text-muted hover:text-text-primary transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* CRIT-A3: chain integrity banner */}
                <AnimatePresence>
                    {showBanner && verifyResult && (
                        <motion.div
                            key="chain-banner"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                        >
                            <ChainBanner result={verifyResult} onClose={() => setShowBanner(false)} />
                        </motion.div>
                    )}
                </AnimatePresence>

                <div className="flex-1 overflow-y-auto">
                    {error && (
                        <div className="m-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>
                    )}
                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-text-muted">
                            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
                        </div>
                    ) : entries.length === 0 ? (
                        <div className="text-center py-16 text-text-muted text-sm">
                            <ClipboardList className="w-8 h-8 mx-auto mb-3 opacity-30" />
                            <p>No audit entries yet.</p>
                        </div>
                    ) : (
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-surface border-b border-border">
                                <tr className="text-text-muted uppercase text-[10px] tracking-wider">
                                    <th className="px-4 py-2 text-left font-semibold w-40">Timestamp</th>
                                    <th className="px-3 py-2 text-left font-semibold w-24">Action</th>
                                    <th className="px-3 py-2 text-left font-semibold w-24">Type</th>
                                    <th className="px-3 py-2 text-left font-semibold">Entity</th>
                                    <th className="px-3 py-2 text-left font-semibold w-20">Outcome</th>
                                    {verifyResult && (
                                        <th className="px-3 py-2 text-center font-semibold w-12" title="Hash-chain integrity">
                                            Chain
                                        </th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map(e => (
                                    <tr
                                        key={e.id}
                                        className={`border-b border-border/30 hover:bg-white/3 transition-colors ${
                                            verifyResult?.entries.find(v => v.entry.id === e.id && !v.hash_valid && !v.is_legacy)
                                                ? 'bg-red-500/5'
                                                : ''
                                        }`}
                                    >
                                        <td className="px-4 py-2 font-mono text-text-muted whitespace-nowrap">{formatTs(e.timestamp)}</td>
                                        <td className="px-3 py-2">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${ACTION_COLORS[e.action] ?? 'text-text-muted bg-white/5'}`}>
                                                {e.action}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-text-muted">{e.entity_type}</td>
                                        <td className="px-3 py-2 text-text-primary font-medium truncate max-w-[200px]" title={e.entity_name}>{e.entity_name}</td>
                                        <td className="px-3 py-2">
                                            <span className={`text-[10px] font-bold uppercase ${e.outcome === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                                {e.outcome}
                                            </span>
                                        </td>
                                        {verifyResult && (
                                            <td className="px-3 py-2 text-center">
                                                <HashBadge entry={e} verifyResult={verifyResult} />
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </motion.div>
        </div>
    );
}
