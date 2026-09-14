import { expect, test } from '@playwright/test';
import { collectUnexpectedPageErrors, collectUnexpectedConsoleErrors } from './utils/error-collector.js';

test.describe('FortWeb runtime origin contract missing behavior', () => {
    test('allows startup in local browser dev when contract is missing', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page, { ignoreKnownRuntimeNoise: false });

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