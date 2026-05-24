// MED-5: Updated to accept typed SshFields slice instead of full CreateConnectionRequest
import type { ServerConnection, SshKey } from '../../types';
import type { SshFields } from '../../hooks/useConnectionFormState';
import { Plus, Trash2 } from 'lucide-react';

interface Props {
    ssh: SshFields;
    setSsh: <K extends keyof SshFields>(k: K, v: SshFields[K]) => void;
    editConnection?: ServerConnection | null;
    connections: ServerConnection[];
    sshKeys: SshKey[];
}

export function SshAdvancedForm({ ssh, setSsh, editConnection, connections, sshKeys }: Props) {
    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-text-muted uppercase ml-1">
                    Jump Host (ProxyJump)
                </label>
                <select
                    value={ssh.jump_host_id ?? ''}
                    onChange={e => setSsh('jump_host_id', e.target.value || null)}
                    className="input-field text-xs"
                    aria-label="Jump host"
                >
                    <option value="">None (direct connection)</option>
                    {connections
                        .filter(c => c.protocol === 'SSH' && c.id !== editConnection?.id)
                        .map(c => (
                            <option key={c.id} value={c.id}>
                                {c.name} ({c.host}:{c.port})
                            </option>
                        ))}
                </select>
            </div>

            {sshKeys.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-text-muted uppercase ml-1">
                        Vault SSH Key (overrides custom key)
                    </label>
                    <select
                        value={ssh.ssh_key_id ?? ''}
                        onChange={e => setSsh('ssh_key_id', e.target.value || null)}
                        className="input-field text-xs"
                        aria-label="Vault SSH key"
                    >
                        <option value="">None (use custom key / password)</option>
                        {sshKeys.map(k => (
                            <option key={k.id} value={k.id}>
                                {k.name} ({k.key_type})
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <label className="flex items-center gap-3 p-2 bg-base/50 rounded-lg border border-border/50 cursor-pointer hover:border-accent/30 transition-colors">
                <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border bg-base text-accent focus:ring-accent/20"
                    checked={ssh.use_ssh_agent ?? false}
                    onChange={e => setSsh('use_ssh_agent', e.target.checked)}
                    aria-label="Forward SSH agent"
                />
                <span className="text-[11px] font-medium text-text-primary">
                    Forward local SSH Agent (-A)
                </span>
            </label>

            <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-text-muted uppercase ml-1">
                    Port Forwarding (Tunnels)
                </label>
                <button
                    type="button"
                    aria-label="Add SSH tunnel"
                    onClick={() => {
                        const tunnels = ssh.ssh_tunnels ? [...ssh.ssh_tunnels] : [];
                        tunnels.push({
                            id: crypto.randomUUID(),
                            type: 'Local',
                            localPort: 8080,
                            destinationHost: 'localhost',
                            destinationPort: 80,
                        });
                        setSsh('ssh_tunnels', tunnels);
                    }}
                    className="flex items-center gap-1.5 px-2 py-1 bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors text-[10px] font-bold"
                >
                    <Plus className="w-3 h-3" /> Add Tunnel
                </button>
            </div>

            <div className="space-y-2">
                {!ssh.ssh_tunnels || ssh.ssh_tunnels.length === 0 ? (
                    <p className="text-xs text-text-muted italic px-2 py-3 bg-base/30 rounded border border-dashed border-border text-center">
                        No tunnels configured.
                    </p>
                ) : (
                    ssh.ssh_tunnels.map((tunnel, idx) => (
                        <div
                            key={tunnel.id}
                            className="p-3 bg-base/50 rounded-lg border border-border flex items-start gap-3 relative group hover:border-accent/30 transition-all"
                        >
                            <select
                                className="h-8 bg-surface border border-border rounded px-2 text-[10px] font-bold uppercase focus:outline-none focus:border-accent/50 w-[90px] shrink-0"
                                value={tunnel.type}
                                aria-label={`Tunnel ${idx + 1} type`}
                                onChange={e => {
                                    const t = [...(ssh.ssh_tunnels || [])];
                                    t[idx].type = e.target.value as 'Local' | 'Remote' | 'Dynamic';
                                    setSsh('ssh_tunnels', t);
                                }}
                            >
                                <option value="Local">Local (L)</option>
                                <option value="Remote">Remote (R)</option>
                                <option value="Dynamic">Dynamic (D)</option>
                            </select>

                            <div className="flex-1 grid grid-cols-12 gap-2 mt-0.5">
                                <div className={tunnel.type === 'Dynamic' ? 'col-span-12' : 'col-span-3'}>
                                    <input
                                        type="number"
                                        placeholder="L. Port"
                                        aria-label="Local port"
                                        className="w-full h-7 bg-surface border border-border rounded px-2 text-xs focus:outline-none focus:border-accent/50"
                                        value={tunnel.localPort || ''}
                                        onChange={e => {
                                            const t = [...(ssh.ssh_tunnels || [])];
                                            t[idx].localPort = parseInt(e.target.value) || 0;
                                            setSsh('ssh_tunnels', t);
                                        }}
                                    />
                                </div>
                                {tunnel.type !== 'Dynamic' && (
                                    <>
                                        <div className="col-span-6">
                                            <input
                                                type="text"
                                                placeholder="Dest. Host"
                                                aria-label="Destination host"
                                                className="w-full h-7 bg-surface border border-border rounded px-2 text-xs focus:outline-none focus:border-accent/50"
                                                value={tunnel.destinationHost || ''}
                                                onChange={e => {
                                                    const t = [...(ssh.ssh_tunnels || [])];
                                                    t[idx].destinationHost = e.target.value;
                                                    setSsh('ssh_tunnels', t);
                                                }}
                                            />
                                        </div>
                                        <div className="col-span-3">
                                            <input
                                                type="number"
                                                placeholder="D. Port"
                                                aria-label="Destination port"
                                                className="w-full h-7 bg-surface border border-border rounded px-2 text-xs focus:outline-none focus:border-accent/50"
                                                value={tunnel.destinationPort || ''}
                                                onChange={e => {
                                                    const t = [...(ssh.ssh_tunnels || [])];
                                                    t[idx].destinationPort = parseInt(e.target.value) || 0;
                                                    setSsh('ssh_tunnels', t);
                                                }}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>

                            <button
                                type="button"
                                aria-label="Remove tunnel"
                                onClick={() => {
                                    const t = [...(ssh.ssh_tunnels || [])];
                                    t.splice(idx, 1);
                                    setSsh('ssh_tunnels', t);
                                }}
                                className="p-1.5 mt-0.5 text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
