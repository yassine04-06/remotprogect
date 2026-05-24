/**
 * Tauri IPC mock for Playwright E2E tests.
 *
 * Strategy
 * ─────────
 * Tauri v2's `@tauri-apps/api/core` `invoke()` delegates to
 * `window.__TAURI_INTERNALS__.invoke / transformCallback` at runtime.
 * By injecting a mock object via `page.addInitScript()` BEFORE the React
 * app boots, every IPC call is intercepted without any Tauri binary.
 *
 * Mock responses are stored in `window.__E2E_MOCK_RESPONSES__` (plain JSON
 * object) so tests can update them mid-scenario via `page.evaluate()`.
 *
 * Response shapes:
 *   { 'cmd_name': value }          → resolves the promise with `value`
 *   { 'cmd_name': { __error: 'msg', __code: 'CODE' } } → rejects the promise
 *   (missing key)                  → resolves with `null` + console.warn
 */

import type { Page } from '@playwright/test';

/** Plain JSON map from Tauri command name to its mock response. */
export type MockResponses = Record<string, unknown>;

/** Sentinel to make a command reject instead of resolve. */
export function mockError(message: string, code = 'ERROR'): { __error: string; __code: string } {
    return { __error: message, __code: code };
}

// ── The window-level mock script (injected before React boots) ────────────────

const MOCK_SCRIPT = /* javascript */ `
(function () {
    'use strict';

    // Response registry — tests update this with page.evaluate().
    window.__E2E_MOCK_RESPONSES__ = {};

    let _nextId = 1;
    const _handlers = {};

    window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' } },

        // Called by @tauri-apps/api/core to register promise callbacks.
        transformCallback: function(handler, once) {
            const id = _nextId++;
            if (typeof handler === 'function') {
                _handlers[id] = once
                    ? function(resp) { delete _handlers[id]; handler(resp); }
                    : handler;
            }
            return id;
        },

        // Called by invoke() with { callback, error, ...args }.
        invoke: function(cmd, payload) {
            const callback = payload && payload.callback;
            const error    = payload && payload.error;

            const resolve = function(result) {
                const cb = _handlers[callback];
                if (cb) cb(result);
            };
            const reject = function(err) {
                const eb = _handlers[error];
                if (eb) eb(err);
            };

            const responses = window.__E2E_MOCK_RESPONSES__;
            if (!(cmd in responses)) {
                console.warn('[E2E mock] unhandled Tauri command: ' + cmd);
                setTimeout(function() { resolve(null); }, 0);
                return;
            }

            const mock = responses[cmd];
            setTimeout(function() {
                if (mock !== null && typeof mock === 'object' && '__error' in mock) {
                    reject(mock.__error);
                } else {
                    resolve(mock);
                }
            }, 0);
        },

        convertFileSrc: function(src) { return src; },
    };
})();
`;

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Inject the Tauri IPC mock and set initial mock responses.
 * Must be called before `page.goto()`.
 */
export async function installTauriMock(
    page: Page,
    initialResponses: MockResponses = {},
): Promise<void> {
    // 1. Install the mock runtime (runs before any JS on the page).
    await page.addInitScript(MOCK_SCRIPT);

    // 2. Pre-populate responses (also runs before app JS).
    if (Object.keys(initialResponses).length > 0) {
        await page.addInitScript((responses) => {
            Object.assign((window as any).__E2E_MOCK_RESPONSES__, responses);
        }, initialResponses);
    }
}

/**
 * Update mock responses mid-test (after the page has loaded).
 * Merges into the existing registry — unrelated commands are unaffected.
 */
export async function setMockResponses(
    page: Page,
    updates: MockResponses,
): Promise<void> {
    await page.evaluate((r) => {
        Object.assign((window as any).__E2E_MOCK_RESPONSES__, r);
    }, updates);
}

/**
 * Replace ALL mock responses (wipes the previous registry).
 */
export async function resetMockResponses(
    page: Page,
    responses: MockResponses,
): Promise<void> {
    await page.evaluate((r) => {
        (window as any).__E2E_MOCK_RESPONSES__ = r;
    }, responses);
}
