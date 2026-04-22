import React, { useState, useEffect } from 'react';
import { useConnectionStore, useCredentialStore, useUIStore } from '../store';
import * as api from '../services/api';

import type { ServerConnection, CreateConnectionRequest } from '../types';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Terminal, Monitor, Shield, Loader2, Globe, Eye, EyeOff, FolderSync, FolderOpen, Plus, Trash2, Server, Box } from 'lucide-react';

interface Props {
    editConnection?: ServerConnection | null;
    onClose: () => void;
}

export const ConnectionForm: React.FC<Props> = ({ editConnection, onClose }) => {
    const groups = useConnectionStore(s => s.groups);
    const credentialProfiles = useCredentialStore(s => s.credentialProfiles);
    const addToast = useUIStore(s => s.addToast);
    const createConnection = useConnectionStore(s => s.createConnection);
    const updateConnection = useConnectionStore(s => s.updateConnection);
    const [form, setForm] = useState<CreateConnectionRequest>({
        name: '',
        host: '',
        port: 22,
        protocol: 'SSH',
        username: '',
        password_encrypted: null,
        private_key_encrypted: null,
        group_id: null,
        use_private_key: false,
        rdp_width: 1920,
        rdp_height: 1080,
        rdp_fullscreen: false,
        domain: '',
        rdp_color_depth: 24,
        rdp_redirect_audio: false,
        rdp_redirect_printers: false,
        rdp_redirect_drives: false,
        ssh_tunnels: [],
        credential_profile_id: null,
        override_credentials: false,
    });

    const [showAdvanced, setShowAdvanced] = useState(false);

    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [privateKey, setPrivateKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (editConnection) {
            setForm({ ...editConnection });
        }
    }, [editConnection]);

    const setField = <K extends keyof CreateConnectionRequest>(key: K, value: CreateConnectionRequest[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const errs: Record<string, string> = {};
        if (!form.name.trim()) errs.name = 'Name is required';
        if (!form.host.trim()) errs.host = 'Host is required';
        if (!form.username.trim()) errs.username = 'Username is required';
        if (form.port < 1 || form.port > 65535) errs.port = 'Invalid port';

        if (Object.keys(errs).length > 0) {
            setErrors(errs);
            return;
        }

        setLoading(true);
        try {
            const finalForm = { ...form };
            if (password) {
                finalForm.password_encrypted = await api.encryptValue(password);
            }
            if (privateKey && finalForm.protocol === 'SSH' && finalForm.use_private_key) {
                finalForm.private_key_encrypted = await api.encryptValue(privateKey);
            }

            if (editConnection) {
                await updateConnection({ ...finalForm, id: editConnection.id });
                addToast({ type: 'success', title: 'Connection updated', description: finalForm.name });
            } else {
                await createConnection(finalForm);
                addToast({ type: 'success', title: 'Connection created', description: finalForm.name });
            }
            onClose();
        } catch (err) {
            // Error toast is handled by the store
        } finally {
            setLoading(false);
        }
    };

    const selectedProfile = credentialProfiles.find(p => p.id === form.credential_profile_id);
    const isUsingProfile = !form.override_credentials && selectedProfile;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden"
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
                <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${form.protocol === 'SSH' ? 'bg-emerald-500/10 text-emerald-400' :
                            form.protocol === 'RDP' ? 'bg-blue-500/10 text-blue-400' :
                                form.protocol === 'SFTP' ? 'bg-cyan-500/10 text-cyan-400' :
                                    form.protocol === 'FTP' ? 'bg-orange-500/10 text-orange-400' :
                                        form.protocol === 'PROXMOX' ? 'bg-pink-500/10 text-pink-400' :
                                            form.protocol === 'DOCKER' ? 'bg-sky-500/10 text-sky-400' :
                                                'bg-purple-500/10 text-purple-400'
                            }`}>
                            {form.protocol === 'SSH' ? <Terminal className="w-5 h-5" /> :
                                form.protocol === 'RDP' ? <Monitor className="w-5 h-5" /> :
                                    form.protocol === 'SFTP' ? <FolderSync className="w-5 h-5" /> :
                                        form.protocol === 'FTP' ? <FolderOpen className="w-5 h-5" /> :
                                            form.protocol === 'PROXMOX' ? <Server className="w-5 h-5" /> :
                                                form.protocol === 'DOCKER' ? <Box className="w-5 h-5" /> :
                                                    <Globe className="w-5 h-5" />}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-text-primary">{editConnection ? 'Configure Connection' : 'Register Connection'}</h2>
                            <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mt-0.5">Secure Vault Node</p>
                        </div>
                    </div>
                    <button className="p-2 hover:bg-white/5 rounded-full transition-colors" onClick={onClose}><X className="w-5 h-5" /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-2 gap-6">
                        <div className="flex flex-col gap-2 col-span-2">
                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">Display Name</label>
                            <input className={`h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50${errors.name ? ' border-red-500' : ''}`} value={form.name}
                                onChange={(e) => setField('name', e.target.value)} placeholder="Production Server" autoFocus />
                            {errors.name && <p className="text-red-500 text-[10px] uppercase font-bold ml-1 mt-1">{errors.name}</p>}
                        </div>

                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">Protocol</label>
                            <select className="h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50 text-sm" value={form.protocol}
                                onChange={(e) => {
                                    const p = e.target.value as 'SSH' | 'RDP' | 'VNC' | 'SFTP' | 'FTP' | 'PROXMOX' | 'DOCKER';
                                    setField('protocol', p);
                                    if (p === 'SSH' || p === 'SFTP') setField('port', 22);
                                    else if (p === 'RDP') setField('port', 3389);
                                    else if (p === 'VNC') setField('port', 5900);
                                    else if (p === 'FTP') setField('port', 21);
                                    else if (p === 'PROXMOX') {
                                        setField('port', 8006);
                                        if (!form.username || form.username === 'docker') setField('username', 'root@pam');
                                    } else if (p === 'DOCKER') {
                                        setField('port', 2375);
                                        if (!form.username || form.username === 'root@pam') setField('username', 'docker');
                                    }
                                }}>
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
                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">Vault Group</label>
                            <select className="h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50 text-sm" value={form.group_id ?? ''}
                                onChange={(e) => setField('group_id', e.target.value || null)}>
                                <option value="">— Uncategorized —</option>
                                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 py-2 opacity-50">
                        <div className="h-px bg-border flex-1" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">Network Topology</span>
                        <div className="h-px bg-border flex-1" />
                    </div>

                    <div className="grid grid-cols-12 gap-6">
                        <div className="flex flex-col gap-2 col-span-8">
                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">Host Interface (IP/FQDN)</label>
                            <input className={`h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50${errors.host ? ' border-red-500' : ''}`} value={form.host}
                                onChange={(e) => setField('host', e.target.value)} placeholder="10.0.0.1" />
                            {errors.host && <p className="text-red-500 text-[10px] uppercase font-bold ml-1 mt-1">{errors.host}</p>}
                        </div>
                        <div className="flex flex-col gap-2 col-span-4">
                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">TCP Port</label>
                            <input type="number" className={`h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50${errors.port ? ' border-red-500' : ''}`}
                                value={form.port} onChange={(e) => setField('port', parseInt(e.target.value) || 22)} />
                        </div>
                    </div>

                    <div className="flex items-center gap-4 py-2 opacity-50">
                        <div className="h-px bg-border flex-1" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em]">Security Settings</span>
                        <div className="h-px bg-border flex-1" />
                    </div>

                    <div className="flex flex-col gap-4 bg-base/30 p-4 rounded-xl border border-border">
                        <div className="flex gap-6">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" className="accent-accent" checked={!form.override_credentials} onChange={() => setField('override_credentials', false)} />
                                <span className="text-sm font-semibold">Use Credential Profile</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" className="accent-accent" checked={!!form.override_credentials} onChange={() => setField('override_credentials', true)} />
                                <span className="text-sm font-semibold text-text-muted">Custom Local Credentials</span>
                            </label>
                        </div>

                        {!form.override_credentials && (
                            <div className="flex flex-col gap-2 mt-2">
                                <label className="text-xs font-semibold text-text-muted uppercase ml-1">Select Profile</label>
                                <select className="h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50 text-sm"
                                    value={form.credential_profile_id ?? ''}
                                    onChange={(e) => setField('credential_profile_id', e.target.value)}>
                                    <option value="" disabled>-- Select a Profile --</option>
                                    {credentialProfiles.map(p => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
                                </select>
                            </div>
                        )}
                    </div>

                    <div className={`space-y-6 ${isUsingProfile ? 'opacity-50 pointer-events-none grayscale-[0.5]' : ''}`}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {form.protocol === 'RDP' && (
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs font-semibold text-text-muted uppercase ml-1">Domain</label>
                                    <input className="h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50" value={isUsingProfile ? (selectedProfile.domain || '') : (form.domain ?? '')}
                                        onChange={(e) => setField('domain', e.target.value)} placeholder="CORP (Optional)" readOnly={!!isUsingProfile} />
                                </div>
                            )}
                            <div className={`flex flex-col gap-2 ${form.protocol !== 'RDP' ? 'md:col-span-2' : ''}`}>
                                <label className="text-xs font-semibold text-text-muted uppercase ml-1">Principal Username {isUsingProfile ? '(From Profile)' : ''}</label>
                                <input className={`h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50${errors.username && !isUsingProfile ? ' border-red-500' : ''}`} value={isUsingProfile ? (selectedProfile.username || '') : form.username}
                                    onChange={(e) => setField('username', e.target.value)} placeholder={form.protocol === 'PROXMOX' ? 'root@pam' : form.protocol === 'DOCKER' ? 'docker' : 'administrator'} readOnly={!!isUsingProfile} />
                                {errors.username && !isUsingProfile && <p className="text-red-500 text-[10px] uppercase font-bold ml-1 mt-1">{errors.username}</p>}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-6">
                            {(form.protocol === 'SSH' || form.protocol === 'SFTP') && (
                                <div className="space-y-6">
                                    <div className="flex flex-col gap-2">
                                        <label className="text-xs font-semibold text-text-muted uppercase ml-1">Authentication Strategy</label>
                                        <div className="flex gap-2 p-1 bg-base/50 rounded-xl border border-border">
                                            <button
                                                type="button"
                                                onClick={() => setField('use_private_key', false)}
                                                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${!form.use_private_key ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'text-text-muted hover:text-text-primary'}`}
                                            >
                                                Standard Password
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setField('use_private_key', true)}
                                                className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${form.use_private_key ? 'bg-accent text-white shadow-lg shadow-accent/20' : 'text-text-muted hover:text-text-primary'}`}
                                            >
                                                RSA Private Key
                                            </button>
                                        </div>
                                    </div>

                                    {!form.use_private_key ? (
                                        <div className="flex flex-col gap-2">
                                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">Account Password {isUsingProfile ? '(From Profile)' : ''}</label>
                                            <div className="relative">
                                                <input
                                                    type={showPassword && !isUsingProfile ? "text" : "password"}
                                                    className="h-10 w-full bg-base border border-border rounded-lg px-3 pr-10 focus:outline-none focus:border-accent/50 text-sm disabled:bg-base/50"
                                                    value={isUsingProfile ? (selectedProfile.password_encrypted ? '********' : '') : password}
                                                    onChange={(e) => setPassword(e.target.value)}
                                                    placeholder={editConnection && form.password_encrypted ? '•••••••• (STORED)' : '••••••••'}
                                                    readOnly={!!isUsingProfile}
                                                />
                                                {!isUsingProfile && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowPassword(!showPassword)}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                                    >
                                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                    </button>
                                                )}
                                            </div>
                                            {editConnection && form.password_encrypted && !password && !isUsingProfile && (
                                                <p className="text-[9px] text-accent/60 font-medium ml-1">Leave empty to keep current password</p>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            <label className="text-xs font-semibold text-text-muted uppercase ml-1">Private Key (Internal Identity Path) {isUsingProfile ? '(From Profile)' : ''}</label>
                                            <input type="text" className="h-10 bg-base border border-border rounded-lg px-3 focus:outline-none focus:border-accent/50 text-xs font-mono disabled:bg-base/50" value={isUsingProfile ? (selectedProfile.private_key_encrypted ? '********' : '') : privateKey}
                                                onChange={(e) => setPrivateKey(e.target.value)}
                                                placeholder={editConnection ? '(unchanged)' : 'C:\\Users\\admin\\.ssh\\id_rsa'} readOnly={!!isUsingProfile} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {(form.protocol === 'RDP' || form.protocol === 'VNC' || form.protocol === 'FTP' || form.protocol === 'PROXMOX' || form.protocol === 'DOCKER') && (
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs font-semibold text-text-muted uppercase ml-1">Vaulted Password {isUsingProfile ? '(From Profile)' : ''}</label>
                                    <div className="relative">
                                        <input
                                            type={showPassword && !isUsingProfile ? "text" : "password"}
                                            className="h-10 w-full bg-base border border-border rounded-lg px-3 pr-10 focus:outline-none focus:border-accent/50 text-sm disabled:bg-base/50"
                                            value={isUsingProfile ? (selectedProfile.password_encrypted ? '********' : '') : password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder={editConnection && form.password_encrypted ? '•••••••• (STORED)' : '••••••••'}
                                            readOnly={!!isUsingProfile}
                                        />
                                        {!isUsingProfile && (
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
                                            >
                                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        )}
                                    </div>
                                    {editConnection && form.password_encrypted && !password && !isUsingProfile && (
                                        <p className="text-[9px] text-accent/60 font-medium ml-1">Leave empty to keep current password</p>
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
                            <div className={`p-1 rounded bg-base border border-border transition-transform ${showAdvanced ? 'rotate-180' : ''}`}>
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
                                        {form.protocol === 'RDP' && (
                                            <>
                                                <div className="grid grid-cols-1 gap-4">
                                                    <div className="flex flex-col gap-1.5">
                                                        <label className="text-[10px] font-bold text-text-muted uppercase ml-1">Color Depth</label>
                                                        <select className="h-9 bg-base border border-border rounded-lg px-3 text-xs focus:outline-none focus:border-accent/50"
                                                            value={form.rdp_color_depth ?? 24} onChange={(e) => setField('rdp_color_depth', parseInt(e.target.value))}>
                                                            <option value={15}>15-bit High Color</option>
                                                            <option value={16}>16-bit High Color</option>
                                                            <option value={24}>24-bit True Color</option>
                                                            <option value={32}>32-bit Highest Color</option>
                                                        </select>
                                                    </div>
                                                </div>

                                                <div className="space-y-2">
                                                    <label className="text-[10px] font-bold text-text-muted uppercase ml-1">Redirection</label>
                                                    <div className="grid grid-cols-1 gap-2">
                                                        {[
                                                            { id: 'rdp_redirect_audio', label: 'Remote Audio Redirection' },
                                                            { id: 'rdp_redirect_drives', label: 'Local Disk Drive Mapping' },
                                                            { id: 'rdp_redirect_printers', label: 'Client Side Printer Passthrough' }
                                                        ].map((opt) => (
                                                            <label key={opt.id} className="flex items-center gap-3 p-2 bg-base/50 rounded-lg border border-border/50 cursor-pointer hover:border-accent/30 transition-colors">
                                                                <input
                                                                    type="checkbox"
                                                                    className="w-4 h-4 rounded border-border bg-base text-accent focus:ring-accent/20"
                                                                    checked={(form as any)[opt.id] ?? false}
                                                                    onChange={(e) => setField(opt.id as any, e.target.checked)}
                                                                />
                                                                <span className="text-[11px] font-medium text-text-primary">{opt.label}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {form.protocol === 'SSH' && (
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <label className="text-[10px] font-bold text-text-muted uppercase ml-1">Port Forwarding (Tunnels)</label>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const tunnels = form.ssh_tunnels ? [...form.ssh_tunnels] : [];
                                                            tunnels.push({
                                                                id: crypto.randomUUID(),
                                                                type: 'Local',
                                                                localPort: 8080,
                                                                destinationHost: 'localhost',
                                                                destinationPort: 80
                                                            });
                                                            setField('ssh_tunnels', tunnels);
                                                        }}
                                                        className="flex items-center gap-1.5 px-2 py-1 bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors text-[10px] font-bold"
                                                    >
                                                        <Plus className="w-3 h-3" /> Add Tunnel
                                                    </button>
                                                </div>

                                                <div className="space-y-2">
                                                    {(!form.ssh_tunnels || form.ssh_tunnels.length === 0) ? (
                                                        <p className="text-xs text-text-muted italic px-2 py-3 bg-base/30 rounded border border-dashed border-border text-center">No tunnels configured.</p>
                                                    ) : (
                                                        form.ssh_tunnels.map((tunnel, idx) => (
                                                            <div key={tunnel.id} className="p-3 bg-base/50 rounded-lg border border-border flex items-start gap-3 relative group transition-all hover:border-accent/30">
                                                                <select
                                                                    className="h-8 bg-surface border border-border rounded px-2 text-[10px] font-bold uppercase focus:outline-none focus:border-accent/50 w-[90px] shrink-0"
                                                                    value={tunnel.type}
                                                                    onChange={(e) => {
                                                                        const t = [...(form.ssh_tunnels || [])];
                                                                        t[idx].type = e.target.value as any;
                                                                        setField('ssh_tunnels', t);
                                                                    }}
                                                                >
                                                                    <option value="Local">Local (L)</option>
                                                                    <option value="Remote">Remote (R)</option>
                                                                    <option value="Dynamic">Dynamic (D)</option>
                                                                </select>

                                                                <div className="flex-1 grid grid-cols-12 gap-2 mt-0.5">
                                                                    <div className={`${tunnel.type === 'Dynamic' ? 'col-span-12' : 'col-span-3'}`}>
                                                                        <input
                                                                            type="number"
                                                                            placeholder="L. Port"
                                                                            title="Local Port"
                                                                            className="w-full h-7 bg-surface border border-border rounded px-2 text-xs focus:outline-none focus:border-accent/50"
                                                                            value={tunnel.localPort || ''}
                                                                            onChange={(e) => {
                                                                                const t = [...(form.ssh_tunnels || [])];
                                                                                t[idx].localPort = parseInt(e.target.value) || 0;
                                                                                setField('ssh_tunnels', t);
                                                                            }}
                                                                        />
                                                                    </div>
                                                                    {tunnel.type !== 'Dynamic' && (
                                                                        <>
                                                                            <div className="col-span-6">
                                                                                <input
                                                                                    type="text"
                                                                                    placeholder="Dest. Host"
                                                                                    className="w-full h-7 bg-surface border border-border rounded px-2 text-xs focus:outline-none focus:border-accent/50"
                                                                                    value={tunnel.destinationHost || ''}
                                                                                    onChange={(e) => {
                                                                                        const t = [...(form.ssh_tunnels || [])];
                                                                                        t[idx].destinationHost = e.target.value;
                                                                                        setField('ssh_tunnels', t);
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                            <div className="col-span-3">
                                                                                <input
                                                                                    type="number"
                                                                                    placeholder="D. Port"
                                                                                    title="Destination Port"
                                                                                    className="w-full h-7 bg-surface border border-border rounded px-2 text-xs focus:outline-none focus:border-accent/50"
                                                                                    value={tunnel.destinationPort || ''}
                                                                                    onChange={(e) => {
                                                                                        const t = [...(form.ssh_tunnels || [])];
                                                                                        t[idx].destinationPort = parseInt(e.target.value) || 0;
                                                                                        setField('ssh_tunnels', t);
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>

                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const t = [...(form.ssh_tunnels || [])];
                                                                        t.splice(idx, 1);
                                                                        setField('ssh_tunnels', t);
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
                                        )}

                                        <div className="space-y-3">
                                            <label className="text-[10px] font-bold text-text-muted uppercase ml-1">Display Topology</label>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="flex flex-col gap-1.5">
                                                    <label className="text-[9px] font-bold text-text-muted ml-1">WIDTH (PX)</label>
                                                    <input type="number" className="h-9 bg-base border border-border rounded-lg px-3 text-sm"
                                                        value={form.rdp_width ?? 1920} onChange={(e) => setField('rdp_width', parseInt(e.target.value))} />
                                                </div>
                                                <div className="flex flex-col gap-1.5">
                                                    <label className="text-[9px] font-bold text-text-muted ml-1">HEIGHT (PX)</label>
                                                    <input type="number" className="h-9 bg-base border border-border rounded-lg px-3 text-sm"
                                                        value={form.rdp_height ?? 1080} onChange={(e) => setField('rdp_height', parseInt(e.target.value))} />
                                                </div>
                                            </div>
                                            <label className="flex items-center gap-3 p-2 bg-base/50 rounded-lg border border-border/50 cursor-pointer hover:border-accent/30 transition-colors">
                                                <input
                                                    type="checkbox"
                                                    className="w-4 h-4 rounded border-border bg-base text-accent focus:ring-accent/20"
                                                    checked={form.rdp_fullscreen ?? false}
                                                    onChange={(e) => setField('rdp_fullscreen', e.target.checked)}
                                                />
                                                <span className="text-[11px] font-medium text-text-primary">Engage Fullscreen Mode on Initialization</span>
                                            </label>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <div className="p-4 bg-accent/5 rounded-2xl border border-accent/10 flex gap-4">
                        <Shield className="w-5 h-5 text-accent shrink-0" />
                        <p className="text-[11px] text-text-muted leading-relaxed">
                            All credentials entered here are encrypted using <strong>AES-256-GCM</strong> before being committed to the vault database.
                            Nexus does not store plaintext local buffers.
                        </p>
                    </div>
                </form>

                <div className="px-6 py-4 bg-base/50 border-t border-border flex justify-end gap-3">
                    <button className="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary transition-colors" onClick={onClose}>Discard</button>
                    <button
                        className="px-6 py-2 bg-accent text-white rounded-lg font-bold text-sm hover:bg-accent/90 transition-all disabled:opacity-50 shadow-lg shadow-accent/20"
                        onClick={handleSubmit as any}
                        disabled={loading}
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : editConnection ? 'Update Metadata' : 'Initialize Node'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
};
