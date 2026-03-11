import React from 'react';
import { useAppStore } from '../store/useAppStore';

export const Toaster: React.FC = () => {
    const { toasts, removeToast } = useAppStore();

    return (
        <div className="toast-container">
            {toasts.map((toast) => (
                <div key={toast.id} className={`toast ${toast.type}`} onClick={() => removeToast(toast.id)}>
                    <div style={{ fontSize: 18, flexShrink: 0 }}>
                        {toast.type === 'success' && '✅'}
                        {toast.type === 'error' && '❌'}
                        {toast.type === 'warning' && '⚠️'}
                        {toast.type === 'info' && 'ℹ️'}
                    </div>
                    <div>
                        <div className="toast-title">{toast.title}</div>
                        {toast.description && <div className="toast-desc">{toast.description}</div>}
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); removeToast(toast.id); }}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 0, flexShrink: 0 }}
                    >
                        ✕
                    </button>
                </div>
            ))}
        </div>
    );
};
