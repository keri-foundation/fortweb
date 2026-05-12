import { expect, test, type Page } from '@playwright/test';

function isKnownRuntimeNoise(text: string): boolean {
    return (
        text.includes('SyntaxWarning: invalid escape sequence') ||
        text.includes('/lib/python3.13/site-packages/') ||
        text.includes("b'(?P<kind2>") ||
        text.includes('MapDom is a subclass of IceMapDom') ||
        text.includes('RawDom is subclass of MapDom')
    );
}

function collectUnexpectedPageErrors(page: Page): string[] {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
        pageErrors.push(error.message);
    });
    return pageErrors;
}

function collectUnexpectedConsoleErrors(page: Page): string[] {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
        if (message.type() !== 'error') {
            return;
        }

        const text = message.text();
        if (text.includes('favicon.ico')) {
            return;
        }
        if (isKnownRuntimeNoise(text)) {
            return;
        }

        consoleErrors.push(text);
    });
    return consoleErrors;
}

async function expectNoUnexpectedErrors(page: Page, pageErrors: string[], consoleErrors: string[]): Promise<void> {
    await page.waitForTimeout(250);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
}

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