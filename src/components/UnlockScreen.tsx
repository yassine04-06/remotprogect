import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import * as api from '../services/api';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, ShieldCheck, ArrowRight, Loader2 } from 'lucide-react';

export const UnlockScreen: React.FC = () => {
    const { isFirstLaunch, setVaultUnlocked, setFirstLaunch, addToast } = useAppStore();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (isFirstLaunch && password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        if (password.length < 4) {
            setError('Password must be at least 4 characters');
            return;
        }

        setLoading(true);
        try {
            if (isFirstLaunch) {
                await api.setMasterPassword(password);
                setFirstLaunch(false);
                addToast({ type: 'success', title: 'Vault created', description: 'Your secure vault is ready.' });
            } else {
                await api.unlockVault(password);
            }
            setVaultUnlocked(true);
        } catch (err) {
            setError(isFirstLaunch ? 'Failed to create vault' : 'Incorrect master password');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative w-full h-full min-h-screen flex items-center justify-center overflow-hidden bg-base">
            {/* Ambient Background Elements */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-accent/5 rounded-full blur-[120px]" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-accent-secondary/5 rounded-full blur-[120px]" />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="glass-card p-10 max-w-md w-full rounded-3xl z-10 relative"
            >
                <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                    className="w-20 h-20 bg-gradient-to-tr from-accent to-accent-secondary rounded-2xl flex items-center justify-center mb-8 mx-auto shadow-lg shadow-accent/20"
                >
                    {isFirstLaunch ? <ShieldCheck className="w-10 h-10 text-base" /> : <Lock className="w-10 h-10 text-base" />}
                </motion.div>

                <div className="text-center mb-10">
                    <motion.h1
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="text-3xl font-bold tracking-tight text-text-primary mb-3"
                    >
                        {isFirstLaunch ? 'Create Your Vault' : 'Welcome to Nexus'}
                    </motion.h1>
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4 }}
                        className="text-text-muted text-sm leading-relaxed"
                    >
                        {isFirstLaunch
                            ? 'Set a master password to initialize your encrypted connection vault.'
                            : 'Enter your master password to unlock secure access.'}
                    </motion.p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.5 }}
                        className="flex flex-col gap-2"
                    >
                        <label className="text-sm font-semibold text-text-muted">{isFirstLaunch ? 'Master Password' : 'Password'}</label>
                        <input
                            type="password"
                            className={`h-12 w-full bg-base/50 border border-border rounded-xl px-4 focus:outline-none focus:border-accent/50 text-text-primary transition-colors ${error ? 'border-red-500' : ''}`}
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoFocus
                        />
                    </motion.div>

                    {isFirstLaunch && (
                        <motion.div
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.6 }}
                            className="flex flex-col gap-2"
                        >
                            <label className="text-sm font-semibold text-text-muted">Confirm Password</label>
                            <input
                                type="password"
                                className={`h-12 w-full bg-base/50 border border-border rounded-xl px-4 focus:outline-none focus:border-accent/50 text-text-primary transition-colors ${error ? 'border-red-500' : ''}`}
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                        </motion.div>
                    )}

                    <AnimatePresence>
                        {error && (
                            <motion.p
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="text-red-500 text-sm font-medium overflow-hidden"
                            >
                                {error}
                            </motion.p>
                        )}
                    </AnimatePresence>

                    <motion.button
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7 }}
                        type="submit"
                        className="w-full flex items-center justify-center gap-2 py-3.5 bg-accent text-white rounded-xl font-bold hover:bg-accent/90 transition-all shadow-lg shadow-accent/20 disabled:opacity-50 disabled:cursor-not-allowed group"
                        disabled={loading || !password}
                    >
                        {loading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                {isFirstLaunch ? 'Create Vault' : 'Unlock Access'}
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </>
                        )}
                    </motion.button>
                </form>

                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 0.4 }}
                    transition={{ delay: 1 }}
                    className="mt-10 text-[10px] uppercase tracking-[0.2em] font-bold text-center text-text-muted"
                >
                    Military Grade AES-256 Encryption
                </motion.div>
            </motion.div>
        </div>
    );
};
