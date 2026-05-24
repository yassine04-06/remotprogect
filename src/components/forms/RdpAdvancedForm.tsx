// MED-5: Updated to accept typed RdpFields slice instead of full CreateConnectionRequest
import type { RdpFields } from '../../hooks/useConnectionFormState';

interface Props {
    rdp: RdpFields;
    setRdp: <K extends keyof RdpFields>(k: K, v: RdpFields[K]) => void;
}

export function RdpAdvancedForm({ rdp, setRdp }: Props) {
    return (
        <>
            <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-text-muted uppercase ml-1">
                    Color Depth
                </label>
                <select
                    className="h-9 bg-base border border-border rounded-lg px-3 text-xs focus:outline-none focus:border-accent/50"
                    value={rdp.rdp_color_depth ?? 24}
                    aria-label="RDP color depth"
                    onChange={e => setRdp('rdp_color_depth', parseInt(e.target.value))}
                >
                    <option value={15}>15-bit High Color</option>
                    <option value={16}>16-bit High Color</option>
                    <option value={24}>24-bit True Color</option>
                    <option value={32}>32-bit Highest Color</option>
                </select>
            </div>

            <div className="space-y-2">
                <label className="text-[10px] font-bold text-text-muted uppercase ml-1">
                    Redirection
                </label>
                <div className="grid grid-cols-1 gap-2">
                    {(
                        [
                            { id: 'rdp_redirect_audio',    label: 'Remote Audio Redirection' },
                            { id: 'rdp_redirect_drives',   label: 'Local Disk Drive Mapping' },
                            { id: 'rdp_redirect_printers', label: 'Client Side Printer Passthrough' },
                        ] as { id: keyof RdpFields; label: string }[]
                    ).map(opt => (
                        <label
                            key={opt.id}
                            className="flex items-center gap-3 p-2 bg-base/50 rounded-lg border border-border/50 cursor-pointer hover:border-accent/30 transition-colors"
                        >
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-border bg-base text-accent focus:ring-accent/20"
                                checked={(rdp[opt.id] as boolean) ?? false}
                                onChange={e => setRdp(opt.id, e.target.checked as RdpFields[typeof opt.id])}
                                aria-label={opt.label}
                            />
                            <span className="text-[11px] font-medium text-text-primary">{opt.label}</span>
                        </label>
                    ))}
                </div>
            </div>

            <label className="flex items-center gap-3 p-2 bg-base/50 rounded-lg border border-border/50 cursor-pointer hover:border-accent/30 transition-colors">
                <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border bg-base text-accent focus:ring-accent/20"
                    checked={rdp.rdp_nla ?? false}
                    onChange={e => setRdp('rdp_nla', e.target.checked)}
                    aria-label="Network Level Authentication"
                />
                <span className="text-[11px] font-medium text-text-primary">
                    Network Level Authentication (NLA / authenticationlevel:2)
                </span>
            </label>
        </>
    );
}
