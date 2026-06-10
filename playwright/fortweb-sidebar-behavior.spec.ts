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

test.describe('FortWeb sidebar behavior', () => {
    test('core route shows main nav with KERI Foundation entry', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures/identifiers/populated');

        // Assert page renders expected identifiers content
        await expect(page.getByText('Local Identifiers')).toBeVisible();

        // Assert core sidebar is visible
        await expect(page.locator('.lk-sidebar')).toBeVisible();

        // Assert core nav links are present
        const sidebarNav = page.locator('.lk-sidebar__nav');
        await expect(sidebarNav.getByRole('link', { name: 'Identifiers', exact: true })).toBeVisible();
        await expect(sidebarNav.getByRole('link', { name: 'Remote Identifiers', exact: true })).toBeVisible();
        await expect(sidebarNav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();

        // Assert KERI Foundation entry is present (single entry, not expanded)
        const kfEntry = page.locator('.lk-sidebar__plugin-entry a:has-text("KERI Foundation")');
        await expect(kfEntry).toBeVisible();

        // Assert KERI Foundation entry href points to kf-home route
        await expect(kfEntry).toHaveAttribute('href', /\/kf$/);

        // Assert plugin child links are NOT present (no inline expansion)
        await expect(page.locator('.lk-sidebar__plugin-links')).not.toBeVisible();

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('KF witnesses route shows provider menu with Back button', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures/witnesses/account');

        // Assert witnesses page renders
        await expect(page.getByText('Hosted Witnesses')).toBeVisible();

        // Assert provider sidebar is visible
        await expect(page.locator('.lk-sidebar')).toBeVisible();

        // Assert Back button is present
        await expect(page.locator('.lk-sidebar__back')).toBeVisible();
        await expect(page.locator('.lk-sidebar__back span:has-text("Back")')).toBeVisible();

        // Assert KERI Foundation branding is present
        await expect(page.locator('.lk-sidebar__plugin-brand-link')).toBeVisible();
        await expect(page.locator('.lk-sidebar__plugin-brand-label:has-text("KERI Foundation")')).toBeVisible();

        // Assert plugin nav links are present
        await expect(page.getByRole('link', { name: 'Identifiers', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Witnesses', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Watchers', exact: true })).toBeVisible();

        // Assert Witnesses link is active
        const witnessesLink = page.getByRole('link', { name: 'Witnesses', exact: true });
        await expect(witnessesLink).toHaveClass(/is-active/);

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('KF watchers route shows provider menu with active state', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures/watchers/populated');

        // Assert watchers page renders
        await expect(page.getByRole('heading', { name: 'Watchers', exact: true })).toBeVisible();

        // Assert provider sidebar is visible
        await expect(page.locator('.lk-sidebar')).toBeVisible();

        // Assert Back button is present
        await expect(page.locator('.lk-sidebar__back')).toBeVisible();

        // Assert Watchers link is active
        const watchersLink = page.getByRole('link', { name: 'Watchers', exact: true });
        await expect(watchersLink).toHaveClass(/is-active/);

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

});
