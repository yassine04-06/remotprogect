import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, KeyRound, Search, Edit2, Trash2 } from 'lucide-react';
import { useUIStore, useCredentialStore, useConnectionStore } from '../store';
import type { CredentialProfile, CredentialType } from '../types';
import * as api from '../services/api';

export const CredentialManagerModal: React.FC = () => {
    const showCredentialManager = useUIStore(s => s.showCredentialManager);
    const setShowCredentialManager = useUIStore(s => s.setShowCredentialManager);
    const credentialProfiles = useCredentialStore(s => s.credentialProfiles);
    const connections = useConnectionStore(s => s.connections);
    const createCredentialProfile = useCredentialStore(s => s.createCredentialProfile);
    const updateCredentialProfile = useCredentialStore(s => s.updateCredentialProfile);
    const deleteCredentialProfile = useCredentialStore(s => s.deleteCredentialProfile);

    const [query, setQuery] = useState('');
    const [editingProfile, setEditingProfile] = useState<CredentialProfile | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    // Form state
    const [name, setName] = useState('');
    const [type, setType] = useState<CredentialType>('generic');
    const [description, setDescription] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [privateKey, setPrivateKey] = useState('');
    const [domain, setDomain] = useState('');

    if (!showCredentialManager) return null;

    const filteredProfiles = credentialProfiles.filter(p => {
        const q = query.toLowerCase();
        return (
            p.name.toLowerCase().includes(q) ||
            p.type.toLowerCase().includes(q) ||
            (p.username && p.username.toLowerCase().includes(q))
        );
    });

    const handleOpenEdit = async (profile: CredentialProfile) => {
        setIsCreating(false);
        setEditingProfile(profile);
        setName(profile.name);
        setType(profile.type);
        setDescription(profile.description || '');
        setUsername(profile.username || '');
        setDomain(profile.domain || '');

        let decPwd = '';
        if (profile.password_encrypted) {
            try { decPwd = await api.decryptValue(profile.password_encrypted); } catch (e) { console.error(e); }
        }
        setPassword(decPwd);

        let decKey = '';
        if (profile.private_key_encrypted) {
            try { decKey = await api.decryptValue(profile.private_key_encrypted); } catch (e) { console.error(e); }
        }
        setPrivateKey(decKey);
    };

    const handleOpenCreate = () => {
        setEditingProfile(null);
        setIsCreating(true);
        setName('');
        setType('generic');
        setDescription('');
        setUsername('');
        setPassword('');
        setPrivateKey('');
        setDomain('');
    };

    const handleCloseForm = () => {
        setEditingProfile(null);
        setIsCreating(false);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            let password_encrypted: string | null = null;
            if (password.trim() !== '') {
                password_encrypted = await api.encryptValue(password);
            }

            let private_key_encrypted: string | null = null;
            if (privateKey.trim() !== '') {
                private_key_encrypted = await api.encryptValue(privateKey);
            }

            const req = {
                name,
                type,
                description: description || null,
                username: username || null,
                password_encrypted,
                private_key_encrypted,
                domain: domain || null,
            };

            if (isCreating) {
                await createCredentialProfile(req);
            } else if (editingProfile) {
                await updateCredentialProfile({ id: editingProfile.id, ...req });
            }
            handleCloseForm();
        } catch (error) {
            console.error(error);
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const usedCount = connections.filter(c => !c.override_credentials && c.credential_profile_id === id).length;
        const msg = usedCount > 0 
            ? `Are you sure you want to delete this profile?\n\nIt is used by ${usedCount} server(s). They will fall back to local credentials.`
            : 'Are you sure you want to delete this profile?';
        if (confirm(msg)) {
            await deleteCredentialProfile(id);
        }
    };

    const handleDuplicate = async (e: React.MouseEvent, p: CredentialProfile) => {
        e.stopPropagation();
        try {
            await createCredentialProfile({
                name: `${p.name} (Copy)`,
                type: p.type,
                description: p.description,
                username: p.username,
                password_encrypted: p.password_encrypted,
                private_key_encrypted: p.private_key_encrypted,
                domain: p.domain,
            });
        } catch (err) {
            console.error(err);
        }
    };

    const handleTest = (e: React.MouseEvent, p: CredentialProfile) => {
        e.stopPropagation();
        alert(`Test connection stub: Testing profile ${p.name}`);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface rounded-xl shadow-2xl border border-white/10 w-full max-w-4xl flex flex-col overflow-hidden max-h-[85vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-accent/20 text-accent">
                            <KeyRound className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-text">Credential Manager</h2>
                            <p className="text-xs text-text-muted">Manage global credential profiles for your connections</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowCredentialManager(false)}
                        className="p-2 rounded-md hover:bg-white/10 text-text-muted transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex flex-col lg:flex-row relative">
                    {/* Left Panel: List */}
                    <div className={`flex-1 flex flex-col border-r border-white/5 transition-all ${isCreating || editingProfile ? 'hidden lg:flex' : 'flex'}`}>
                        <div className="p-4 border-b border-white/5 flex gap-2">
                            <div className="flex-1 relative">
                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                                <input
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search profiles..."
                                    className="w-full bg-background rounded-md pl-9 pr-3 py-2 text-sm text-text border-none outline-none focus:ring-1 focus:ring-accent/50"
                                />
                            </div>
                            <button
                                onClick={handleOpenCreate}
                                className="px-3 py-2 bg-accent/20 hover:bg-accent/30 text-accent rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                            >
                                <Plus className="w-4 h-4" /> New
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                            {filteredProfiles.length === 0 ? (
                                <div className="p-8 text-center text-text-muted text-sm">
                                    <KeyRound className="w-8 h-8 opacity-20 mx-auto mb-2" />
                                    No credential profiles found.
                                </div>
                            ) : (
                                filteredProfiles.map(p => (
                                    <div
                                        key={p.id}
                                        onClick={() => handleOpenEdit(p)}
                                        className={`group px-3 py-3 rounded-lg cursor-pointer flex flex-col gap-1 transition-colors ${editingProfile?.id === p.id ? 'bg-accent/10 border border-accent/20' : 'hover:bg-white/5 border border-transparent'}`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold text-sm text-text">{p.name}</span>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={(e) => handleTest(e, p)}
                                                    className="p-1 rounded hover:bg-white/10 text-text-muted object-contain"
                                                    title="Test Connection Profile"
                                                >
                                                    <span className="text-[10px] uppercase font-bold tracking-wider px-1">Test</span>
                                                </button>
                                                <button
                                                    onClick={(e) => handleDuplicate(e, p)}
                                                    className="p-1 rounded hover:bg-white/10 text-text-muted object-contain"
                                                    title="Duplicate Profile"
                                                >
                                                    <Plus className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={(e) => handleDelete(p.id, e)}
                                                    className="p-1 rounded hover:bg-red-500/20 text-red-400 object-contain"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 text-xs text-text-muted truncate">
                                            <span className="bg-white/5 px-1.5 py-0.5 rounded font-mono uppercase text-[10px]">{p.type}</span>
                                            {p.username && <span>{p.username}</span>}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Right Panel: Editor */}
                    <AnimatePresence mode="popLayout">
                        {(isCreating || editingProfile) && (
                            <motion.div
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="w-full lg:w-[450px] flex flex-col bg-surface/50"
                            >
                                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                                    <h3 className="text-sm font-semibold flex items-center gap-2">
                                        <Edit2 className="w-4 h-4 text-accent" />
                                        {isCreating ? 'Create Profile' : 'Edit Profile'}
                                    </h3>
                                    <button onClick={handleCloseForm} className="lg:hidden p-1 hover:bg-white/10 rounded">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-6 hidden-scrollbar">
                                    <form id="profile-form" onSubmit={handleSave} className="space-y-4 text-sm">
                                        <div>
                                            <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Profile Name *</label>
                                            <input
                                                required
                                                type="text"
                                                value={name}
                                                onChange={e => setName(e.target.value)}
                                                placeholder="e.g. Prod Linux Adms"
                                                className="w-full bg-background rounded border border-white/10 px-3 py-2 text-text outline-none focus:border-accent"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Description</label>
                                            <input
                                                type="text"
                                                value={description}
                                                onChange={e => setDescription(e.target.value)}
                                                placeholder="Optional context"
                                                className="w-full bg-background rounded border border-white/10 px-3 py-2 text-text outline-none focus:border-accent"
                                            />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Type *</label>
                                                <select
                                                    value={type}
                                                    onChange={e => setType(e.target.value as CredentialType)}
                                                    className="w-full bg-background rounded border border-white/10 px-3 py-2 text-text outline-none focus:border-accent appearance-none"
                                                >
                                                    <option value="ssh">SSH</option>
                                                    <option value="rdp">RDP</option>
                                                    <option value="ftp">FTP/SFTP</option>
                                                    <option value="generic">Generic</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Username</label>
                                                <input
                                                    type="text"
                                                    value={username}
                                                    onChange={e => setUsername(e.target.value)}
                                                    className="w-full bg-background rounded border border-white/10 px-3 py-2 text-text outline-none focus:border-accent"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Password</label>
                                            <input
                                                type="password"
                                                value={password}
                                                onChange={e => setPassword(e.target.value)}
                                                className="w-full bg-background rounded border border-white/10 px-3 py-2 text-text outline-none focus:border-accent"
                                            />
                                        </div>
                                        {type === 'rdp' && (
                                            <div>
                                                <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Domain</label>
                                                <input
                                                    type="text"
                                                    value={domain}
                                                    onChange={e => setDomain(e.target.value)}
                                                    className="w-full bg-background rounded border border-white/10 px-3 py-2 text-text outline-none focus:border-accent"
                                                />
                                            </div>
                                        )}
                                        {['ssh', 'ftp', 'generic'].includes(type) && (
                                            <div>
                                                <label className="block text-xs font-semibold text-text-muted mb-1.5 uppercase tracking-wider">Private Key</label>
                                                <textarea
                                                    value={privateKey}
                                                    onChange={e => setPrivateKey(e.target.value)}
                                                    rows={4}
                                                    placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                                                    className="w-full bg-background font-mono rounded border border-white/10 px-3 py-2 text-text outline-none focus:border-accent resize-none custom-scrollbar text-xs"
                                                    spellCheck={false}
                                                />
                                            </div>
                                        )}
                                    </form>
                                </div>
                                <div className="p-4 border-t border-white/5 flex justify-end gap-3 bg-white/[0.02]">
                                    <button
                                        type="button"
                                        onClick={handleCloseForm}
                                        className="px-4 py-2 hover:bg-white/5 text-text rounded-md text-sm transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        form="profile-form"
                                        className="px-4 py-2 bg-accent hover:bg-accent-light text-white rounded-md text-sm font-medium transition-colors shadow-lg shadow-accent/20"
                                    >
                                        Save Profile
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </motion.div>
    );
};
