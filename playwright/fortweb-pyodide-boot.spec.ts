import { expect, test } from '@playwright/test';
import { collectUnexpectedPageErrors, collectUnexpectedConsoleErrors, expectNoUnexpectedErrors } from './utils/error-collector.js';

test.describe('FortWeb Pyodide boot canary', () => {
    test(
        'worker reaches preload complete state',
        { tag: '@slow' },
        async ({ page }) => {
            test.setTimeout(120_000);

            const pageErrors = collectUnexpectedPageErrors(page);
            const consoleErrors = collectUnexpectedConsoleErrors(page);

            const preloadPromise = page.waitForEvent('console', {
                predicate: (message) =>
                    message.worker() !== null &&
                    message.type() === 'log' &&
                    message.text().startsWith('[worker] preload complete'),
                timeout: 90_000,
            });

            await page.goto('/fortweb/app/');

            const preloadMessage = await preloadPromise;

            expect(preloadMessage.worker()).not.toBeNull();
            expect(preloadMessage.text()).toMatch(/^\[worker\] preload complete/);
            await expect(page.locator('#app-root')).toBeAttached();

            await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
        },
    );
});
