import { expect, test } from '@playwright/test';
import { collectUnexpectedPageErrors, collectUnexpectedConsoleErrors, expectNoUnexpectedErrors } from './utils/error-collector.js';

test.describe('FortWeb smoke', () => {
    test('app boot renders the vault landing page', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/');

        await expect(page.locator('#app-root')).toBeAttached();
        await expect(page.locator('.topbar__brand-link')).toBeVisible();
        await expect(page.locator('.home-splash')).toBeVisible();
        await expect(page.locator('.shell-tabbar')).toHaveCount(0);
        await expect(page.getByText('Browser Wallet')).toHaveCount(0);
        await expect(page.getByText('Create your first vault to begin using the mobile wallet.')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Your Vaults' })).toHaveCount(0);
        await expect(page).toHaveTitle(/Locksmith \| Locksmith/);

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('fixture index route lists deterministic fixture pages', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures');

        await expect(page.getByRole('heading', { name: 'Fixture Routes' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'vaults/populated' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'watchers/populated' })).toBeVisible();

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('identifiers fixture renders populated table state', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures/identifiers/populated');

        await expect(page).toHaveTitle(/Identifiers \| Locksmith/);
        await expect(page.getByText('Local Identifiers')).toBeVisible();
        await expect(page.getByRole('link', { name: 'primary-aid' })).toBeVisible();

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('witness fixture renders hosted witness account state', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures/witnesses/account');

        await expect(page).toHaveTitle(/KERI Foundation Witnesses \| Locksmith/);
        await expect(page.getByText('Hosted Witnesses')).toBeVisible();
        await expect(page.getByRole('cell', { name: 'KF Witness wan-0' })).toBeVisible();

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });
});