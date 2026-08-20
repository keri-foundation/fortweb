import { expect, test, type Page } from '@playwright/test';
import type { ConsoleMessage } from '@playwright/test';
import { isKnownRuntimeNoise } from './utils/runtime-noise.js';
import {
    collectUnexpectedConsoleErrors,
    collectUnexpectedPageErrors,
} from './utils/error-collector.js';

/**
 * Resolves with the first fatal runtime error observed on the page or its
 * workers. Cosmetic import warnings (and favicon) are ignored. Never rejects:
 * a genuine deadlock is instead caught by the preload-complete timeout.
 */
function waitForFatalRuntimeFailure(page: Page): Promise<string> {
    return new Promise((resolve) => {
        const onConsole = (message: ConsoleMessage) => {
            if (message.type() !== 'error') {
                return;
            }
            const text = message.text();
            if (text.includes('favicon.ico') || isKnownRuntimeNoise(text)) {
                return;
            }
            page.off('console', onConsole);
            page.off('pageerror', onPageError);
            resolve(text);
        };
        const onPageError = (error: Error) => {
            page.off('console', onConsole);
            page.off('pageerror', onPageError);
            resolve(error.message);
        };
        page.on('console', onConsole);
        page.on('pageerror', onPageError);
    });
}

test.describe('FortWeb Pyodide boot canary', () => {
    test(
        'worker reaches real Pyodide preload complete',
        { tag: '@slow' },
        async ({ page }) => {
            test.setTimeout(120_000);

            const pageErrors = collectUnexpectedPageErrors(page);
            const consoleErrors = collectUnexpectedConsoleErrors(page);

            const preloadComplete = page.waitForEvent('console', {
                predicate: (message) =>
                    message.worker() !== null &&
                    message.type() === 'log' &&
                    message.text().startsWith('[worker] preload complete'),
                timeout: 90_000,
            });

            const fatalFailure = waitForFatalRuntimeFailure(page);

            await page.goto('/fortweb/app/');

            const outcome = await Promise.race([
                preloadComplete.then((message) => ({ status: 'success' as const, message })),
                fatalFailure.then((text) => ({ status: 'fatal' as const, text })),
            ]).catch(() => ({ status: 'timeout' as const }));

            if (outcome.status === 'fatal') {
                throw new Error(`Pyodide boot failed before preload complete:\n${outcome.text}`);
            }

            if (outcome.status === 'timeout') {
                const observed = [...pageErrors, ...consoleErrors].join('\n');
                throw new Error(
                    `Pyodide preload did not complete within 90s.${observed ? `\nObserved errors:\n${observed}` : ''}`,
                );
            }

            expect(outcome.message.worker()).not.toBeNull();
            expect(outcome.message.text()).toMatch(/^\[worker\] preload complete/);
            await expect(page.locator('#app-root')).toBeAttached();
            expect(pageErrors).toEqual([]);
            expect(consoleErrors).toEqual([]);
        },
    );
});
