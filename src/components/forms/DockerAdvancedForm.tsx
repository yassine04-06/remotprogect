// MED-5: Updated to accept typed DockerFields slice instead of full CreateConnectionRequest
import type { DockerFields } from '../../hooks/useConnectionFormState';

interface Props {
    docker: DockerFields;
    setDocker: <K extends keyof DockerFields>(k: K, v: DockerFields[K]) => void;
}

export function DockerAdvancedForm({ docker, setDocker }: Props) {
    const transport = docker.docker_transport ?? 'tcp';
    return (
        <div className="space-y-3">
            <label className="text-[10px] font-bold text-text-muted uppercase ml-1">
                Docker Transport
            </label>
            <div className="flex gap-2 p-1 bg-base/50 rounded-xl border border-border" role="group" aria-label="Docker transport">
                {(['tcp', 'socket', 'https'] as const).map(t => (
                    <button
                        key={t}
                        type="button"
                        aria-pressed={transport === t}
                        onClick={() => setDocker('docker_transport', t)}
                        className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${transport === t ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'text-text-muted hover:text-text-primary'}`}
                    >
                        {t === 'tcp' ? 'TCP' : t === 'socket' ? 'Unix Socket' : 'HTTPS (mTLS)'}
                    </button>
                ))}
            </div>
            {transport === 'socket' && (
                <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-bold text-text-muted ml-1 uppercase">
                        Socket Path
                    </label>
                    <input
                        type="text"
                        className="h-9 bg-base border border-border rounded-lg px-3 text-xs font-mono focus:outline-none focus:border-accent/50"
                        value={docker.docker_socket_path ?? ''}
                        onChange={e => setDocker('docker_socket_path', e.target.value || null)}
                        placeholder="/var/run/docker.sock"
                        aria-label="Docker socket path"
                    />
                </div>
            )}
            {transport === 'https' && (
                <div className="space-y-2">
                    <p className="text-[10px] text-text-muted ml-1">
                        Mutual-TLS for the Docker daemon on port 2376. All three PEM files are required; the key must be PKCS#8.
                    </p>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-bold text-text-muted ml-1 uppercase">
                            CA certificate (ca.pem)
                        </label>
                        <input
                            type="text"
                            className="h-9 bg-base border border-border rounded-lg px-3 text-xs font-mono focus:outline-none focus:border-accent/50"
                            value={docker.docker_tls_ca_path ?? ''}
                            onChange={e => setDocker('docker_tls_ca_path', e.target.value || null)}
                            placeholder="/path/to/ca.pem"
                            aria-label="Docker CA certificate path"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-bold text-text-muted ml-1 uppercase">
                            Client certificate (cert.pem)
                        </label>
                        <input
                            type="text"
                            className="h-9 bg-base border border-border rounded-lg px-3 text-xs font-mono focus:outline-none focus:border-accent/50"
                            value={docker.docker_tls_cert_path ?? ''}
                            onChange={e => setDocker('docker_tls_cert_path', e.target.value || null)}
                            placeholder="/path/to/cert.pem"
                            aria-label="Docker client certificate path"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-bold text-text-muted ml-1 uppercase">
                            Client key (key.pem, PKCS#8)
                        </label>
                        <input
                            type="text"
                            className="h-9 bg-base border border-border rounded-lg px-3 text-xs font-mono focus:outline-none focus:border-accent/50"
                            value={docker.docker_tls_key_path ?? ''}
                            onChange={e => setDocker('docker_tls_key_path', e.target.value || null)}
                            placeholder="/path/to/key.pem"
                            aria-label="Docker client key path"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
