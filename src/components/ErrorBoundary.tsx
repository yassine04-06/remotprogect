import React from 'react';
import * as Sentry from '@sentry/react';

interface Props extends React.PropsWithChildren {
    /** When set, renders a compact inline panel rather than a full-screen overlay. */
    panelName?: string;
}

interface State {
    hasError: boolean;
    error: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: '' };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error: error.message || String(error) };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error(`[ErrorBoundary${this.props.panelName ? ':' + this.props.panelName : ''}]`, error, info);
        Sentry.captureException(error, { extra: { componentStack: info.componentStack, panel: this.props.panelName } });
    }

    render() {
        if (!this.state.hasError) return this.props.children;

        if (this.props.panelName) {
            return (
                <div
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        padding: 16,
                        background: 'var(--color-surface)',
                        color: 'var(--color-text-primary)',
                    }}
                >
                    <div style={{ fontSize: 24 }}>⚠️</div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {this.props.panelName} crashed
                    </div>
                    <div
                        style={{
                            color: 'var(--color-text-muted)',
                            fontSize: 11,
                            maxWidth: 320,
                            textAlign: 'center',
                            background: 'var(--color-base)',
                            padding: '8px 14px',
                            borderRadius: 6,
                            fontFamily: 'ui-monospace, monospace',
                            wordBreak: 'break-word',
                        }}
                    >
                        {this.state.error}
                    </div>
                    <button
                        onClick={() => this.setState({ hasError: false, error: '' })}
                        style={{
                            marginTop: 4,
                            padding: '6px 16px',
                            borderRadius: 6,
                            border: 'none',
                            cursor: 'pointer',
                            background: 'var(--color-accent)',
                            color: '#fff',
                            fontWeight: 600,
                            fontSize: 12,
                        }}
                    >
                        Retry
                    </button>
                </div>
            );
        }

        return (
            <div
                style={{
                    height: '100vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--color-base)',
                    color: 'var(--color-text-primary)',
                    gap: 16,
                    fontFamily: 'system-ui, sans-serif',
                }}
            >
                <div style={{ fontSize: 48 }}>💥</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</div>
                <div
                    style={{
                        color: 'var(--color-text-muted)',
                        fontSize: 12,
                        maxWidth: 440,
                        textAlign: 'center',
                        background: 'var(--color-surface)',
                        padding: '12px 20px',
                        borderRadius: 8,
                        fontFamily: 'ui-monospace, monospace',
                        wordBreak: 'break-word',
                    }}
                >
                    {this.state.error}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                        onClick={() => this.setState({ hasError: false, error: '' })}
                        style={{
                            padding: '8px 20px',
                            borderRadius: 8,
                            border: 'none',
                            cursor: 'pointer',
                            background: 'var(--color-accent)',
                            color: '#fff',
                            fontWeight: 600,
                            fontSize: 14,
                        }}
                    >
                        Try Again
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '8px 20px',
                            borderRadius: 8,
                            cursor: 'pointer',
                            background: 'transparent',
                            color: 'var(--color-text-muted)',
                            border: '1px solid var(--color-border)',
                            fontWeight: 600,
                            fontSize: 14,
                        }}
                    >
                        Reload App
                    </button>
                </div>
            </div>
        );
    }
}
