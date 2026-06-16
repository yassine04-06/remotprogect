import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, X } from 'lucide-react';
import { shouldAskConsent, setConsent } from '../telemetry';

// Bottom-anchored, non-blocking consent prompt shown once on first launch when
// a telemetry DSN is configured. No data is sent until the user clicks Allow.
export function TelemetryConsent() {
    const [visible, setVisible] = useState(() => shouldAskConsent());

    const decide = (state: 'granted' | 'denied') => {
        setConsent(state);
        setVisible(false);
    };

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 40 }}
                    className="fixed bottom-4 right-4 z-[100] max-w-sm glass-card rounded-2xl border border-border p-4 shadow-2xl"
                >
                    <div className="flex items-start gap-3">
                        <ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <h3 className="text-sm font-bold text-text-primary mb-1">Help improve NexoRC</h3>
                            <p className="text-xs text-text-muted leading-relaxed mb-3">
                                Share anonymous crash reports and error diagnostics? No credentials,
                                hostnames, or session data are ever included. You can change this anytime.
                            </p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => decide('granted')}
                                    className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-bold hover:bg-accent/90"
                                >
                                    Allow
                                </button>
                                <button
                                    onClick={() => decide('denied')}
                                    className="px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-semibold text-text-muted hover:bg-white/5"
                                >
                                    No thanks
                                </button>
                            </div>
                        </div>
                        <button
                            onClick={() => decide('denied')}
                            aria-label="Dismiss"
                            className="text-text-muted hover:text-text-primary"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
