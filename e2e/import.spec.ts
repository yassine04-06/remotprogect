/**
 * E2E — Import Dialog Flow
 *
 * Covers:
 *   1. Ctrl+Shift+I opens the Import dialog.
 *   2. PuTTY "Scan Registry" populates the preview table.
 *   3. RDM browse → preview → clicking Import calls bulk_import_connections
 *      and closes the dialog.
 *   4. Switching import tabs clears the previous preview.
 */

import { test, expect } from '@playwright/test';
import { installTauriMock, setMockResponses } from './helpers/tauri-mock';
import {
    UNLOCKED_VAULT_RESPONSES,
    IMPORTED_SSH,
    IMPORTED_RDP,
} from './helpers/fixtures';

// ── Shared setup ──────────────────────────────────────────────────────────────

async function loadAndOpenImportDialog(page: Parameters<typeof installTauriMock>[0]) {
    await installTauriMock(page, UNLOCKED_VAULT_RESPONSES);
    await page.goto('/');
    await page.waitForSelector('[aria-label="Lock vault"]', { timeout: 15_000 });

    // Open the Import dialog via the Ctrl+Shift+I keyboard shortcut.
    await page.keyboard.press('Control+Shift+I');

    // Wait for the dialog to appear.
    await page.waitForSelector('text=Import Connections', { timeout: 8_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Import Dialog', () => {
    test('Ctrl+Shift+I opens the import dialog', async ({ page }) => {
        await installTauriMock(page, UNLOCKED_VAULT_RESPONSES);
        await page.goto('/');
        await page.waitForSelector('[aria-label="Lock vault"]', { timeout: 15_000 });

        // Dialog must NOT be visible before the shortcut.
        await expect(page.locator('text=Import Connections')).not.toBeVisible();

        await page.keyboard.press('Control+Shift+I');

        // Dialog header appears.
        await expect(page.locator('text=Import Connections')).toBeVisible({ timeout: 5_000 });

        // All source tabs must be rendered.
        for (const label of ['PuTTY', '.rdp File', 'mRemoteNG', 'SSH Config', 'RDM', 'RoyalTS']) {
            await expect(page.locator(`button:has-text("${label}")`)).toBeVisible();
        }
    });

    test('PuTTY scan populates the preview table', async ({ page }) => {
        await loadAndOpenImportDialog(page);

        // Mock import_putty_sessions to return one connection.
        await setMockResponses(page, {
            import_putty_sessions: [IMPORTED_SSH],
        });

        // The PuTTY tab is active by default — click "Scan Registry".
        await page.getByRole('button', { name: /scan registry/i }).click();

        // The preview table must show the imported connection name.
        await expect(page.getByText(IMPORTED_SSH.name as string)).toBeVisible({ timeout: 8_000 });

        // The import button must be enabled (at least 1 connection selected).
        await expect(
            page.getByRole('button', { name: /import/i }).last(),
        ).not.toBeDisabled();
    });

    test('RDM browse previews connections and Import closes dialog', async ({ page }) => {
        await loadAndOpenImportDialog(page);

        // Mock the file picker and RDM parser.
        await setMockResponses(page, {
            import_pick_file: '/fake/export.rdm',
            import_rdm: [IMPORTED_RDP],
            bulk_import_connections: 1,
            // After import the sidebar refreshes.
            get_connections_summary: [],
        });

        // Switch to the RDM tab.
        await page.getByRole('button', { name: 'RDM' }).click();

        // Click browse.
        await page.getByRole('button', { name: /browse .rdm file/i }).click();

        // Preview table should show the RDP connection.
        await expect(page.getByText(IMPORTED_RDP.name as string)).toBeVisible({ timeout: 8_000 });

        // Click the main Import button (bottom-right).
        const importButton = page.getByRole('button', { name: /^import/i }).last();
        await expect(importButton).not.toBeDisabled();
        await importButton.click();

        // Dialog should close after successful import.
        await expect(page.locator('text=Import Connections')).not.toBeVisible({ timeout: 8_000 });
    });

    test('switching tabs clears the previous preview', async ({ page }) => {
        await loadAndOpenImportDialog(page);

        // Load PuTTY results first.
        await setMockResponses(page, {
            import_putty_sessions: [IMPORTED_SSH],
        });
        await page.getByRole('button', { name: /scan registry/i }).click();
        await expect(page.getByText(IMPORTED_SSH.name as string)).toBeVisible({ timeout: 8_000 });

        // Switch to the RDM tab — preview must clear.
        await page.getByRole('button', { name: 'RDM' }).click();
        await expect(page.getByText(IMPORTED_SSH.name as string)).not.toBeVisible();
    });

    test('Escape closes the import dialog', async ({ page }) => {
        await loadAndOpenImportDialog(page);
        await expect(page.locator('text=Import Connections')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.locator('text=Import Connections')).not.toBeVisible({ timeout: 5_000 });
    });
});
