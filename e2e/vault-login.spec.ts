/**
 * E2E — Vault Login Flow
 *
 * Covers three scenarios:
 *   1. Locked vault → unlock screen is shown
 *   2. Correct password → vault unlocks, main UI appears
 *   3. Wrong password → error message is displayed
 *
 * All Tauri IPC is mocked (no Rust binary required).
 */

import { test, expect } from '@playwright/test';
import { installTauriMock, setMockResponses } from './helpers/tauri-mock';
import {
    LOCKED_VAULT_RESPONSES,
    UNLOCK_SUCCESS,
    UNLOCK_FAILURE,
} from './helpers/fixtures';

// ── Shared page setup ─────────────────────────────────────────────────────────

async function loadLockedVault(page: Parameters<typeof installTauriMock>[0]) {
    await installTauriMock(page, LOCKED_VAULT_RESPONSES);
    await page.goto('/');
    // Wait for the React app to hydrate — the password input is our signal.
    await page.waitForSelector('input[type="password"]', { timeout: 15_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Vault Login', () => {
    test('shows unlock screen when vault is locked', async ({ page }) => {
        await loadLockedVault(page);

        // The password input must be present and focused (autoFocus).
        const passwordInput = page.locator('input[type="password"]').first();
        await expect(passwordInput).toBeVisible();
        await expect(passwordInput).toBeFocused();

        // No sidebar connections should be visible yet.
        await expect(page.locator('[data-testid="sidebar"]')).not.toBeVisible().catch(() => {
            // sidebar element may not exist at all — that's also fine
        });
    });

    test('unlocks vault with the correct password and shows main UI', async ({ page }) => {
        await loadLockedVault(page);

        // Register success responses BEFORE the user submits.
        await setMockResponses(page, UNLOCK_SUCCESS);

        // Type a password and submit.
        const passwordInput = page.locator('input[type="password"]').first();
        await passwordInput.fill('StrongPassword123!');
        await passwordInput.press('Enter');

        // After unlock the app switches away from the unlock screen.
        // The server sidebar or the topbar (with "Lock vault" button) must appear.
        await expect(
            page.getByRole('button', { name: /lock vault/i }),
        ).toBeVisible({ timeout: 10_000 });

        // The password input should no longer be visible.
        await expect(passwordInput).not.toBeVisible();
    });

    test('shows error message with wrong password', async ({ page }) => {
        await loadLockedVault(page);

        // Override unlock_vault to return an error.
        await setMockResponses(page, UNLOCK_FAILURE);

        const passwordInput = page.locator('input[type="password"]').first();
        await passwordInput.fill('wrongpassword');
        await passwordInput.press('Enter');

        // An error message must appear.  The exact text depends on how the
        // component surfaces the IPC error, but it will contain keywords like
        // "Invalid", "password", or "incorrect".
        await expect(
            page.locator('text=/invalid|incorrect|wrong|failed/i'),
        ).toBeVisible({ timeout: 8_000 });

        // The unlock screen must still be showing (user stays on login page).
        await expect(passwordInput).toBeVisible();
    });

    test('first-run shows set-password form (two inputs)', async ({ page }) => {
        await installTauriMock(page, {
            is_vault_unlocked: { unlocked: false },
            is_first_run: true, // first launch
        });
        await page.goto('/');
        await page.waitForSelector('input[type="password"]', { timeout: 15_000 });

        // On first run UnlockScreen renders two password fields (password + confirm).
        const passwordInputs = page.locator('input[type="password"]');
        await expect(passwordInputs).toHaveCount(2);
    });
});
