import { expect, test, type Page, type Request } from '@playwright/test';
import { listFixtureKeys } from '../dist/runtime/app/fixtures/fixture-router.js';

const applicationOrigin = new URL(process.env['FORTWEB_BASE_URL'] ?? 'http://127.0.0.1:4173').origin;

// The app document and ordinary browser-loaded UI resources are static frontend
// assets. fetch/xhr/websocket and other requests are intentionally excluded:
// fixture API/runtime behavior is outside this asset-integrity gate.
const STATIC_FRONTEND_RESOURCE_TYPES = new Set([
    'document',
    'script',
    'stylesheet',
    'image',
    'font',
    'manifest',
    'media',
    'texttrack',
]);

interface FixtureRoute {
    name: string;
    route: string;
    render(page: Page): Promise<void>;
}

interface StaticAssetFailure {
    resourceType: string;
    status: number;
    url: string;
}

const fixtureRenderExpectations: Record<string, (page: Page) => Promise<void>> = {
    'vaults/empty': async (page) => expect(page.locator('.home-splash')).toBeVisible(),
    'vaults/populated': async (page) => expect(page.locator('.home-splash')).toBeVisible(),
    unlock: async (page) => expect(page.getByRole('heading', { name: 'Open Demo Vault' })).toBeVisible(),
    'identifiers/empty': async (page) => expect(page.getByRole('heading', { name: 'No Local Identifiers Yet' })).toBeVisible(),
    'identifiers/populated': async (page) => expect(page.getByRole('link', { name: 'primary-aid' })).toBeVisible(),
    'identifier-detail': async (page) => expect(page.getByRole('heading', { name: 'primary-aid' })).toBeVisible(),
    'remotes/empty': async (page) => expect(page.getByRole('heading', { name: 'No Remote Identifiers Yet' })).toBeVisible(),
    'remotes/populated': async (page) => expect(page.getByRole('link', { name: 'acme-corp' })).toBeVisible(),
    'remote-detail': async (page) => expect(page.getByRole('heading', { name: 'acme-corp' })).toBeVisible(),
    'witnesses/disconnected': async (page) => expect(page.getByRole('heading', { name: 'Witnesses', level: 1 })).toBeVisible(),
    'witnesses/connected': async (page) => expect(page.getByRole('heading', { name: 'Witnesses', level: 1 })).toBeVisible(),
    'witnesses/account': async (page) => expect(page.getByText('Hosted Witnesses')).toBeVisible(),
    'witnesses/error': async (page) => expect(page.locator('.notice--warning')).toContainText('Failed to load hosted witness rows'),
    'watchers/placeholder': async (page) => expect(page.getByRole('heading', { name: 'Watchers', level: 1 })).toBeVisible(),
    'watchers/populated': async (page) => expect(page.getByRole('heading', { name: 'Watchers', level: 1 })).toBeVisible(),
    settings: async (page) => expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible(),
};

const registeredFixtureKeys = listFixtureKeys();
const missingRenderExpectations = registeredFixtureKeys.filter((key) => !(key in fixtureRenderExpectations));
const removedFixtureExpectations = Object.keys(fixtureRenderExpectations).filter((key) => !registeredFixtureKeys.includes(key));

if (missingRenderExpectations.length || removedFixtureExpectations.length) {
    throw new Error([
        'Fixture asset sweep expectations do not match the application fixture registry.',
        missingRenderExpectations.length ? `Missing: ${missingRenderExpectations.join(', ')}` : '',
        removedFixtureExpectations.length ? `No longer registered: ${removedFixtureExpectations.join(', ')}` : '',
    ].filter(Boolean).join('\n'));
}

const fixtureRoutes: FixtureRoute[] = [
    {
        name: 'fixture index',
        route: '/_fixtures',
        render: async (page) => expect(page.getByRole('heading', { name: 'Fixture Routes' })).toBeVisible(),
    },
    ...registeredFixtureKeys.map((key) => ({
        name: key,
        route: `/_fixtures/${key}`,
        render: fixtureRenderExpectations[key],
    })),
];

