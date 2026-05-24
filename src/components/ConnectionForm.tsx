// MED-5: Migrated to useConnectionFormState — per-protocol typed slices replace
// the previous monolithic useState<CreateConnectionRequest> (30+ fields).
// Typing in "Name" now only re-renders components that consume the common slice.
import React, { useState, useEffect } from 'react';
import { useConnectionStore, useCredentialStore, useUIStore } from '../store';
import * as api from '../services/api';

import type { ServerConnection, SshKey } from '../types';
import { useConnectionFormState } from '../hooks/useConnectionFormState';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Terminal,
    Monitor,
    Shield,
    Loader2,
    Globe,
    Eye,
    EyeOff,
    FolderSync,
    FolderOpen,
    Server,
    Box,
} from 'lucide-react';
import { SshAdvancedForm } from './forms/SshAdvancedForm';
import { RdpAdvancedForm } from './forms/RdpAdvancedForm';
import { FtpAdvancedForm } from './forms/FtpAdvancedForm';
import { DockerAdvancedForm } from './forms/DockerAdvancedForm';
import { ProxmoxAdvancedForm } from './forms/ProxmoxAdvancedForm';

interface Props {
    editConnection?: ServerConnection | null;
    onClose: () => void;
}

export const ConnectionForm: React.FC<Props> = ({ editConnection, onClose }) => {
    const groups = useConnectionStore(s => s.groups);
    const connections = useConnectionStore(s => s.connections);
    const credentialProfiles = useCredentialStore(s => s.credentialProfiles);
    const addToast = useUIStore(s => s.addToast);
    const createConnection = useConnectionStore(s => s.createConnection);
    const updateConnection = useConnectionStore(s => s.updateConnection);

    // MED-5: per-protocol slices — each slice only re-renders its own consumers
    const {
        common, ssh, rdp, ftp, docker, proxmox,
        setCommon, setSsh, setRdp, setFtp, setDocker, setProxmox,
        toRequest, loadFromConnection,
    } = useConnectionFormState(editConnection);

    const [showAdvanced, setShowAdvanced] = useState(false);
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [privateKey, setPrivateKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    // 90-1 / 90-2: SSH vault keys
    const [sshKeys, setSshKeys] = useState<SshKey[]>([]);

    useEffect(() => {
        if (editConnection) {
            loadFromConnection(editConnection);
        }
    }, [editConnection, loadFromConnection]);

    // 90-1: load vault SSH keys for the key selector
    useEffect(() => {
        api.sshKeyList().then(setSshKeys).catch(() => {});
    }, []);

    // 90-22: ESC closes the modal
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const handleProtocolChange = (p: typeof common.protocol) => {
        setCommon('protocol', p);
        if (p === 'SSH' || p === 'SFTP') setCommon('port', 22);
        else if (p === 'RDP') setCommon('port', 3389);
        else if (p === 'VNC') setCommon('port', 5900);
        else if (p === 'FTP') setCommon('port', 21);
        else if (p === 'PROXMOX') {
            setCommon('port', 8006);
            if (!common.username || common.username === 'docker') setCommon('username', 'root@pam');
        } else if (p === 'DOCKER') {
            setCommon('port', 2375);
            if (!common.username || common.username === 'root@pam') setCommon('username', 'docker');
        }
    };

    const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); void doSubmit(); };

    const doSubmit = async () => {
        const errs: Record<string, string> = {};
        if (!common.name.trim()) errs.name = 'Name is required';
        if (!common.host.trim()) errs.host = 'Host is required';
        if (!common.username.trim()) errs.username = 'Username is required';
        if (common.port < 1 || common.port > 65535) errs.port = 'Invalid port';

        if (Object.keys(errs).length > 0) {
            setErrors(errs);
            return;
        }

        setLoading(true);
        try {
            // CRIT-1 fix: send plaintext to the server; encryption happens
            // inside create_connection / update_connection (server-side).
            const req = toRequest() as ReturnType<typeof toRequest> & {
                password_plaintext?: string;
                private_key_plaintext?: string;
            };
            if (password) {
                req.password_plaintext = password;
                req.password_encrypted = undefined;
            }
            if (privateKey && common.protocol === 'SSH' && ssh.use_private_key) {
                req.private_key_plaintext = privateKey;
                req.private_key_encrypted = undefined;
            }

            if (editConnection) {
                await updateConnection({ ...req, id: editConnection.id });
                addToast({ type: 'success', title: 'Connection updated', description: common.name });
            } else {
                await createConnection(req);
                addToast({ type: 'success', title: 'Connection created', description: common.name });
            }
            onClose();
        } catch (err) {
            addToast({
                type: 'error',
                title: editConnection ? 'Update failed' : 'Create failed',
                description: String(err),
            });
        } finally {
            setLoading(false);
        }
    };

    const selectedProfile = credentialProfiles.find(p => p.id === common.credential_profile_id);
    const isUsingProfile = !common.override_credentials && selectedProfile;

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden"
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div
                            className={`p-2 rounded-xl ${
                                common.protocol === 'SSH'
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : common.protocol === 'RDP'
                                      ? 'bg-blue-500/10 text-blue-400'
                                      : common.protocol === 'SFTP'
                                        ? 'bg-cyan-500/10 text-cyan-400'
                                        : common.protocol === 'FTP'
                                          ? 'bg-orange-500/10 text-orange-400'
                                          : common.protocol === 'PROXMOX'
                                            ? 'bg-pink-500/10 text-pink-400'
                                            : common.protocol === 'DOCKER'
                                              ? 'bg-sky-500/10 text-sky-400'
                                              : 'bg-purple-500/10 text-purple-400'
                            }`}
                        >
                            {common.protocol === 'SSH' ? (
                                <Terminal className="w-5 h-5" />
                            ) : common.protocol === 'RDP' ? (
                                <Monitor className="w-5 h-5" />
                            ) : common.protocol === 'SFTP' ? (
                                <FolderSync className="w-5 h-5" />
                            ) : common.protocol === 'FTP' ? (
                                <FolderOpen className="w-5 h-5" />
                            ) : common.protocol === 'PROXMOX' ? (
                                <Server className="w-5 h-5" />
                            ) : common.protocol === 'DOCKER' ? (
                                <Box className="w-5 h-5" />
                            ) : (
                                <Globe className="w-5 h-5" />
                            )}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-text-primary">
                                {editConnection ? 'Configure Connection' : 'Register Connection'}
                            </h2>
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mt-0.5">
                                Secure Vault Node
                            </p>
                        </div>
                    </div>
                    <button
                        aria-label="Close"
                        className="p-2 hover:bg-white/5 rounded-full transition-colors"
                        onClick={onClose}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form
                    onSubmit={handleSubmit}
                    className="p-8 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar"
                >
                    <div className="grid grid-cols-2 gap-6">
                        <div className="flex flex-col gap-2 col-span-2">
                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                Display Name
                            </label>
                            <input
                                className={`h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50${errors.name ? ' border-red-500' : ''}`}
                                value={common.name}
                                onChange={e => setCommon('name', e.target.value)}
                                placeholder="Production Server"
                                autoFocus
                            />
                            {errors.name && (
                                <p className="text-red-500 text-[10px] uppercase font-bold ml-1 mt-1">
                                    {errors.name}
                                </p>
                            )}
                        </div>

                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                Protocol
                            </label>
                            <select
                                className="h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50 text-sm"
                                value={common.protocol}
                                onChange={e => handleProtocolChange(e.target.value as typeof common.protocol)}
                            >
                                <option value="SSH">Secure Shell (SSH)</option>
                                <option value="RDP">Remote Desktop (RDP)</option>
                                <option value="VNC">VNC (Virtual Network Computing)</option>
                                <option value="SFTP">Secure File Transfer (SFTP)</option>
                                <option value="FTP">File Transfer Protocol (FTP)</option>
                                <option value="PROXMOX">Proxmox VE Cluster</option>
                                <option value="DOCKER">Docker Engine (TCP)</option>
                            </select>
                        </div>

                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                Vault Group
                            </label>
                            <select
                                className="h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50 text-sm"
                                value={common.group_id ?? ''}
                                onChange={e => setCommon('group_id', e.target.value || null)}
                            >
                                <option value="">— Uncategorized —</option>
                                {groups.map(g => (
                                    <option key={g.id} value={g.id}>
                                        {g.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 py-2 opacity-50">
                        <div className="h-px bg-border flex-1" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                            Network Topology
                        </span>
                        <div className="h-px bg-border flex-1" />
                    </div>

                    <div className="grid grid-cols-12 gap-6">
                        <div className="flex flex-col gap-2 col-span-8">
                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                Host Interface (IP/FQDN)
                            </label>
                            <input
                                className={`h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50${errors.host ? ' border-red-500' : ''}`}
                                value={common.host}
                                onChange={e => setCommon('host', e.target.value)}
                                placeholder="10.0.0.1"
                            />
                            {errors.host && (
                                <p className="text-red-500 text-[10px] uppercase font-bold ml-1 mt-1">
                                    {errors.host}
                                </p>
                            )}
                        </div>
                        <div className="flex flex-col gap-2 col-span-4">
                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                TCP Port
                            </label>
                            <input
                                type="number"
                                className={`h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50${errors.port ? ' border-red-500' : ''}`}
                                value={common.port}
                                onChange={e => setCommon('port', parseInt(e.target.value) || 22)}
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-4 py-2 opacity-50">
                        <div className="h-px bg-border flex-1" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                            Security Settings
                        </span>
                        <div className="h-px bg-border flex-1" />
                    </div>

                    <div className="flex flex-col gap-4 bg-base/30 p-4 rounded-xl border border-border">
                        <div className="flex gap-6">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    className="accent-accent"
                                    checked={!common.override_credentials}
                                    onChange={() => setCommon('override_credentials', false)}
                                />
                                <span className="text-sm font-semibold">
                                    Use Credential Profile
                                </span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    className="accent-accent"
                                    checked={!!common.override_credentials}
                                    onChange={() => setCommon('override_credentials', true)}
                                />
                                <span className="text-sm font-semibold text-text-muted">
                                    Custom Local Credentials
                                </span>
                            </label>
                        </div>

                        {!common.override_credentials && (
                            <div className="flex flex-col gap-2 mt-2">
                                <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                    Select Profile
                                </label>
                                <select
                                    className="h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50 text-sm"
                                    value={common.credential_profile_id ?? ''}
                                    onChange={e => setCommon('credential_profile_id', e.target.value)}
                                >
                                    <option value="" disabled>
                                        -- Select a Profile --
                                    </option>
                                    {credentialProfiles.map(p => (
                                        <option key={p.id} value={p.id}>
                                            {p.name} ({p.type})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    <div
                        className={`space-y-6 ${isUsingProfile ? 'opacity-50 pointer-events-none grayscale-[0.5]' : ''}`}
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {common.protocol === 'RDP' && (
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                        Domain
                                    </label>
                                    <input
                                        className="h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50"
                                        value={
                                            isUsingProfile
                                                ? selectedProfile.domain || ''
                                                : (rdp.domain ?? '')
                                        }
                                        onChange={e => setRdp('domain', e.target.value)}
                                        placeholder="CORP (Optional)"
                                        readOnly={!!isUsingProfile}
                                    />
                                </div>
                            )}
                            <div
                                className={`flex flex-col gap-2 ${common.protocol !== 'RDP' ? 'md:col-span-2' : ''}`}
                            >
                                <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                    Principal Username {isUsingProfile ? '(From Profile)' : ''}
                                </label>
                                <input
                                    className={`h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50${errors.username && !isUsingProfile ? ' border-red-500' : ''}`}
                                    value={
                                        isUsingProfile
                                            ? selectedProfile.username || ''
                                            : common.username
                                    }
                                    onChange={e => setCommon('username', e.target.value)}
                                    placeholder={
                                        common.protocol === 'PROXMOX'
                                            ? 'root@pam'
                                            : common.protocol === 'DOCKER'
                                              ? 'docker'
                                              : 'administrator'
                                    }
                                    readOnly={!!isUsingProfile}
                                />
                                {errors.username && !isUsingProfile && (
                                    <p className="text-red-500 text-[10px] uppercase font-bold ml-1 mt-1">
                                        {errors.username}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            {(common.protocol === 'SSH' || common.protocol === 'SFTP') && (
                                <div className="space-y-6">
                                    <div className="flex flex-col gap-2">
                                        <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                            Authentication Strategy
                                        </label>
                                        <div className="flex gap-2 p-1 bg-base/50 rounded-xl border border-border">
                                            <button
                                                type="button"
                                                onClick={() => setSsh('use_private_key', false)}
                                                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${!ssh.use_private_key ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'text-text-muted hover:text-text-primary'}`}
                                            >
                                                Standard Password
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSsh('use_private_key', true)}
                                                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${ssh.use_private_key ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'text-text-muted hover:text-text-primary'}`}
                                            >
                                                RSA Private Key
                                            </button>
                                        </div>
                                    </div>

                                    {!ssh.use_private_key ? (
                                        <div className="flex flex-col gap-2">
                                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                                Account Password{' '}
                                                {isUsingProfile ? '(From Profile)' : ''}
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type={
                                                        showPassword && !isUsingProfile
                                                            ? 'text'
                                                            : 'password'
                                                    }
                                                    className="h-10 w-full bg-base border border-border rounded-lg px-3 pr-10 focus:outline-none focus:border-accent/50 text-sm disabled:bg-base/50"
                                                    value={
                                                        isUsingProfile
                                                            ? selectedProfile.password_encrypted
                                                                ? '********'
                                                                : ''
                                                            : password
                                                    }
                                                    onChange={e => setPassword(e.target.value)}
                                                    placeholder={
                                                        editConnection?.password_encrypted
                                                            ? '•••••••• (STORED)'
                                                            : '••••••••'
                                                    }
                                                    readOnly={!!isUsingProfile}
                                                />
                                                {!isUsingProfile && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setShowPassword(!showPassword)
                                                        }
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                                    >
                                                        {showPassword ? (
                                                            <EyeOff className="w-4 h-4" />
                                                        ) : (
                                                            <Eye className="w-4 h-4" />
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                            {editConnection?.password_encrypted &&
                                                !password &&
                                                !isUsingProfile && (
                                                    <p className="text-[9px] text-accent/60 font-medium ml-1">
                                                        Leave empty to keep current password
                                                    </p>
                                                )}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                                Private Key (Internal Identity Path){' '}
                                                {isUsingProfile ? '(From Profile)' : ''}
                                            </label>
                                            <input
                                                type="text"
                                                className="h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50 text-xs font-mono disabled:bg-base/50"
                                                value={
                                                    isUsingProfile
                                                        ? selectedProfile.private_key_encrypted
                                                            ? '********'
                                                            : ''
                                                        : privateKey
                                                }
                                                onChange={e => setPrivateKey(e.target.value)}
                                                placeholder={
                                                    editConnection
                                                        ? '(unchanged)'
                                                        : 'C:\\Users\\admin\\.ssh\\id_rsa'
                                                }
                                                readOnly={!!isUsingProfile}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}

                            {(common.protocol === 'RDP' ||
                                common.protocol === 'VNC' ||
                                common.protocol === 'FTP' ||
                                common.protocol === 'PROXMOX' ||
                                common.protocol === 'DOCKER') && (
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs font-semibold text-text-muted uppercase ml-1">
                                        Vaulted Password {isUsingProfile ? '(From Profile)' : ''}
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={
                                                showPassword && !isUsingProfile
                                                    ? 'text'
                                                    : 'password'
                                            }
                                            className="h-10 w-full bg-base border border-border rounded-lg px-3 pr-10 focus:outline-none focus:border-accent/50 text-sm disabled:bg-base/50"
                                            value={
                                                isUsingProfile
                                                    ? selectedProfile.password_encrypted
                                                        ? '********'
                                                        : ''
                                                    : password
                                            }
                                            onChange={e => setPassword(e.target.value)}
                                            placeholder={
                                                editConnection?.password_encrypted
                                                    ? '•••••••• (STORED)'
                                                    : '••••••••'
                                            }
                                            readOnly={!!isUsingProfile}
                                        />
                                        {!isUsingProfile && (
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                            >
                                                {showPassword ? (
                                                    <EyeOff className="w-4 h-4" />
                                                ) : (
                                                    <Eye className="w-4 h-4" />
                                                )}
                                            </button>
                                        )}
                                    </div>
                                    {editConnection?.password_encrypted &&
                                        !password &&
                                        !isUsingProfile && (
                                            <p className="text-[9px] text-accent/60 font-medium ml-1">
                                                Leave empty to keep current password
                                            </p>
                                        )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-4">
                        <button
                            type="button"
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-text-muted hover:text-accent transition-colors"
                        >
                            <div
                                className={`p-1 rounded bg-base border border-border transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                            >
                                <Shield className="w-3 h-3" />
                            </div>
                            Advanced Connection Parameters
                        </button>

                        <AnimatePresence>
                            {showAdvanced && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden"
                                >
                                    <div className="p-4 bg-base/30 border border-border rounded-xl space-y-4">
                                        {common.protocol === 'RDP' && (
                                            <RdpAdvancedForm rdp={rdp} setRdp={setRdp} />
                                        )}
                                        {(common.protocol === 'SSH' || common.protocol === 'SFTP') && (
                                            <SshAdvancedForm
                                                ssh={ssh}
                                                setSsh={setSsh}
                                                editConnection={editConnection}
                                                connections={connections}
                                                sshKeys={sshKeys}
                                            />
                                        )}
                                        {common.protocol === 'FTP' && (
                                            <FtpAdvancedForm ftp={ftp} setFtp={setFtp} />
                                        )}
                                        {common.protocol === 'DOCKER' && (
                                            <DockerAdvancedForm docker={docker} setDocker={setDocker} />
                                        )}
                                        {common.protocol === 'PROXMOX' && (
                                            <ProxmoxAdvancedForm
                                                proxmox={proxmox}
                                                setProxmox={setProxmox}
                                                editConnection={editConnection}
                                            />
                                        )}

                                        <div className="space-y-3">
                                            <label className="text-[10px] font-bold text-text-muted uppercase ml-1">
                                                Display Topology
                                            </label>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="flex flex-col gap-1.5">
                                                    <label className="text-[9px] font-bold text-text-muted ml-1">
                                                        WIDTH (PX)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        className="h-9 bg-base border border-border rounded-lg px-3 text-sm"
                                                        value={rdp.rdp_width ?? 1920}
                                                        onChange={e =>
                                                            setRdp('rdp_width', parseInt(e.target.value))
                                                        }
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-1.5">
                                                    <label className="text-[9px] font-bold text-text-muted ml-1">
                                                        HEIGHT (PX)
                                                    </label>
                                                    <input
                                                        type="number"
                                                        className="h-9 bg-base border border-border rounded-lg px-3 text-sm"
                                                        value={rdp.rdp_height ?? 1080}
                                                        onChange={e =>
                                                            setRdp('rdp_height', parseInt(e.target.value))
                                                        }
                                                    />
                                                </div>
                                            </div>
                                            <label className="flex items-center gap-3 p-2 bg-base/50 rounded-lg border border-border/50 cursor-pointer hover:border-accent/30 transition-colors">
                                                <input
                                                    type="checkbox"
                                                    className="w-4 h-4 rounded border-border bg-base text-accent focus:ring-accent/20"
                                                    checked={rdp.rdp_fullscreen ?? false}
                                                    onChange={e =>
                                                        setRdp('rdp_fullscreen', e.target.checked)
                                                    }
                                                />
                                                <span className="text-[11px] font-medium text-text-primary">
                                                    Engage Fullscreen Mode on Initialization
                                                </span>
                                            </label>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {/* 90-7: Tags */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-text-muted uppercase ml-1">Tags (comma-separated)</label>
                        <input
                            type="text"
                            className="h-9 bg-base border border-border rounded-lg px-3 text-sm text-text-primary outline-none focus:border-accent"
                            value={common.tags ?? ''}
                            onChange={e => setCommon('tags', e.target.value || null)}
                            placeholder="e.g. production, web, aws"
                        />
                    </div>

                    {/* 90-8: Notes */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-text-muted uppercase ml-1">Notes</label>
                        <textarea
                            rows={3}
                            className="bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent resize-none"
                            value={common.notes ?? ''}
                            onChange={e => setCommon('notes', e.target.value || null)}
                            placeholder="Server notes, maintenance info, credentials hints…"
                        />
                    </div>

                    <div className="p-4 bg-accent/5 rounded-2xl border border-accent/10 flex gap-4">
                        <Shield className="w-5 h-5 text-accent shrink-0" />
                        <p className="text-[11px] text-text-muted leading-relaxed">
                            All credentials entered here are encrypted using{' '}
                            <strong>AES-256-GCM</strong> before being committed to the vault
                            database. NexoRC does not store plaintext local buffers.
                        </p>
                    </div>
                </form>

                <div className="px-6 py-4 bg-base/50 border-t border-border flex justify-end gap-3">
                    <button
                        type="button"
                        className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary transition-colors"
                        onClick={onClose}
                    >
                        Discard
                    </button>
                    <button
                        type="button"
                        className="px-6 py-2 bg-accent text-white rounded-lg font-bold text-sm hover:bg-accent/90 transition-all disabled:opacity-50 shadow-lg shadow-accent/20"
                        onClick={() => void doSubmit()}
                        disabled={loading}
                    >
                        {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                        ) : editConnection ? (
                            'Update Metadata'
                        ) : (
                            'Initialize Node'
                        )}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};
