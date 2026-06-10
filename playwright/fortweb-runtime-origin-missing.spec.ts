import { expect, test, type Page } from '@playwright/test';

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
        consoleErrors.push(text);
    });
    return consoleErrors;
}

test.describe('FortWeb runtime origin contract missing behavior', () => {
    test('allows startup in local browser dev when contract is missing', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        // Explicitly ensure the contract is missing (it should be by default in local dev)
        await page.addInitScript(() => {
            // @ts-expect-error: deleting optional window property
            delete window.__FORT_RUNTIME_ORIGIN__;
        });

        await page.goto('/fortweb/app/');

        // Assert the app renders the home page (vault landing page)
        // instead of crashing or showing a startup error.
        await expect(page.locator('.home-splash')).toBeVisible();
        await expect(page.locator('.topbar__brand-link')).toBeVisible();
        
        // Verify no unexpected errors were thrown due to the missing contract
        expect(pageErrors).toEqual([]);
        expect(consoleErrors).toEqual([]);
    });
});