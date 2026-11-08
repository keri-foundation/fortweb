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

test.describe('FortWeb runtime origin contract missing behavior', () => {
    test('allows startup in local browser dev when contract is missing', async ({ page }) => {
        const browserErrors = collectBrowserErrors(page);

        // Explicitly ensure the contract is missing (it should be by default in local dev)
        await page.addInitScript(() => {
            // @ts-expect-error: deleting optional window property
            delete window.__FORT_RUNTIME_ORIGIN__;
        });

        await page.goto('/fortweb/app/index.html');

        // Assert the app renders the home page (vault landing page)
        // instead of crashing or showing a startup error.
        await expect(page.locator('.home-splash')).toBeVisible();
        await expect(page.locator('.topbar__brand-link')).toBeVisible();

        // Verify no unexpected errors were thrown due to the missing contract
        await expectNoBrowserErrors(page, browserErrors);
    });
});
