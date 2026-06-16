import React from 'react';
import * as Sentry from '@sentry/react';
import { getConsent } from '../telemetry';

interface Props extends React.PropsWithChildren {
    /** When set, renders a compact inline panel rather than a full-screen overlay. */
    panelName?: string;
}

interface State {
    hasError: boolean;
    error: string;
    lastError: Error | null;
    componentStack: string;
    reportSent: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: '', lastError: null, componentStack: '', reportSent: false };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error: error.message || String(error), lastError: error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error(`[ErrorBoundary${this.props.panelName ? ':' + this.props.panelName : ''}]`, error, info);
        this.setState({ componentStack: info.componentStack ?? '' });
        // Auto-capture only when telemetry is initialised (consent granted) — a
        // no-op otherwise, so nothing leaves the machine without opt-in.
        Sentry.captureException(error, { extra: { componentStack: info.componentStack, panel: this.props.panelName } });
    }

    sendReport = () => {
        if (this.state.lastError) {
            Sentry.captureException(this.state.lastError, {
                extra: { componentStack: this.state.componentStack, panel: this.props.panelName, manual: true },
            });
        }
        this.setState({ reportSent: true });
    };

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
                        onClick={() => this.setState({ hasError: false, error: '', lastError: null, componentStack: '', reportSent: false })}
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
                        onClick={() => this.setState({ hasError: false, error: '', lastError: null, componentStack: '', reportSent: false })}
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
                {getConsent() === 'granted' ? (
                    <button
                        onClick={this.sendReport}
                        disabled={this.state.reportSent}
                        style={{
                            marginTop: 4,
                            padding: '6px 16px',
                            borderRadius: 8,
                            cursor: this.state.reportSent ? 'default' : 'pointer',
                            background: 'transparent',
                            color: this.state.reportSent ? 'var(--color-text-muted)' : 'var(--color-accent)',
                            border: '1px solid var(--color-border)',
                            fontWeight: 600,
                            fontSize: 12,
                        }}
                    >
                        {this.state.reportSent ? '✓ Crash report sent' : 'Send crash report'}
                    </button>
                ) : (
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-muted)' }}>
                        Enable telemetry in Settings to send crash reports.
                    </div>
                )}
            </div>
        );
    }
}
