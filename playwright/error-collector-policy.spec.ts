import { expect, test } from '@playwright/test';
import { collectUnexpectedConsoleErrors } from './utils/error-collector.js';

/**
 * Prove the shared console-error collector policy modes:
 *
 * - Default (ignoreKnownRuntimeNoise: true) → filters favicon + Python/runtime noise
 * - Strict  (ignoreKnownRuntimeNoise: false) → filters favicon only
 *
 * Uses a representative isKnownRuntimeNoise string from runtime-noise.ts
 * so the test stays coupled to the real pattern without a vague matcher.
 */
test.describe('console error collector policy', () => {
    test('default mode suppresses known Python runtime noise', async ({ page }) => {
        const consoleErrors = collectUnexpectedConsoleErrors(page);
        // default: ignoreKnownRuntimeNoise = true

        await page.evaluate(() =>
            console.error('/lib/python3.13/site-packages/pyodide/_core.py:42: RuntimeWarning: example'),
        );
        await page.evaluate(() =>
            console.error('unrelated genuine error'),
        );

        await page.waitForTimeout(100);
        expect(consoleErrors).toEqual(['unrelated genuine error']);
    });

    test('strict mode records known Python runtime noise', async ({ page }) => {
        const consoleErrors = collectUnexpectedConsoleErrors(page, { ignoreKnownRuntimeNoise: false });

        await page.evaluate(() =>
            console.error('/lib/python3.13/site-packages/pyodide/_core.py:42: RuntimeWarning: example'),
        );
        await page.evaluate(() =>
            console.error('unrelated genuine error'),
        );

        await page.waitForTimeout(100);
        expect(consoleErrors).toHaveLength(2);
        expect(consoleErrors[0]).toContain('/lib/python3.13/site-packages/');
        expect(consoleErrors[1]).toEqual('unrelated genuine error');
    });

    test('both modes suppress favicon errors', async ({ page }) => {
        const defaultErrors = collectUnexpectedConsoleErrors(page);
        const strictErrors = collectUnexpectedConsoleErrors(page, { ignoreKnownRuntimeNoise: false });

        await page.evaluate(() => console.error('GET /favicon.ico 404'));

        await page.waitForTimeout(100);
        expect(defaultErrors).toEqual([]);
        expect(strictErrors).toEqual([]);
    });

    test('both modes record ordinary console errors', async ({ page }) => {
        const defaultErrors = collectUnexpectedConsoleErrors(page);
        const strictErrors = collectUnexpectedConsoleErrors(page, { ignoreKnownRuntimeNoise: false });

        await page.evaluate(() => console.error('something bad happened'));

        await page.waitForTimeout(100);
        expect(defaultErrors).toEqual(['something bad happened']);
        expect(strictErrors).toEqual(['something bad happened']);
    });
});
