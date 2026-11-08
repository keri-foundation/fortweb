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

test.describe('FortWeb smoke', () => {
    test('app boot renders the vault landing page', async ({ page }) => {
        test.setTimeout(300_000);
        const browserErrors = collectBrowserErrors(page);
        const nativeMessages: Array<{ type?: string; message?: string }> = [];
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

        const runtimeConfig = await page.request.get('/fortweb/pyscript-ci.toml');
        expect(runtimeConfig.status()).toBe(200);
        expect(await runtimeConfig.text()).toMatch(/^sha256\s*=\s*"[0-9a-f]{64}"$/m);

        await page.goto('/fortweb/app/index.html');

        await expect(page.locator('#app-root')).toBeAttached();
        await expect(page.locator('.topbar__brand-link')).toBeVisible();
        await expect(page.locator('.topbar__title')).toHaveText('FortWeb');
        await expect(page.getByRole('heading', { name: 'FortWeb', exact: true })).toBeAttached();
        await expect(page.locator('.home-splash')).toBeVisible();
        await expect(page.locator('.shell-tabbar')).toHaveCount(0);
        await expect(page.getByText('Browser Wallet')).toHaveCount(0);
        await expect(page.getByText('Create your first vault to begin using the mobile wallet.')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Your Vaults' })).toHaveCount(0);
        await expect(page).toHaveTitle(/FortWeb \| FortWeb/);

        await page.waitForFunction(() => (
            (window as typeof window & { __fortwebNativeMessages?: Array<{ message?: string }> })
                .__fortwebNativeMessages?.some(({ message }) => message?.includes('event=worker_preload_complete'))
        ));
        await page.getByRole('button', { name: 'Vaults' }).click();
        await page.getByText('Initialize New Vault').click();
        const vaultName = `locked-settings-${Date.now()}`;
        await page.locator('[data-create-vault-form] input[name="name"]').fill(vaultName);
        await page.locator('[data-dialog-submit]').click();
        await expect(page.getByRole('heading', { name: `Open ${vaultName}` })).toBeVisible();
        const unlockHash = await page.evaluate(() => window.location.hash);
        const vaultId = decodeURIComponent(unlockHash.match(/^#\/vaults\/([^/]+)\/unlock$/)?.[1] ?? '');
        expect(vaultId).toBeTruthy();
        await page.getByRole('button', { name: 'Open', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Local Identifiers', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Lock vault' }).click();
        await expect(page.getByRole('heading', { name: `Open ${vaultName}` })).toBeVisible();

        await page.getByRole('button', { name: 'Vaults', exact: true }).click();
        const drawer = page.getByRole('dialog', { name: 'Vault switcher' });
        await drawer.getByRole('button', { name: 'Initialize New Vault' }).click();
        await expect(page.locator('[data-create-vault-form]')).toBeVisible();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'Vaults', exact: true }).click();
        await drawer.getByRole('button', { name: new RegExp(vaultName) }).click();
        await expect(drawer).not.toBeVisible();
        await expect(page.getByRole('heading', { name: `Open ${vaultName}` })).toBeVisible();

        await page.evaluate(() => {
            const scope = window as typeof window & { __fortwebNativeMessages?: Array<{ type?: string; message?: string }> };
            scope.__fortwebNativeMessages?.splice(0);
        });
        await page.evaluate((lockedVaultId) => {
            window.location.hash = `#/vaults/${encodeURIComponent(lockedVaultId)}/settings`;
        }, vaultId);
        await expect(page).toHaveURL(new RegExp(`#\/vaults\/${encodeURIComponent(vaultId)}\/unlock$`));
        await expect(page.getByRole('heading', { name: `Open ${vaultName}` })).toBeVisible();
        nativeMessages.push(...await page.evaluate(() => (
            (window as typeof window & { __fortwebNativeMessages?: Array<{ type?: string; message?: string }> })
                .__fortwebNativeMessages ?? []
        )));
        expect(nativeMessages.some(({ message }) => (
            message?.includes('event=request_start') && message.includes('method="settings.get"')
        ))).toBe(false);

        await expectNoBrowserErrors(page, browserErrors);
    });

    test('fixture index route lists deterministic fixture pages', async ({ page }) => {
        const browserErrors = collectBrowserErrors(page);

        await page.goto('/fortweb/app/index.html#/_fixtures');

        await expect(page.getByRole('heading', { name: 'Fixture Routes' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'vaults/populated' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'watchers/populated' })).toBeVisible();

        await expectNoBrowserErrors(page, browserErrors);
    });

    test('identifiers fixture renders populated table state', async ({ page }) => {
        const browserErrors = collectBrowserErrors(page);

        await page.goto('/fortweb/app/index.html#/_fixtures/identifiers/populated');

        await expect(page).toHaveTitle(/Identifiers \| FortWeb/);
        await expect(page.getByText('Local Identifiers')).toBeVisible();
        await expect(page.getByRole('link', { name: 'primary-aid' })).toBeVisible();

        await expectNoBrowserErrors(page, browserErrors);
    });

    test('witness fixture renders hosted witness account state', async ({ page }) => {
        const browserErrors = collectBrowserErrors(page);

        await page.goto('/fortweb/app/index.html#/_fixtures/witnesses/account');

        await expect(page).toHaveTitle(/KERI Foundation Witnesses \| FortWeb/);
        await expect(page.getByText('Hosted Witnesses')).toBeVisible();
        await expect(page.getByRole('cell', { name: 'KF Witness wan-0' })).toBeVisible();

        await expectNoBrowserErrors(page, browserErrors);
    });
});
