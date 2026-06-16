import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePromptStore } from '../store/usePromptStore';

// Single instance mounted at the app root. Renders the active prompt() request.
// Replaces window.prompt with a themed, accessible, keyboard-friendly dialog.
export function PromptDialog() {
    const { open, title, label, placeholder, defaultValue, confirmLabel, validate, submit, cancel } =
        usePromptStore();
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setValue(defaultValue ?? '');
            setError(null);
            // Focus after the dialog mounts.
            setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [open, defaultValue]);

    const onSubmit = () => {
        const v = value.trim();
        const err = validate?.(v) ?? null;
        if (err) { setError(err); return; }
        submit(v);
    };

    return (
        <AnimatePresence>
            {open && (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onMouseDown={cancel}
                >
                    <motion.div
                        role="dialog"
                        aria-modal="true"
                        aria-label={title}
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        onMouseDown={e => e.stopPropagation()}
                        className="bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-sm p-5"
                    >
                        <h2 className="text-sm font-bold text-text-primary mb-1">{title}</h2>
                        {label && <p className="text-xs text-text-muted mb-3">{label}</p>}
                        <input
                            ref={inputRef}
                            value={value}
                            onChange={e => { setValue(e.target.value); setError(null); }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') onSubmit();
                                if (e.key === 'Escape') cancel();
                            }}
                            placeholder={placeholder}
                            aria-invalid={!!error}
                            className="w-full bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
                        />
                        {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
                        <div className="flex gap-2 justify-end mt-4">
                            <button
                                onClick={cancel}
                                className="px-3 py-1.5 bg-base border border-border rounded-lg text-xs font-semibold text-text-muted hover:bg-white/5"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={onSubmit}
                                className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-bold hover:bg-accent/90"
                            >
                                {confirmLabel ?? 'OK'}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