function isStaticFrontendRequest(request: Request): boolean {
    const url = new URL(request.url());
    return url.origin === applicationOrigin && STATIC_FRONTEND_RESOURCE_TYPES.has(request.resourceType());
}

function collectStaticAssetFailures(page: Page, route: string): StaticAssetFailure[] {
    const failures: StaticAssetFailure[] = [];
    const seen = new Set<string>();
    page.on('response', (response) => {
        const request = response.request();
        const status = response.status();
        if (!isStaticFrontendRequest(request) || status < 400 || status > 599) {
            return;
        }

        const failure = {
            resourceType: request.resourceType(),
            status,
            url: response.url(),
        };
        const key = `${route}\n${failure.resourceType}\n${failure.status}\n${failure.url}`;
        if (!seen.has(key)) {
            seen.add(key);
            failures.push(failure);
        }
    });
    return failures;
}

function assertNoStaticAssetFailures(route: string, failures: StaticAssetFailure[]): void {
    const diagnostics = failures.map(({ resourceType, status, url }) => (
        `${route}: ${resourceType} ${status} ${url}`
    ));
    expect(diagnostics, diagnostics.join('\n')).toEqual([]);
}

async function waitForFixtureAssets(page: Page): Promise<void> {
    // page.goto waits for the document's load event. The route render assertion
    // waits for app startup, and these browser readiness promises settle fonts
    // and rendered images without an arbitrary delay.
    await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined)));
    });
}

test.describe('FortWeb fixture static asset integrity', () => {
    for (const fixture of fixtureRoutes) {
        test(`${fixture.name} renders without static asset failures`, async ({ page }) => {
            const failures = collectStaticAssetFailures(page, fixture.route);

            await page.goto(`/fortweb/app/index.html#${fixture.route}`);
            await fixture.render(page);
            await waitForFixtureAssets(page);

            assertNoStaticAssetFailures(fixture.route, failures);
        });
    }

    test('reports an injected missing static image as a failing asset gate', async ({ page }) => {
        const fixture = fixtureRoutes.find(({ route }) => route === '/_fixtures/remote-detail');
        if (!fixture) {
            throw new Error('The remote-detail fixture is required for the asset-gate negative control.');
        }

        await page.route('**/assets/icons/copy.svg', (route) => route.fulfill({ status: 404, body: 'missing test asset' }));
        const failures = collectStaticAssetFailures(page, fixture.route);

        await page.goto(`/fortweb/app/index.html#${fixture.route}`);
        await fixture.render(page);
        await page.locator('img[src$="/assets/icons/copy.svg"]').first().waitFor({ state: 'attached' });
        await waitForFixtureAssets(page);

        expect(failures).toEqual([expect.objectContaining({
            resourceType: 'image',
            status: 404,
            url: expect.stringContaining('/fortweb/app/assets/icons/copy.svg'),
        })]);
        expect(() => assertNoStaticAssetFailures(fixture.route, failures))
            .toThrow(/\/_fixtures\/remote-detail: image 404 .*copy\.svg/);
    });

    test('ignores a negative fetch response on the witnesses error fixture', async ({ page }) => {
        const fixture = fixtureRoutes.find(({ route }) => route === '/_fixtures/witnesses/error');
        if (!fixture) {
            throw new Error('The witnesses/error fixture is required for the API-boundary proof.');
        }

        await page.route('**/api/fixture-unavailable', (route) => route.fulfill({ status: 503, body: 'fixture API unavailable' }));
        const failures = collectStaticAssetFailures(page, fixture.route);

        await page.goto(`/fortweb/app/index.html#${fixture.route}`);
        await fixture.render(page);
        await waitForFixtureAssets(page);

        const apiResponse = page.waitForResponse((response) => response.url().endsWith('/fortweb/api/fixture-unavailable'));
        const apiStatus = await page.evaluate(async () => (
            (await fetch('/fortweb/api/fixture-unavailable')).status
        ));
        await apiResponse;

        expect(apiStatus).toBe(503);
        assertNoStaticAssetFailures(fixture.route, failures);
    });
});
