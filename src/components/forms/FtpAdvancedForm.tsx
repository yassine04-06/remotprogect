// MED-5: Updated to accept typed FtpFields slice instead of full CreateConnectionRequest
import type { FtpFields } from '../../hooks/useConnectionFormState';

interface Props {
    ftp: FtpFields;
    setFtp: <K extends keyof FtpFields>(k: K, v: FtpFields[K]) => void;
}

export function FtpAdvancedForm({ ftp, setFtp }: Props) {
    return (
        <label className="flex items-center gap-3 p-2 bg-base/50 rounded-lg border border-border/50 cursor-pointer hover:border-accent/30 transition-colors">
            <input
                type="checkbox"
                className="w-4 h-4 rounded border-border bg-base text-accent focus:ring-accent/20"
                checked={ftp.use_ftps ?? false}
                onChange={e => setFtp('use_ftps', e.target.checked)}
                aria-label="Use FTPS"
            />
            <span className="text-[11px] font-medium text-text-primary">
                Use FTPS (explicit TLS via AUTH TLS / STARTTLS)
            </span>
        </label>
    );
}
