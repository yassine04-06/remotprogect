/**
 * E2E — SSH Connect Flow
 *
 * Verifies that:
 *   1. Clicking an SSH connection in the sidebar opens a terminal tab.
 *   2. The terminal canvas element is rendered inside the new tab.
 *   3. Closing the tab removes it from the tab bar.
 *
 * The vault starts pre-unlocked (mocked) with one SSH connection in the
 * sidebar.  No real SSH backend is needed.
 */

import { test, expect } from '@playwright/test';
import { installTauriMock } from './helpers/tauri-mock';
import { UNLOCKED_VAULT_RESPONSES, SSH_SUMMARY } from './helpers/fixtures';

// ── Shared setup ──────────────────────────────────────────────────────────────

async function loadUnlockedVaultWithSSH(page: Parameters<typeof installTauriMock>[0]) {
    await installTauriMock(page, {
        ...UNLOCKED_VAULT_RESPONSES,
        // ssh_connect resolves immediately (no terminal session — just tests UI).
        ssh_connect: null,
        // Silence event-listener commands that the terminal registers.
        audit_log_insert: null,
    });
    await page.goto('/');
    // Wait for the main layout — the Lock vault button signals the vault is open.
    await page.waitForSelector('[aria-label="Lock vault"]', { timeout: 15_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('SSH Connect', () => {
    test('clicking SSH connection opens a terminal tab', async ({ page }) => {
        await loadUnlockedVaultWithSSH(page);

        // The sidebar should show the connection name.
        const connectionItem = page.getByText(SSH_SUMMARY.name as string);
        await expect(connectionItem).toBeVisible({ timeout: 8_000 });

        // Click to open the connection.
        await connectionItem.click();

        // A tab bearing the connection name must appear in the tab bar.
        // ConnectionTabs renders one tab button per open session.
        const tab = page.locator('[role="tab"]', { hasText: SSH_SUMMARY.name as string });
        await expect(tab).toBeVisible({ timeout: 8_000 });
    });

    test('terminal canvas is rendered inside the new tab', async ({ page }) => {
        await loadUnlockedVaultWithSSH(page);

        const connectionItem = page.getByText(SSH_SUMMARY.name as string);
        await expect(connectionItem).toBeVisible({ timeout: 8_000 });
        await connectionItem.click();

        // xterm.js renders a <canvas> element inside the TerminalView.
        // It might take a moment for the canvas to mount.
        await expect(page.locator('.xterm canvas')).toBeVisible({ timeout: 10_000 });
    });

    test('closing a tab removes it from the tab bar', async ({ page }) => {
        await loadUnlockedVaultWithSSH(page);

        const connectionItem = page.getByText(SSH_SUMMARY.name as string);
        await expect(connectionItem).toBeVisible({ timeout: 8_000 });
        await connectionItem.click();

        // Wait for the tab to appear.
        const tab = page.locator('[role="tab"]', { hasText: SSH_SUMMARY.name as string });
        await expect(tab).toBeVisible({ timeout: 8_000 });

        // Find the close button inside the tab and click it.
        // ConnectionTabs renders a close (×) button inside each tab.
        const closeButton = tab.locator('button[aria-label*="close"], button[title*="lose"], button svg').first();
        await closeButton.click();

        // The tab should disappear.
        await expect(tab).not.toBeVisible({ timeout: 5_000 });
    });
});
