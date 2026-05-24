import { useUIStore } from '../store';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Fixed toast notification stack rendered at bottom-right.
 * Extracted from App.tsx (MED-4 refactor).
 */
export function Toaster() {
    const toasts = useUIStore(state => state.toasts);
    const removeToast = useUIStore(state => state.removeToast);

    return (
        <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
            <AnimatePresence>
                {toasts.map(toast => (
                    <motion.div
                        key={toast.id}
                        initial={{ opacity: 0, x: 20, scale: 0.9 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 20, scale: 0.9 }}
                        className={`px-5 py-4 rounded-2xl shadow-2xl glass-card pointer-events-auto border-l-4 min-w-[300px] cursor-pointer
              ${toast.type === 'error'   ? 'border-red-500 bg-red-500/10'     : ''}
              ${toast.type === 'success' ? 'border-green-500 bg-green-500/10' : ''}
              ${toast.type === 'info'    ? 'border-blue-500 bg-blue-500/10'   : ''}
              ${toast.type === 'warning' ? 'border-orange-500 bg-orange-500/10' : ''}
            `}
                        onClick={() => removeToast(toast.id)}
                    >
                        <p className="font-bold text-sm tracking-tight">{toast.title}</p>
                        {toast.description && (
                            <div className="text-xs mt-1.5 text-text-muted leading-relaxed">
                                {toast.description}
                            </div>
                        )}
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
