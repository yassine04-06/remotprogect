import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initSentryIfConsented } from './telemetry';

// Telemetry is gated on explicit user consent (see telemetry.ts). This is a
// no-op until the user opts in via the consent prompt.
initSentryIfConsented();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
