import { expect, test, type BrowserContext } from '@playwright/test';
import { collectBrowserErrors, expectNoBrowserErrors } from './utils/error-collector.js';

const applicationOrigin = new URL(process.env['FORTWEB_BASE_URL'] ?? '').origin;
const rejectedExternalRequests = new WeakMap<BrowserContext, string[]>();

test.beforeEach(async ({ context }) => {
    const rejected: string[] = [];
    rejectedExternalRequests.set(context, rejected);
    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== applicationOrigin) {
            rejected.push(url.href);
            await route.abort('blockedbyclient');
            return;
        }
        await route.continue();
    });
});

test.afterEach(async ({ context }) => {
    const rejected = rejectedExternalRequests.get(context) ?? [];
    try {
        expect(rejected).toEqual([]);
        console.log('application-network-guard external=0');
    } finally {
        await context.unroute('**/*');
        rejectedExternalRequests.delete(context);
    }
});

test.describe('FortWeb empty and error states', () => {
    test('witnesses connected fixture renders cleanly', async ({ page }) => {
        const browserErrors = collectBrowserErrors(page);

        await page.goto('/fortweb/app/index.html#/_fixtures/witnesses/connected');

        // Assert Witnesses page renders
        await expect(page.getByRole('heading', { name: 'Witnesses', level: 1 })).toBeVisible();

        // Assert connected state is visible (no disconnected badge)
        await expect(page.locator('.badge--success')).toContainText('Connected');

        await expectNoBrowserErrors(page, browserErrors);
    });

    test('witnesses error fixture renders cleanly without raw HTML', async ({ page }) => {
        const browserErrors = collectBrowserErrors(page);

        await page.goto('/fortweb/app/index.html#/_fixtures/witnesses/error');

        // Assert Witnesses page renders
        await expect(page.getByRole('heading', { name: 'Witnesses', level: 1 })).toBeVisible();

        // Assert error state is shown cleanly
        await expect(page.locator('.notice--warning')).toContainText('Failed to load hosted witness rows');

        // Assert no raw HTML document is dumped into the visible UI
        const pageText = await page.locator('body').innerText();
        expect(pageText).not.toContain('<html>');
        expect(pageText).not.toContain('<body>');
        // Note: 'HTTP 503' is intentionally part of the fixture's user-facing error message.

        await expectNoBrowserErrors(page, browserErrors);
    });

    test('watchers populated fixture renders cleanly', async ({ page }) => {
        const browserErrors = collectBrowserErrors(page);

        await page.goto('/fortweb/app/index.html#/_fixtures/watchers/populated');

        // Assert Watchers page renders
        await expect(page.getByRole('heading', { name: 'Watchers', level: 1 })).toBeVisible();

        // Assert populated watcher data is visible (stable row text)
        await expect(page.getByRole('cell', { name: 'KF Watcher EWatcher0' })).toBeVisible();

        await expectNoBrowserErrors(page, browserErrors);
    });
});
