import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import './index.css';

// 30-21: Sentry opt-in — active only when VITE_SENTRY_DSN is set at build time.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
    Sentry.init({
        dsn: sentryDsn,
        environment: import.meta.env.MODE,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: 0.1,
    });
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
