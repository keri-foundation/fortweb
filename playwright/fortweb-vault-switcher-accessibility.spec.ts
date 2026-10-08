import { expect, test } from '@playwright/test';
import { VaultSwitcher } from './pages/vault-switcher.js';

async function openEmptyApplication(page: import('@playwright/test').Page): Promise<void> {
    await page.route('**/pyscript-ci.toml', (route) => route.fulfill({ status: 503, body: 'Runtime unavailable' }));
    await page.goto('/fortweb/app/index.html#/');
    await expect(page.getByRole('button', { name: 'Vaults', exact: true })).toBeVisible();
    await page.evaluate(() => {
        if (document.getElementById('fw-live-region')) {
            return;
        }
        const liveRegion = document.createElement('div');
        liveRegion.id = 'fw-live-region';
        liveRegion.setAttribute('role', 'status');
        liveRegion.setAttribute('aria-live', 'polite');
        document.body.append(liveRegion);
    });
}

test('empty vault switcher contains keyboard focus and restores its opener', async ({ page }) => {
    const switcher = new VaultSwitcher(page);
    await openEmptyApplication(page);

    await switcher.openWithKeyboard();
    await expect(switcher.dialog).toHaveAttribute('role', 'dialog');
    await expect(switcher.dialog).toHaveAttribute('aria-modal', 'true');
    await expect(switcher.dialog).toHaveAttribute('aria-label', 'Vault switcher');
    await expect(switcher.closeButton).toBeFocused();
    await expect(switcher.dialog.getByRole('list')).toBeEmpty();

    const closeButton = switcher.closeButton;
    const initializeButton = switcher.dialog.getByRole('button', { name: 'Initialize New Vault' });
    const background = page.locator('#app-root');
    await expect(background).toHaveJSProperty('inert', true);
    await expect(page.locator('#fw-live-region')).toHaveJSProperty('inert', false);

    for (const width of [1280, 411, 360]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(switcher.dialog).toBeVisible();

        await closeButton.focus();
        await page.keyboard.press('Shift+Tab');
        await expect(initializeButton).toBeFocused();

        await page.keyboard.press('Tab');
        await expect(closeButton).toBeFocused();

        await switcher.trigger.focus();
        await expect(closeButton).toBeFocused();
    }

    const lateBackgroundButton = await background.evaluate((root) => {
        const button = document.createElement('button');
        button.textContent = 'Late background control';
        root.append(button);
        return button.textContent;
    });
    const lateButton = page.getByRole('button', { name: lateBackgroundButton });
    await lateButton.focus();
    await expect(closeButton).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(switcher.dialog).toBeHidden();
    await expect(switcher.trigger).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(switcher.trigger).toBeFocused();

    await switcher.openWithKeyboard();
    await switcher.closeButton.click();
    await expect(switcher.dialog).toBeHidden();
    await expect(switcher.trigger).toBeFocused();

    await switcher.openWithKeyboard();
    await switcher.closeButton.evaluate((button) => {
        button.click();
        button.click();
    });
    await switcher.openWithKeyboard();
    await page.waitForTimeout(350);
    await expect(switcher.dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(switcher.dialog).toBeHidden();
    await expect(switcher.trigger).toBeFocused();
});

test('populated vault switcher traps current and refreshed vault controls', async ({ page }) => {
    await openEmptyApplication(page);

    await page.evaluate(async () => {
        const root = document.getElementById('app-root');
        if (!root) {
            throw new Error('Application root is missing.');
        }

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.textContent = 'Vaults';
        root.replaceChildren(trigger);

        const { createVaultDrawer } = await import('/fortweb/app/shared/components.js');
        const controller = createVaultDrawer({
            vaults: [
                { id: 'fixture-alpha', alias: 'Fixture Alpha', locked: true, identifierCount: 1, remoteCount: 0 },
                { id: 'fixture-beta', alias: 'Fixture Beta', locked: false, identifierCount: 2, remoteCount: 1 },
            ],
            onVaultClick(vault) {
                (window as typeof window & { selectedVaultId?: string }).selectedVaultId = vault.id;
            },
        });

        trigger.addEventListener('click', () => {
            if (controller.isOpen) {
                controller.close();
            } else {
                controller.open();
            }
        });
        (window as typeof window & { vaultDrawerController?: typeof controller }).vaultDrawerController = controller;
    });

    const switcher = new VaultSwitcher(page);
    await switcher.openWithKeyboard();
    const closeButton = switcher.closeButton;
    const vaultButtons = switcher.dialog.getByRole('button', { name: /Fixture (Alpha|Beta)/ });
    await expect(vaultButtons).toHaveCount(2);
    await expect(closeButton).toBeFocused();

    for (const width of [1280, 411, 360]) {
        await page.setViewportSize({ width, height: 900 });
        await closeButton.focus();
        await page.keyboard.press('Shift+Tab');
        await expect(switcher.dialog.getByRole('button', { name: /Fixture Beta/ })).toBeFocused();

        await page.keyboard.press('Tab');
        await expect(closeButton).toBeFocused();
    }

    await switcher.dialog.getByRole('button', { name: /Fixture Alpha/ }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (
        (window as typeof window & { selectedVaultId?: string }).selectedVaultId
    ))).toBe('fixture-alpha');

    await page.evaluate(() => {
        (window as typeof window & { selectedVaultId?: string }).selectedVaultId = undefined;
    });
    await switcher.dialog.getByRole('button', { name: /Fixture Beta/ }).focus();
    await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => (
        (window as typeof window & { selectedVaultId?: string }).selectedVaultId
    ))).toBe('fixture-beta');

    await page.evaluate(() => {
        (window as typeof window & { vaultDrawerController?: { refresh(vaults: object[]): void } })
            .vaultDrawerController?.refresh([
                { id: 'fixture-gamma', alias: 'Fixture Gamma', locked: true, identifierCount: 0, remoteCount: 0 },
            ]);
    });
    const refreshedVault = switcher.dialog.getByRole('button', { name: /Fixture Gamma/ });
    await expect(refreshedVault).toBeVisible();
    await refreshedVault.focus();
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();

    await page.evaluate(() => {
        (window as typeof window & { vaultDrawerController?: { close(): void } })
            .vaultDrawerController?.close();
    });
    await page.waitForTimeout(350);

    await page.evaluate(() => {
        const appRoot = document.getElementById('app-root');
        if (!appRoot) {
            throw new Error('Application root is missing.');
        }
        appRoot.inert = true;

        const opener = document.createElement('button');
        opener.textContent = 'External opener';
        document.body.insertBefore(opener, appRoot);
        opener.focus();

        const controller = (window as typeof window & {
            vaultDrawerController?: { open(): void; close(): void; isOpen: boolean };
        })
            .vaultDrawerController;
        if (!controller) {
            throw new Error('Vault drawer controller is missing.');
        }
        controller.open();
        const drawer = document.querySelector('.lk-drawer');
        if (!controller.isOpen || !drawer?.classList.contains('is-open')) {
            throw new Error('Vault drawer did not open before the close operation.');
        }
        controller.close();
        if (controller.isOpen || drawer.classList.contains('is-open')) {
            throw new Error('Vault drawer did not close.');
        }
    });
    await expect(page.getByRole('button', { name: 'External opener' })).toBeFocused();
    await expect(page.locator('#app-root')).toHaveJSProperty('inert', true);
});
