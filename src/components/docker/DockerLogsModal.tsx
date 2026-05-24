// 90-19: Extracted from DockerView — logs modal with self-contained fetch + copy
import React, { useEffect, useState } from 'react';
import { ServerConnection, DockerContainer } from '../../types';
import * as api from '../../services/api';
import { FileText, X, Copy, Check, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';

interface Props {
    connection: ServerConnection;
    container: DockerContainer;
    onClose: () => void;
}

export const DockerLogsModal: React.FC<Props> = ({ connection, container, onClose }) => {
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        setContent('');
        setLoading(true);
        api
            .dockerGetLogs(
                connection.host,
                connection.port,
                container.Id,
                300,
                connection.docker_transport,
                connection.docker_socket_path,
                connection.docker_tls_ca_path,
                connection.docker_tls_cert_path,
                connection.docker_tls_key_path,
            )
            .then(text => setContent(text || '(no output)'))
            .catch(err => setContent(`Error fetching logs: ${String(err)}`))
            .finally(() => setLoading(false));
    }, [container.Id, connection]);

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const name = container.Names[0]?.replace('/', '') || container.Id.substring(0, 12);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={e => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-surface rounded-2xl border border-border w-full max-w-4xl max-h-[80vh] flex flex-col shadow-2xl"
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div className="flex items-center gap-3">
                        <FileText className="w-5 h-5 text-accent" />
                        <div>
                            <h3 className="font-bold text-text-primary">{name}</h3>
                            <p className="text-xs text-text-muted font-mono">{container.Image}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCopy}
                            aria-label="Copy logs"
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-surface border border-border rounded-lg text-text-muted hover:text-text-primary transition-colors"
                        >
                            {copied ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                                <Copy className="w-3.5 h-3.5" />
                            )}
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                        <button
                            onClick={onClose}
                            aria-label="Close logs"
                            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-base rounded-lg transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 min-h-0">
                    {loading ? (
                        <div className="flex items-center justify-center py-12 text-text-muted">
                            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                            Loading logs...
                        </div>
                    ) : (
                        <pre className="text-xs font-mono text-text-primary/90 whitespace-pre-wrap break-all leading-relaxed">
                            {content}
                        </pre>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
};
