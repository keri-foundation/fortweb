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
    test('core route keeps provider nav collapsed', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures/identifiers/populated');

        // Assert page renders expected identifiers content
        await expect(page.getByText('Local Identifiers')).toBeVisible();

        // Assert core sidebar remains visible
        await expect(page.locator('.lk-sidebar')).toBeVisible();

        // Assert provider nav is collapsed (lacks 'is-open' class)
        const pluginLinks = page.locator('.lk-sidebar__plugin-links');
        await expect(pluginLinks).not.toHaveClass(/is-open/);

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('KF witnesses route expands provider nav', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures/witnesses/account');

        // Assert witnesses page/account state renders
        await expect(page.getByText('Hosted Witnesses')).toBeVisible();

        // Assert provider nav is expanded (has 'is-open' class)
        const pluginLinks = page.locator('.lk-sidebar__plugin-links');
        await expect(pluginLinks).toHaveClass(/is-open/);

        // Assert Witnesses plugin link is visibly active
        const witnessesLink = page.locator('.lk-sidebar__plugin-links a:has-text("Witnesses")');
        await expect(witnessesLink).toHaveClass(/is-active/);

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('KF watchers route expands provider nav', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/#/_fixtures/watchers/populated');

        // Assert watchers page renders
        await expect(page.getByRole('heading', { name: 'Watchers', exact: true })).toBeVisible();

        // Assert provider nav is expanded (has 'is-open' class)
        const pluginLinks = page.locator('.lk-sidebar__plugin-links');
        await expect(pluginLinks).toHaveClass(/is-open/);

        // Assert Watchers plugin link is visibly active
        const watchersLink = page.locator('.lk-sidebar__plugin-links a:has-text("Watchers")');
        await expect(watchersLink).toHaveClass(/is-active/);

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });
});
