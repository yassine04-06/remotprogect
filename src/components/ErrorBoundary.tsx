import React from 'react';

interface State { hasError: boolean; error: string; }

export class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, State> {
    constructor(props: React.PropsWithChildren<{}>) {
        super(props);
        this.state = { hasError: false, error: '' };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error: error.message || String(error) };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        console.error('[ErrorBoundary]', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    height: '100vh', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    background: 'var(--bg-base)', color: 'var(--text-primary)', gap: 16,
                }}>
                    <div style={{ fontSize: 48 }}>💥</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</div>
                    <div style={{
                        color: 'var(--text-muted)', fontSize: 12, maxWidth: 440, textAlign: 'center',
                        background: 'var(--bg-panel)', padding: '12px 20px', borderRadius: 8,
                        fontFamily: "'JetBrains Mono', monospace",
                    }}>
                        {this.state.error}
                    </div>
                    <button className="btn btn-primary" onClick={() => this.setState({ hasError: false, error: '' })}>
                        Try Again
                    </button>
                    <button className="btn btn-ghost" onClick={() => window.location.reload()}>
                        Reload App
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
