import { expect, test } from '@playwright/test';
import { collectUnexpectedConsoleErrors } from './utils/error-collector.js';
import { isKnownRuntimeNoise } from './utils/runtime-noise.js';

const COSMETIC_WARNING =
    "/lib/python3.13/site-packages/keri/kering.py:53: SyntaxWarning: invalid escape sequence";

/**
 * Prove the shared console-error collector policy modes:
 *
 * - Default (ignoreKnownRuntimeNoise: true) → filters favicon + cosmetic Python
 *   import warnings, but NEVER filters fatal runtime failures.
 * - Strict  (ignoreKnownRuntimeNoise: false) → filters favicon only.
 */
test.describe('runtime-noise matcher', () => {
    test('classifies only cosmetic import warnings as noise', () => {
        expect(isKnownRuntimeNoise(COSMETIC_WARNING)).toBe(true);
        expect(isKnownRuntimeNoise("ModuleNotFoundError: No module named 'keri'")).toBe(false);
        expect(
            isKnownRuntimeNoise("Failed to load 'http://127.0.0.1/wheels/keri_web-2.0.0.dev6-py3-none-any.whl': request failed."),
        ).toBe(false);
        expect(
            isKnownRuntimeNoise(
                'File "/lib/python3.13/site-packages/keri/app/__init__.py", line 3, in <module>\nModuleNotFoundError: No module named \'keri\'',
            ),
        ).toBe(false);
    });
});

test.describe('console error collector policy', () => {
    test('default mode suppresses known cosmetic Python runtime noise', async ({ page }) => {
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.evaluate((warning) => console.error(warning), COSMETIC_WARNING);
        await page.evaluate(() => console.error('unrelated genuine error'));

        await page.waitForTimeout(100);
        expect(consoleErrors).toEqual(['unrelated genuine error']);
    });

    test('default mode captures ModuleNotFoundError', async ({ page }) => {
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.evaluate(() => console.error("ModuleNotFoundError: No module named 'keri'"));

        await page.waitForTimeout(100);
        expect(consoleErrors).toEqual(["ModuleNotFoundError: No module named 'keri'"]);
    });

    test('default mode captures Failed to load', async ({ page }) => {
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.evaluate(() =>
            console.error("Failed to load 'http://127.0.0.1/wheels/keri_web-2.0.0.dev6-py3-none-any.whl': request failed."),
        );

        await page.waitForTimeout(100);
        expect(consoleErrors).toEqual([
            "Failed to load 'http://127.0.0.1/wheels/keri_web-2.0.0.dev6-py3-none-any.whl': request failed.",
        ]);
    });

    test('default mode captures a fatal traceback containing a site-packages path', async ({ page }) => {
        const consoleErrors = collectUnexpectedConsoleErrors(page);
        const fatalTraceback =
            'File "/lib/python3.13/site-packages/keri/app/__init__.py", line 3, in <module>\n' +
            "ModuleNotFoundError: No module named 'keri'";

        await page.evaluate((text) => console.error(text), fatalTraceback);

        await page.waitForTimeout(100);
        expect(consoleErrors).toEqual([fatalTraceback]);
    });

    test('strict mode records known cosmetic Python runtime noise', async ({ page }) => {
        const consoleErrors = collectUnexpectedConsoleErrors(page, { ignoreKnownRuntimeNoise: false });

        await page.evaluate((warning) => console.error(warning), COSMETIC_WARNING);
        await page.evaluate(() => console.error('unrelated genuine error'));

        await page.waitForTimeout(100);
        expect(consoleErrors).toHaveLength(2);
        expect(consoleErrors[0]).toContain('SyntaxWarning: invalid escape sequence');
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
