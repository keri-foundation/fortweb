import { expect, test, type Page } from '@playwright/test';
import { collectBrowserErrors, formatBrowserFailures } from './utils/error-collector.js';

type FixtureLink = { label: string; route: string };

async function navigateFixtureAndWaitForRender(page: Page, route: string): Promise<void> {
    await page.evaluate((nextRoute) => new Promise<void>((resolve, reject) => {
        const root = document.querySelector('#app-root');
        if (!root) {
            reject(new Error('FortWeb app root is missing'));
            return;
        }

        const observer = new MutationObserver(() => {
            const pageContent = root.querySelector('[data-page-content]');
            const heading = pageContent?.querySelector('h1, h2, h3');
            if (location.hash === `#${nextRoute}` && heading?.textContent?.trim()) {
                observer.disconnect();
                requestAnimationFrame(() => resolve());
            }
        });

        observer.observe(root, { childList: true, subtree: true, characterData: true });
        location.hash = `#${nextRoute}`;
    }), route);

    const pageContent = page.locator('[data-page-content]');
    await expect(pageContent, `${route}: fixture page content should be visible`).toBeVisible();
    const text = await pageContent.innerText();
    expect(text.trim(), `${route}: fixture page content should not be empty`).not.toBe('');
    await expect(pageContent.locator('h1, h2, h3').first(), `${route}: fixture should render a heading`).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Route Not Found' }), `${route}: fixture route should resolve`).toHaveCount(0);
}

test.describe('FortWeb fixture browser execution health', () => {
    test('fixture registry renders without unexpected browser errors', async ({ page }) => {
        test.setTimeout(300_000);
        let activeFixture = '/_fixtures';
        const browserErrors = collectBrowserErrors(page, () => activeFixture);

        await page.addInitScript(() => {
            const messages: Array<{ type?: string; message?: string }> = [];
            Object.defineProperty(window, '__fortwebNativeMessages', {
                configurable: false,
                value: messages,
                writable: false,
            });
            window.webkit = {
                messageHandlers: {
                    bridge: {
                        postMessage(payload: { type?: string; message?: string }) {
                            messages.push(structuredClone(payload));
                        },
                    },
                },
            };
        });

        try {
            await page.goto('/fortweb/app/index.html#/_fixtures');
            const indexHeading = page.getByRole('heading', { name: 'Fixture Routes', exact: true });
            await expect(indexHeading).toBeVisible();
            await expect(page.locator('[data-page-content]')).not.toBeEmpty();

            // Wait for the real runtime worker so its asynchronous console output is included.
            await page.waitForFunction(() => (
                (window as typeof window & { __fortwebNativeMessages?: Array<{ message?: string }> })
                    .__fortwebNativeMessages?.some(({ message }) => message?.includes('event=worker_preload_complete'))
            ), undefined, { timeout: 240_000 });

            const fixtureLinks = await page.locator('[data-page-content] a[href^="#/_fixtures/"]').evaluateAll(
                (links) => links.map((link) => ({
                    label: link.textContent?.trim() ?? '',
                    route: new URL((link as HTMLAnchorElement).href).hash.slice(1),
                })),
            ) as FixtureLink[];
            expect(fixtureLinks.length, 'fixture index should expose the current fixture registry').toBeGreaterThan(0);

            for (const fixture of fixtureLinks) {
                activeFixture = fixture.route;
                await navigateFixtureAndWaitForRender(page, fixture.route);
                const routeFailures = browserErrors.failures.filter((failure) => failure.route === fixture.route);
                expect(routeFailures, formatBrowserFailures(routeFailures)).toEqual([]);
            }

            activeFixture = '/_fixtures';
            expect(browserErrors.failures, formatBrowserFailures(browserErrors.failures)).toEqual([]);
        } finally {
            browserErrors.dispose();
        }
    });

    test('collector catches a test-only console.error', async ({ page }) => {
        const route = '/negative-control/console-error';
        const browserErrors = collectBrowserErrors(page, () => route);
        try {
            await page.goto('about:blank');
            await page.evaluate(() => console.error('FORTWEB_TEST_CONSOLE_SENTINEL'));
            await expect.poll(() => browserErrors.failures.some((failure) => (
                failure.channel === 'console.error' && failure.message.includes('FORTWEB_TEST_CONSOLE_SENTINEL')
            ))).toBe(true);
            expect(formatBrowserFailures(browserErrors.failures)).toContain(`${route}:\n  console.error: FORTWEB_TEST_CONSOLE_SENTINEL`);
        } finally {
            browserErrors.dispose();
        }
    });

    test('collector catches a test-only uncaught page exception', async ({ page }) => {
        const route = '/negative-control/pageerror';
        const browserErrors = collectBrowserErrors(page, () => route);
        try {
            await page.goto('about:blank');
            await page.evaluate(() => {
                window.setTimeout(() => { throw new Error('FORTWEB_TEST_PAGEERROR_SENTINEL'); }, 0);
            });
            await expect.poll(() => browserErrors.failures.some((failure) => (
                failure.channel === 'pageerror' && failure.message.includes('FORTWEB_TEST_PAGEERROR_SENTINEL')
            ))).toBe(true);
            expect(formatBrowserFailures(browserErrors.failures)).toContain(`${route}:\n  pageerror: FORTWEB_TEST_PAGEERROR_SENTINEL`);
        } finally {
            browserErrors.dispose();
        }
    });
});
