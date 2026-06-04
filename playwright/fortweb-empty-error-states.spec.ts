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
        
        // Assert no raw HTML is dumped into the visible UI
        const pageText = await page.locator('body').innerText();
        expect(pageText).not.toContain('<html>');
        expect(pageText).not.toContain('<body>');
        expect(pageText).not.toContain('HTTP 503');

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
