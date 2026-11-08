import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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

function isKnownRuntimeNoise(text: string): boolean {
    return (
        text.includes('SyntaxWarning: invalid escape sequence') ||
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
    test('responsive navigation is accessible only while open', async ({ page }) => {
        await page.setViewportSize({ width: 868, height: 998 });
        await page.goto('/fortweb/app/index.html#/_fixtures/identifiers/populated');
        const navigation = page.getByRole('navigation', { name: 'Vault navigation' });
        await expect(navigation).not.toBeVisible();
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await expect(navigation).toBeVisible();
        await expect(navigation.getByRole('link', { name: 'KERI Foundation', exact: true })).toBeVisible();
        await page.getByRole('banner').getByRole('button', { name: 'Close navigation' }).click();
        await expect(navigation).not.toBeVisible();
    });

    test('mobile navigation toggle reflects state and supports each close path', async ({ page }) => {
        await page.goto('/fortweb/app/index.html#/_fixtures/identifiers/populated');

        const toggle = page.locator('.topbar__menu');
        const navigation = page.getByRole('navigation', { name: 'Vault navigation' });
        const sidebar = page.locator('.lk-sidebar-shell');
        const overlay = page.locator('.lk-sidebar-overlay');
        const responsiveWidths = [
            { width: 390, height: 844, closeWith: 'toggle' },
            { width: 360, height: 800, closeWith: 'overlay' },
            { width: 768, height: 1024, closeWith: 'escape' },
        ] as const;

        for (const viewport of responsiveWidths) {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await expect(toggle).toBeVisible();
            await expect(toggle).toHaveAttribute('aria-label', 'Open navigation');
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            await expect(toggle.locator('img')).toHaveAttribute('src', './assets/icons/menu.svg');
            await expect(sidebar).not.toHaveClass(/is-open/);
            await expect(overlay).not.toHaveClass(/is-open/);

            await toggle.click();
            await expect(toggle).toHaveAttribute('aria-label', 'Close navigation');
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            await expect(toggle.locator('img')).toHaveAttribute('src', './assets/icons/close.svg');
            await expect.poll(() => toggle.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
            await expect(toggle).toBeFocused();
            await expect(navigation).toBeVisible();
            await expect(sidebar).toHaveClass(/is-open/);
            await expect(overlay).toHaveClass(/is-open/);

            if (viewport.closeWith === 'toggle') {
                await toggle.click();
            } else if (viewport.closeWith === 'overlay') {
                const overlayBox = await overlay.boundingBox();
                if (!overlayBox) {
                    throw new Error('Expected the open navigation overlay to have a visible bounding box.');
                }
                await overlay.click({ position: { x: overlayBox.width - 2, y: 20 } });
            } else {
                await page.keyboard.press('Escape');
            }

            await expect(toggle).toHaveAttribute('aria-label', 'Open navigation');
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            await expect(toggle.locator('img')).toHaveAttribute('src', './assets/icons/menu.svg');
            await expect(navigation).not.toBeVisible();
            await expect(sidebar).not.toHaveClass(/is-open/);
            await expect(overlay).not.toHaveClass(/is-open/);
            await expect(toggle).toBeFocused();
        }

        await page.setViewportSize({ width: 1280, height: 720 });
        await expect(navigation).toBeVisible();
        await expect(toggle).not.toBeVisible();
        await expect(overlay).not.toBeVisible();
    });

    test('desktop keeps persistent navigation and makes the mobile overlay inert', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto('/fortweb/app/index.html#/_fixtures/identifiers/populated');

        const toggle = page.locator('.topbar__menu');
        const navigation = page.getByRole('navigation', { name: 'Vault navigation' });
        const sidebar = page.locator('.lk-sidebar-shell');
        const overlay = page.locator('.lk-sidebar-overlay');

        await expect(navigation).toBeVisible();
        await expect(toggle).not.toBeVisible();
        await expect(sidebar).toHaveCSS('position', 'static');
        await expect(sidebar).toHaveCSS('transform', 'none');
        await expect(overlay).not.toBeVisible();
        await expect(overlay).toHaveCSS('display', 'none');
        await expect(overlay).toHaveCSS('pointer-events', 'none');

        await overlay.evaluate((element) => element.classList.add('is-open'));
        await expect(overlay).not.toBeVisible();
        await expect(overlay).toHaveCSS('pointer-events', 'none');
        await overlay.evaluate((element) => (element as HTMLButtonElement).focus());
        await expect(overlay).not.toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });

    test('navigation switches cleanly at the 920/921px boundary', async ({ page }) => {
        await page.goto('/fortweb/app/index.html#/_fixtures/identifiers/populated');

        const toggle = page.locator('.topbar__menu');
        const navigation = page.getByRole('navigation', { name: 'Vault navigation' });
        const sidebar = page.locator('.lk-sidebar-shell');
        const overlay = page.locator('.lk-sidebar-overlay');

        await page.setViewportSize({ width: 920, height: 900 });
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(navigation).not.toBeVisible();
        await expect(sidebar).not.toBeVisible();
        await expect(overlay).not.toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

        await page.setViewportSize({ width: 921, height: 900 });
        await expect(toggle).not.toBeVisible();
        await expect(navigation).toBeVisible();
        await expect(sidebar).toHaveCSS('position', 'static');
        await expect(overlay).not.toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });

    test('resizing from an open drawer to desktop resets mobile navigation state', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/fortweb/app/index.html#/_fixtures/identifiers/populated');

        const toggle = page.locator('.topbar__menu');
        const navigation = page.getByRole('navigation', { name: 'Vault navigation' });
        const sidebar = page.locator('.lk-sidebar-shell');
        const overlay = page.locator('.lk-sidebar-overlay');

        await expect(toggle).toHaveAttribute('aria-label', 'Open navigation');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-label', 'Close navigation');
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(navigation).toBeVisible();
        await expect(overlay).toBeVisible();

        await page.setViewportSize({ width: 1280, height: 720 });
        await expect(toggle).not.toBeVisible();
        await expect(toggle).toHaveAttribute('aria-label', 'Open navigation');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(navigation).toBeVisible();
        await expect(sidebar).not.toHaveClass(/is-open/);
        await expect(overlay).not.toBeVisible();
        await expect(overlay).not.toHaveClass(/is-open/);

        await page.setViewportSize({ width: 390, height: 844 });
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-label', 'Open navigation');
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(navigation).not.toBeVisible();
        await expect(sidebar).not.toBeVisible();
        await expect(overlay).not.toBeVisible();
    });

    for (const startup of ['delayed', 'failed'] as const) {
        test(`vault drawer works while runtime startup is ${startup}`, async ({ page }) => {
            const pageErrors = collectUnexpectedPageErrors(page);
            let releaseConfig!: () => void;
            const configGate = new Promise<void>((resolve) => { releaseConfig = resolve; });
            let requestedConfig!: () => void;
            const configRequested = new Promise<void>((resolve) => { requestedConfig = resolve; });
            await page.route('**/pyscript-ci.toml', async (route) => {
                requestedConfig();
                if (startup === 'delayed') {
                    await configGate;
                }
                await route.fulfill({ status: 503, body: 'Runtime unavailable' });
            });

            try {
                await page.goto('/fortweb/app/index.html#/');
                await configRequested;
                await page.locator('[data-action="toggle-drawer"]').click();
                const drawer = page.getByRole('dialog', { name: 'Vault switcher' });
                await expect(drawer).toBeVisible();
                await drawer.getByRole('button', { name: 'Initialize New Vault' }).click();
                await expect(page.locator('[data-create-vault-form]')).toBeVisible();
                await page.getByRole('button', { name: 'Cancel', exact: true }).click();
                await expect(drawer).not.toBeVisible();
                await page.locator('[data-action="toggle-drawer"]').click();
                await expect(drawer).toBeVisible();
                await drawer.getByRole('button', { name: 'Close vault switcher' }).click();
                await expect(drawer).not.toBeVisible();
                expect(pageErrors).toEqual([]);
            } finally {
                releaseConfig();
            }
        });
    }

    test('core route shows main nav with KERI Foundation entry', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/index.html#/_fixtures/identifiers/populated');

        // Assert page renders expected identifiers content
        await expect(page.getByText('Local Identifiers')).toBeVisible();

        // Assert core sidebar is visible
        await expect(page.locator('.lk-sidebar')).toBeVisible();

        // Assert core nav links are present
        const sidebarNav = page.locator('.lk-sidebar__nav');
        await expect(sidebarNav.getByRole('link', { name: 'Identifiers', exact: true })).toBeVisible();
        await expect(sidebarNav.getByRole('link', { name: 'Remote Identifiers', exact: true })).toBeVisible();
        await expect(sidebarNav.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();

        // Assert KERI Foundation entry is present (single entry, not expanded)
        const kfEntry = page.locator('.lk-sidebar__plugin-entry a:has-text("KERI Foundation")');
        await expect(kfEntry).toBeVisible();

        // Assert KERI Foundation entry href points to kf-home route
        await expect(kfEntry).toHaveAttribute('href', /\/kf$/);

        // Assert plugin child links are NOT present (no inline expansion)
        await expect(page.locator('.lk-sidebar__plugin-links')).not.toBeVisible();

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('KF witnesses route shows provider menu with Back button', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/index.html#/_fixtures/witnesses/account');

        // Assert witnesses page renders
        await expect(page.getByText('Hosted Witnesses')).toBeVisible();

        // Assert provider sidebar is visible
        await expect(page.locator('.lk-sidebar')).toBeVisible();

        // Assert Back button is present
        await expect(page.locator('.lk-sidebar__back')).toBeVisible();
        await expect(page.locator('.lk-sidebar__back span:has-text("Back")')).toBeVisible();

        // Assert KERI Foundation branding is present
        await expect(page.locator('.lk-sidebar__plugin-brand-link')).toBeVisible();
        await expect(page.locator('.lk-sidebar__plugin-brand-label:has-text("KERI Foundation")')).toBeVisible();

        // Assert plugin nav links are present
        await expect(page.getByRole('link', { name: 'Identifiers', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Witnesses', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Watchers', exact: true })).toBeVisible();

        // Assert Witnesses link is active
        const witnessesLink = page.getByRole('link', { name: 'Witnesses', exact: true });
        await expect(witnessesLink).toHaveClass(/is-active/);

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

    test('KF watchers route shows provider menu with active state', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page);

        await page.goto('/fortweb/app/index.html#/_fixtures/watchers/populated');

        // Assert watchers page renders
        await expect(page.getByRole('heading', { name: 'Watchers', exact: true })).toBeVisible();

        // Assert provider sidebar is visible
        await expect(page.locator('.lk-sidebar')).toBeVisible();

        // Assert Back button is present
        await expect(page.locator('.lk-sidebar__back')).toBeVisible();

        // Assert Watchers link is active
        const watchersLink = page.getByRole('link', { name: 'Watchers', exact: true });
        await expect(watchersLink).toHaveClass(/is-active/);

        await expectNoUnexpectedErrors(page, pageErrors, consoleErrors);
    });

});
