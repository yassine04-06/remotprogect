import { invoke as tauriInvoke } from '@tauri-apps/api/core';

// Safe wrapper: returns a rejected promise instead of throwing synchronously
// when window.__TAURI_INTERNALS__ is not yet available (race condition on load).
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
        return tauriInvoke<T>(cmd, args);
    } catch (e) {
        return Promise.reject(e);
    }
}

// ── Network ──────────────────────────────────────────────

// Fire-and-forget — results stream via `network:progress:{scanId}` Tauri events.
export const scanNetwork = (
    scanId: string,
    startIp: string,
    endIp: string,
    ports: number[],
    timeoutMs: number
) => invoke<void>('scan_network', { scanId, startIp, endIp, ports, timeoutMs });

// LOW-A8: pass scan_id so only the targeted scan is cancelled (concurrent scans allowed)
export const cancelNetworkScan = (scanId: string) =>
    invoke<void>('cancel_network_scan', { scanId });

export const pingServer = (host: string, port: number) =>
    invoke<number>('ping_server', { host, port });

// Wake-on-LAN: sends a magic packet to wake a powered-off host on the LAN.
export const wakeOnLan = (mac: string, broadcast?: string, port?: number) =>
    invoke<void>('wake_on_lan', { mac, broadcast, port });

// Forward DNS: hostname → list of IPs.
export const dnsLookup = (host: string) =>
    invoke<string[]>('dns_lookup', { host });

// Reverse DNS: IP → hostname (PTR).
export const reverseDns = (ip: string) =>
    invoke<string>('reverse_dns', { ip });

// HIBP k-anonymity breach check. Returns breach count (0 = not found).
export const checkPasswordBreach = (password: string) =>
    invoke<number>('check_password_breach', { password });

export interface TracerouteHop {
    hop: number;
    ip: string;
    rtt_ms: number | null;
}

// Traceroute via OS tracert/traceroute. Returns parsed hops.
export const traceroute = (host: string, maxHops?: number) =>
    invoke<TracerouteHop[]>('traceroute', { host, maxHops });

// MAC → hardware vendor (from embedded OUI table). Rejects if unknown.
export const macVendorLookup = (mac: string) =>
    invoke<string>('mac_vendor_lookup', { mac });
