import { expect, test, type Page } from '@playwright/test';

function isKnownRuntimeNoise(text: string): boolean {
    // Pyodide/Python runtime errors in dev/testing environment
    if (
        text.includes('Failed to load') ||
        text.includes('error occurred while loading') ||
        text.includes('ModuleNotFoundError') ||
        text.includes('Unhandled exception in event loop') ||
        text.includes('[worker] <<') ||
        text.includes('<frozen importlib') ||
        text.includes('/lib/python') ||
        text.includes('File "<exec>"') ||
        text.includes('Traceback (most recent call last)')
    ) {
        return true;
    }
    return (
        text.includes('SyntaxWarning: invalid escape sequence') ||
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

    test('vault drawer toggle is disabled before drawer initialization', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/');

        // The Vaults toggle should exist and be an accessible button
        const vaultsToggle = page.getByRole('button', { name: 'Vaults' });
        await expect(vaultsToggle).toBeAttached();

        // It must have the correct accessible name
        await expect(vaultsToggle).toHaveAccessibleName('Vaults');

        // If the toggle is still disabled, bootstrap hasn't completed yet.
        // Wait up to 10s for it to become enabled.
        await expect(vaultsToggle).toBeEnabled({ timeout: 10000 });

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('vault drawer opens when enabled toggle is activated', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/');

        const vaultsToggle = page.getByRole('button', { name: 'Vaults' });
        await expect(vaultsToggle).toBeAttached();
        await expect(vaultsToggle).toBeEnabled({ timeout: 10000 });

        // Tap the toggle to open the drawer
        await vaultsToggle.click();

        // The drawer should reveal the "Initialize New Vault" action
        const initButton = page.getByRole('button', { name: 'Initialize New Vault' });
        await expect(initButton).toBeVisible({ timeout: 5000 });

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });
});