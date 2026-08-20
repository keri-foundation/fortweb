import { expect, test } from '@playwright/test';
import {
    collectUnexpectedConsoleErrors,
    collectUnexpectedPageErrors,
} from './utils/error-collector.js';

const VAULT_ALIAS = 'Lifecycle Vault';
const VAULT_PASSCODE = 'lifecycle-test-passcode';

function extractVaultIdFromHash(hash: string): string {
    const match = hash.match(/^#\/vaults\/([^/]+)\/unlock$/);
    if (!match) {
        throw new Error(`Could not parse vault id from unlock hash: ${hash}`);
    }
    return decodeURIComponent(match[1]);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('FortWeb persisted vault lifecycle', () => {
    test(
        'create → reload → rediscover → unlock → reopen reaches Identifiers',
        { tag: '@slow' },
        async ({ page }) => {
            test.setTimeout(180_000);

            const pageErrors = collectUnexpectedPageErrors(page);
            const consoleErrors = collectUnexpectedConsoleErrors(page);

            // A. Boot the real app.
            await page.goto('/fortweb/app/');
            await expect(page.getByRole('button', { name: 'Vaults' })).toBeEnabled({ timeout: 60_000 });

            // B. Initialize a real vault through the UI.
            await page.getByRole('button', { name: 'Vaults' }).click();
            await page.getByRole('button', { name: 'Initialize New Vault' }).click();
            await page.getByLabel('Name').fill(VAULT_ALIAS);
            await page.getByLabel('Passcode').fill(VAULT_PASSCODE);
            await page.getByRole('button', { name: 'Create' }).click();

            // C. Reach and render the unlock route; capture the generated vault id.
            await expect(page).toHaveURL(/#\/vaults\/[^/]+\/unlock/, { timeout: 60_000 });
            const vaultId = extractVaultIdFromHash(await page.evaluate(() => window.location.hash));
            const unlockHeading = page.getByRole('heading', { name: `Open ${VAULT_ALIAS}` });
            await expect(unlockHeading).toBeVisible({ timeout: 10_000 });

            // Open once with the original passcode and prove Identifiers renders.
            await page.locator('#unlock-passcode').fill(VAULT_PASSCODE);
            await page.getByRole('button', { name: 'Open' }).click();
            await expect(page).toHaveURL(new RegExp(`#/vaults/${escapeRegExp(vaultId)}/identifiers`), { timeout: 60_000 });
            await expect(page.getByRole('button', { name: 'Add Identifier' })).toBeVisible({ timeout: 10_000 });

            // D. Return to the home shell via the brand link.
            await page.getByRole('link', { name: 'Locksmith' }).click();
            await expect(page).toHaveURL(/#\/$/, { timeout: 10_000 });

            // E. Full reload: JS/session state is lost, IndexedDB persists.
            await page.reload();
            await expect(page.getByRole('button', { name: 'Vaults' })).toBeEnabled({ timeout: 60_000 });

            // F. Rediscover the persisted vault from the drawer.
            await page.getByRole('button', { name: 'Vaults' }).click();
            const persistedVaultItem = page.locator('.lk-drawer__item').filter({ hasText: VAULT_ALIAS });
            await expect(persistedVaultItem).toBeVisible({ timeout: 60_000 });

            // G. Select the persisted vault; prove hash then unlock UI independently.
            await persistedVaultItem.click();
            await expect(page).toHaveURL(new RegExp(`#/vaults/${escapeRegExp(vaultId)}/unlock`), { timeout: 10_000 });
            // Selecting a locked vault must close the modal drawer. Playwright can
            // still reach the unlock form behind the overlay, so assert the modal
            // state explicitly — the iOS wrapper only exposes the non-modal UI and
            // would otherwise never see the unlock heading.
            await expect(page.getByRole('dialog', { name: 'Vault switcher' })).toBeHidden({ timeout: 10_000 });
            await expect(unlockHeading).toBeVisible({ timeout: 10_000 });

            // H. Reopen with the same passcode and prove Identifiers renders again.
            await page.locator('#unlock-passcode').fill(VAULT_PASSCODE);
            await page.getByRole('button', { name: 'Open' }).click();
            await expect(page).toHaveURL(new RegExp(`#/vaults/${escapeRegExp(vaultId)}/identifiers`), { timeout: 60_000 });
            await expect(page.getByRole('button', { name: 'Add Identifier' })).toBeVisible({ timeout: 10_000 });

            // No unexpected fatal errors across the whole lifecycle.
            expect(pageErrors).toEqual([]);
            expect(consoleErrors).toEqual([]);
        },
    );
});
