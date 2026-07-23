import { expect, test } from '@playwright/test';
import { collectUnexpectedPageErrors, collectUnexpectedConsoleErrors, expectNoUnexpectedErrors } from './utils/error-collector.js';

test.describe('FortWeb empty and error states', () => {
    test('witnesses connected fixture renders cleanly', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures/witnesses/connected');

        // Assert Witnesses page renders
        await expect(page.getByRole('heading', { name: 'Witnesses', level: 1 })).toBeVisible();
        
        // Assert connected state is visible (no disconnected badge)
        await expect(page.locator('.badge--success')).toContainText('Connected');

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('witnesses error fixture renders cleanly without raw HTML', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures/witnesses/error');

        // Assert Witnesses page renders
        await expect(page.getByRole('heading', { name: 'Witnesses', level: 1 })).toBeVisible();
        
        // Assert error state is shown cleanly
        await expect(page.locator('.notice--warning')).toContainText('Failed to load hosted witness rows');
        
        // Assert no raw HTML document is dumped into the visible UI
        const pageText = await page.locator('body').innerText();
        expect(pageText).not.toContain('<html>');
        expect(pageText).not.toContain('<body>');
        // Note: 'HTTP 503' is intentionally part of the fixture's user-facing error message.

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('watchers populated fixture renders cleanly', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures/watchers/populated');

        // Assert Watchers page renders
        await expect(page.getByRole('heading', { name: 'Watchers', level: 1 })).toBeVisible();
        
        // Assert populated watcher data is visible (stable row text)
        await expect(page.getByRole('cell', { name: 'KF Watcher EWatcher0' })).toBeVisible();

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });
});
