import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration.
 *
 * Tests run against the Vite dev server (port 1420).
 * All Tauri IPC calls are intercepted by the mock injected via
 * page.addInitScript() — no compiled Tauri binary is needed.
 *
 * Run:
 *   npm run test:e2e          – headless CI run
 *   npm run test:e2e:headed   – visible browser (for debugging)
 *   npm run test:e2e:ui       – Playwright UI mode
 */
export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    expect: { timeout: 8_000 },
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? 'github' : 'list',

    use: {
        baseURL: 'http://localhost:1420',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },

    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    // Start the Vite dev server automatically before running tests.
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:1420',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
