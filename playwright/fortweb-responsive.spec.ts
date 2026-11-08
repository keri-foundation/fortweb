import { expect, test } from '@playwright/test';

type Viewport = { name: string; width: number; height: number };
type Fixture = { name: string; route: string; heading: string; mobileHeading?: string; longValues?: boolean };
type Bounds = { left: number; right: number; top: number; bottom: number };

const viewports: Viewport[] = [
    { name: 'desktop', width: 1280, height: 720 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
];

const shellViewports = [
    ...viewports,
    { name: 'narrow mobile', width: 360, height: 800 },
];

const fixtures: Fixture[] = [
    { name: 'fixture index', route: '/_fixtures', heading: 'Fixture Routes' },
    { name: 'populated identifiers', route: '/_fixtures/identifiers/populated', heading: 'Local Identifiers', mobileHeading: 'primary-aid' },
    { name: 'identifier detail', route: '/_fixtures/identifier-detail', heading: 'primary-aid', longValues: true },
    { name: 'remote detail', route: '/_fixtures/remote-detail', heading: 'acme-corp', longValues: true },
    { name: 'witness account', route: '/_fixtures/witnesses/account', heading: 'Witnesses' },
    { name: 'settings', route: '/_fixtures/settings', heading: 'Settings' },
    { name: 'unlock form', route: '/_fixtures/unlock', heading: 'Open Demo Vault' },
];

const responsiveFixtures = fixtures.flatMap((fixture) =>
    viewports.map((viewport) => ({ fixture, viewport })),
);

async function openFixture(page: import('@playwright/test').Page, route: string, viewport: Viewport): Promise<void> {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/fortweb/app/index.html#${route}`);
}

async function readLayout(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
        const getBounds = (element: Element | null): Bounds | null => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        };

        return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            viewportWidth: window.innerWidth,
            shell: getBounds(document.querySelector('.shell')),
            main: getBounds(document.querySelector('main.shell__content')),
            page: getBounds(document.querySelector('[data-page-content]')),
            longValues: [...document.querySelectorAll('.detail-grid .detail-item dd')].map((element) => getBounds(element)),
        };
    });
}

function assertNoDocumentOverflow(layout: Awaited<ReturnType<typeof readLayout>>, fixture: string, viewport: Viewport): void {
    if (layout.scrollWidth > layout.clientWidth) {
        throw new Error(
            `${fixture} @ ${viewport.width}x${viewport.height}: document horizontal overflow: ` +
            `scrollWidth=${layout.scrollWidth}, clientWidth=${layout.clientWidth}`,
        );
    }
}

function assertInsideViewport(bounds: Bounds | null, label: string, width: number, context: string): void {
    expect(bounds, `${context}: ${label} should exist`).not.toBeNull();
    expect(bounds!.left, `${context}: ${label} left edge is outside the viewport`).toBeGreaterThanOrEqual(0);
    expect(bounds!.right, `${context}: ${label} right edge ${bounds!.right} exceeds viewport width ${width}`).toBeLessThanOrEqual(width);
}

