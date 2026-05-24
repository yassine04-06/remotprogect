/**
 * Tauri IPC mock for Playwright E2E tests.
 *
 * Strategy
 * ─────────
 * Tauri v2's `@tauri-apps/api/core` `invoke()` calls
 * `window.__TAURI_INTERNALS__.invoke(cmd, args, options)` and awaits the
 * returned Promise.  By injecting a compatible mock object via
 * `page.addInitScript()` BEFORE the React app boots, every IPC call is
 * intercepted without any Tauri binary.
 *
 * IMPORTANT: Tauri v2 changed the IPC contract.  `__TAURI_INTERNALS__.invoke`
 * must now be an async function that RETURNS a Promise — the old v1 approach
 * of passing callback/error integer IDs in the payload is no longer used by
 * `@tauri-apps/api/core`.
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

    // transformCallback is required by @tauri-apps/api/core's Channel class
    // (used for streaming IPC).  We implement it the same way as the official
    // Tauri mockIPC helper so Channel objects work correctly if any component
    // uses them.
    var _callbacks = new Map();

    function transformCallback(handler, once) {
        var id = window.crypto.getRandomValues(new Uint32Array(1))[0];
        _callbacks.set(id, function(data) {
            if (once) _callbacks.delete(id);
            if (typeof handler === 'function') handler(data);
        });
        return id;
    }

    function unregisterCallback(id) {
        _callbacks.delete(id);
    }

    function runCallback(id, data) {
        var cb = _callbacks.get(id);
        if (cb) cb(data);
    }

    // Tauri v2: __TAURI_INTERNALS__.invoke must be async and RETURN a Promise.
    // @tauri-apps/api/core does: return window.__TAURI_INTERNALS__.invoke(cmd, args, options)
    // and awaits the result — it no longer passes callback/error IDs in args.
    async function invoke(cmd, _args, _options) {
        // Silently absorb plugin event commands (listen/emit/unlisten) so
        // components that call listen() from @tauri-apps/api/event don't throw.
        if (typeof cmd === 'string' && cmd.startsWith('plugin:')) {
            return null;
        }

        var responses = window.__E2E_MOCK_RESPONSES__;
        if (!(cmd in responses)) {
            console.warn('[E2E mock] unhandled Tauri command: ' + cmd);
            return null;
        }

        var mock = responses[cmd];
        if (mock !== null && typeof mock === 'object' && '__error' in mock) {
            throw mock.__error;
        }
        return mock;
    }

    // Initialise the event-plugin internals object expected by @tauri-apps/api/event.
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ =
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ || {};

    window.__TAURI_INTERNALS__ = {
        metadata: {
            currentWindow: { label: 'main' },
            currentWebview: { windowLabel: 'main', label: 'main' },
        },
        invoke: invoke,
        transformCallback: transformCallback,
        unregisterCallback: unregisterCallback,
        runCallback: runCallback,
        callbacks: _callbacks,
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
