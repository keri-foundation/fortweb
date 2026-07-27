import { expect, test } from '@playwright/test';
import { collectUnexpectedPageErrors, collectUnexpectedConsoleErrors } from './utils/error-collector.js';

/**
 * Prove the vault drawer is usable before the Python bridge and vault
 * refresh are ready.
 *
 * PR #32 fixes a race where the drawer is null until refreshVaults
 * completes.  With the fix:
 *
 *  - initDrawer([]) runs before the first render;
 *  - drawer.open() runs before the async vault refresh.
 *
 * The test intercepts the PyScript configuration request so the worker
 * never starts loading.  The drawer must still open and present its
 * empty "Initialize New Vault" state while the config request remains
 * unresolved.
 */
test.describe('vault drawer readiness', () => {
    test('drawer opens while worker config request is still pending', async ({ page }) => {
        const pageErrors = collectUnexpectedPageErrors(page);
        const consoleErrors = collectUnexpectedConsoleErrors(page, { ignoreKnownRuntimeNoise: false });

        // Hold the PyScript configuration request so the worker never
        // starts loading and refreshVaults never completes.
        let releaseConfig: (() => void) | undefined;
        const configGate = new Promise<void>((resolve) => {
            releaseConfig = resolve;
        });

        await page.route('**/pyscript-ci.toml', async (route) => {
            await configGate;
            await route.continue();
        });

        try {
            await page.goto('/fortweb/app/', { waitUntil: 'domcontentloaded' });

            // The shell renders with the toggle-drawer button.
            const toggleBtn = page.locator('[data-action="toggle-drawer"]');
            await expect(toggleBtn).toBeVisible({ timeout: 5000 });

            // Click the toggle while the config request is still held.
            await toggleBtn.click();

            // The drawer must open even though the worker hasn't started.
            await expect(page.locator('.lk-drawer-root.is-open')).toBeVisible({ timeout: 3000 });
            await expect(page.locator('.lk-drawer__new-vault')).toBeVisible();
            await expect(page.locator('.lk-drawer__new-vault')).toContainText('Initialize New Vault');

            // No unhandled page error occurred.
            expect(pageErrors).toEqual([]);
        } finally {
            // Release the held request so the route handler can call
            // route.continue().  Do not unroute; the handler needs to
            // complete naturally.
            releaseConfig?.();
        }
    });
});