for (const { fixture, viewport } of responsiveFixtures) {
    test(`${fixture.name} fits ${viewport.name} ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await openFixture(page, fixture.route, viewport);
        const expectedHeading = viewport.width <= 390 && fixture.mobileHeading ? fixture.mobileHeading : fixture.heading;
        const heading = page.getByRole('heading', { name: expectedHeading, exact: true });
        await expect(heading).toBeVisible();

        const context = `${fixture.name} @ ${viewport.width}x${viewport.height}`;
        const layout = await readLayout(page);
        assertNoDocumentOverflow(layout, fixture.name, viewport);
        assertInsideViewport(layout.shell, 'app shell', layout.viewportWidth, context);
        assertInsideViewport(layout.main, 'main content', layout.viewportWidth, context);
        assertInsideViewport(layout.page, 'fixture page content', layout.viewportWidth, context);

        const headingBounds = await heading.boundingBox();
        assertInsideViewport(headingBounds && {
            left: headingBounds.x,
            right: headingBounds.x + headingBounds.width,
            top: headingBounds.y,
            bottom: headingBounds.y + headingBounds.height,
        }, 'page heading', viewport.width, context);
        expect(headingBounds!.y, `${context}: page heading should begin within the viewport`).toBeLessThan(viewport.height);

        if (fixture.longValues) {
            expect(layout.longValues.length, `${context}: expected long identifier fields`).toBeGreaterThan(0);
            for (const [index, bounds] of layout.longValues.entries()) {
                assertInsideViewport(bounds, `long value ${index + 1}`, layout.viewportWidth, context);
            }
            const copyButton = page.getByRole('button', { name: 'Copy OOBI', exact: true });
            await expect(copyButton, `${context}: OOBI copy action should remain reachable`).toBeVisible();
            const copyBounds = await copyButton.boundingBox();
            assertInsideViewport(copyBounds && {
                left: copyBounds.x,
                right: copyBounds.x + copyBounds.width,
                top: copyBounds.y,
                bottom: copyBounds.y + copyBounds.height,
            }, 'OOBI copy action', viewport.width, context);
        }
    });
}

for (const viewport of shellViewports) {
    test(`navigation remains reachable at ${viewport.name} ${viewport.width}x${viewport.height}`, async ({ page }) => {
        await openFixture(page, '/_fixtures/identifiers/populated', viewport);
        const navigation = page.getByRole('navigation', { name: 'Vault navigation' });
        const openButton = page.getByRole('button', { name: 'Open navigation' });
        const context = `navigation @ ${viewport.width}x${viewport.height}`;

        if (viewport.width > 900) {
            await expect(navigation).toBeVisible();
            const navBounds = await navigation.boundingBox();
            assertInsideViewport(navBounds && {
                left: navBounds.x,
                right: navBounds.x + navBounds.width,
                top: navBounds.y,
                bottom: navBounds.y + navBounds.height,
            }, 'desktop navigation', viewport.width, context);
        } else {
            await expect(openButton).toBeVisible();
            await expect(navigation).toBeHidden();
            const buttonBounds = await openButton.boundingBox();
            assertInsideViewport(buttonBounds && {
                left: buttonBounds.x,
                right: buttonBounds.x + buttonBounds.width,
                top: buttonBounds.y,
                bottom: buttonBounds.y + buttonBounds.height,
            }, 'navigation toggle', viewport.width, context);

            await openButton.click();
            await expect(navigation).toBeVisible();
            const settingsLink = navigation.getByRole('link', { name: 'Settings', exact: true });
            await expect(settingsLink).toBeVisible();
            const navBounds = await navigation.boundingBox();
            assertInsideViewport(navBounds && {
                left: navBounds.x,
                right: navBounds.x + navBounds.width,
                top: navBounds.y,
                bottom: navBounds.y + navBounds.height,
            }, 'open navigation drawer', viewport.width, context);
            await openButton.click();
            await expect(navigation).toBeHidden();
        }
    });
}

for (const viewport of viewports.filter(({ width }) => width >= 768)) {
    test(`populated identifier table scrolls inside the page at ${viewport.name}`, async ({ page }) => {
        await openFixture(page, '/_fixtures/identifiers/populated', viewport);
        const layout = await readLayout(page);
        assertNoDocumentOverflow(layout, 'populated identifiers', viewport);

        const table = page.locator('.lk-table-wrap');
        await expect(table).toBeVisible();
        const tableMetrics = await table.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
                left: rect.left,
                right: rect.right,
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
                overflowX: getComputedStyle(element).overflowX,
            };
        });
        expect(tableMetrics.scrollWidth, `${viewport.name}: table should retain its intentional internal scroll`).toBeGreaterThan(tableMetrics.clientWidth);
        expect(['auto', 'scroll']).toContain(tableMetrics.overflowX);
        assertInsideViewport({ left: tableMetrics.left, right: tableMetrics.right, top: 0, bottom: 0 }, 'table container', layout.viewportWidth, `populated identifiers @ ${viewport.width}x${viewport.height}`);
    });
}

test('mobile populated identifiers use the stacked table layout', async ({ page }) => {
    const viewport = viewports[2];
    await openFixture(page, '/_fixtures/identifiers/populated', viewport);
    const layout = await readLayout(page);
    assertNoDocumentOverflow(layout, 'populated identifiers', viewport);
    await expect(page.locator('.lk-table-wrap')).toBeHidden();
    await expect(page.locator('.lk-table-stack')).toBeVisible();
});

test('document overflow validator catches an injected page-level overflow', async ({ page }) => {
    const viewport = viewports[2];
    await openFixture(page, '/_fixtures/settings', viewport);
    await page.addStyleTag({
        content: `
            html, body { overflow-x: visible !important; }
            .responsive-negative-control { position: absolute; left: 0; top: 1px; width: calc(100vw + 48px); height: 2px; }
        `,
    });
    await page.evaluate(() => {
        const overflowProbe = document.createElement('div');
        overflowProbe.className = 'responsive-negative-control';
        document.body.append(overflowProbe);
    });

    const layout = await readLayout(page);
    expect(layout.scrollWidth).toBeGreaterThan(layout.clientWidth);
    expect(() => assertNoDocumentOverflow(layout, 'settings', viewport)).toThrow(
        /settings @ 390x844: document horizontal overflow: scrollWidth=\d+, clientWidth=\d+/,
    );
});
