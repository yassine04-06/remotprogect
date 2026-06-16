// Telemetry consent gate. Sentry is initialised ONLY when the user has
// explicitly opted in AND a DSN was provided at build time. Consent is stored
// locally and can be revoked; nothing is sent before a 'granted' decision.

import * as Sentry from '@sentry/react';

export type ConsentState = 'granted' | 'denied' | null;

const KEY = 'nexorc-telemetry-consent';

export function getConsent(): ConsentState {
    const v = localStorage.getItem(KEY);
    return v === 'granted' || v === 'denied' ? v : null;
}

export function setConsent(state: Exclude<ConsentState, null>): void {
    localStorage.setItem(KEY, state);
    if (state === 'granted') initSentryIfConsented();
    else Sentry.close().catch(() => {}); // stop sending immediately on revoke
}

let initialised = false;

/** Initialises Sentry if (and only if) a DSN exists and consent is granted. */
export function initSentryIfConsented(): void {
    if (initialised) return;
    const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
    if (!dsn || getConsent() !== 'granted') return;
    Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: 0.1,
    });
    initialised = true;
}

/** True when a DSN is configured but the user hasn't decided yet. */
export function shouldAskConsent(): boolean {
    const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
    return !!dsn && getConsent() === null;
}
