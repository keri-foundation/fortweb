import { expect, type Page } from '@playwright/test';
import { isKnownRuntimeNoise } from './runtime-noise.js';

export type ConsoleErrorCollectorOptions = {
    /** When true (default), suppress console errors matching isKnownRuntimeNoise.
     *  Set false for strict mode where only favicon errors are ignored. */
    ignoreKnownRuntimeNoise?: boolean;
};

export function collectUnexpectedPageErrors(page: Page): string[] {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
        pageErrors.push(error.message);
    });
    return pageErrors;
}

export function collectUnexpectedConsoleErrors(
    page: Page,
    options?: ConsoleErrorCollectorOptions,
): string[] {
    const ignoreRuntimeNoise = options?.ignoreKnownRuntimeNoise ?? true;

    const consoleErrors: string[] = [];
    page.on('console', (message) => {
        if (message.type() !== 'error') {
            return;
        }

        const text = message.text();
        if (text.includes('favicon.ico')) {
            return;
        }
        if (ignoreRuntimeNoise && isKnownRuntimeNoise(text)) {
            return;
        }

        consoleErrors.push(text);
    });
    return consoleErrors;
}

export async function expectNoUnexpectedErrors(page: Page, pageErrors: string[], consoleErrors: string[]): Promise<void> {
    await page.waitForTimeout(250);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
}
