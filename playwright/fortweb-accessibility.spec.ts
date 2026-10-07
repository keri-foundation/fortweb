import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    // These fixtures exercise shared UI, without starting the wallet worker.
    await page.route('**/app/runtime/bridge.js', async (route) => {
        await route.fulfill({
            contentType: 'text/javascript',
            body: `export function createRuntimeBridge() {
                return {
                    async request(method) {
                        if (method === 'vaults.list') return { vaults: [] };
                        throw new Error('Unexpected runtime request: ' + method);
                    },
                    destroy() {},
                };
            }`,
        });
    });
});

async function openIdentifier(page: Page): Promise<void> {
    await page.goto('/fortweb/app/index.html#/_fixtures/identifiers/empty');
    const opener = page.getByRole('button', { name: 'Add Identifier', exact: true });
    await expect(opener).toBeVisible();
    // Reach the opener through the ordinary keyboard order.
    for (let index = 0; index < 20; index++) {
        await page.keyboard.press('Tab');
        if (await opener.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(opener).toBeFocused();
    await page.keyboard.press('Space');
    const dialog = page.getByRole('dialog', { name: 'Create Identifier', exact: true });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
}

for (const width of [1440, 768, 411, 360]) {
    test(`Create Identifier contains keyboard focus and restores it (${width}px)`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await openIdentifier(page);
        const dialog = page.getByRole('dialog', { name: 'Create Identifier', exact: true });
        const close = dialog.getByRole('button', { name: 'Close', exact: true });
        const create = dialog.getByRole('button', { name: 'Create', exact: true });

        await page.keyboard.press('Shift+Tab');
        await expect(create).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        for (const control of [dialog.getByRole('textbox', { name: 'Alias' }),
            dialog.getByRole('button', { name: 'Cancel', exact: true }), create, close]) {
            await page.keyboard.press('Tab');
            await expect(control).toBeFocused();
        }
        for (let index = 0; index < 12; index++) {
            await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab');
            await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
                .toBe(true);
        }
        // Inert prevents even programmatic focus from reaching the background.
        await page.getByRole('button', { name: 'Add Identifier', includeHidden: true }).evaluate((element) => {
            (element as HTMLElement).focus();
        });
        await expect(close).toBeFocused();
        await expect.poll(() => page.getByRole('link', { name: 'Settings', includeHidden: true })
            .evaluateAll((elements) => elements.length > 0
                && elements.every((element) => element.closest('[inert]') !== null))).toBe(true);

        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        const opener = page.getByRole('button', { name: 'Add Identifier', exact: true });
        await expect(opener).toBeFocused();
        await page.keyboard.press('Space');
        await expect(close).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
    });
}

test('Create Identifier preserves validation, Cancel and safe fixture submission', async ({ page }) => {
    await openIdentifier(page);
    const dialog = page.getByRole('dialog', { name: 'Create Identifier', exact: true });
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog.getByText('Alias is required.', { exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Alias' }).fill('fixture-only');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const opener = page.getByRole('button', { name: 'Add Identifier', exact: true });
    await expect(opener).toBeFocused();
    await page.keyboard.press('Space');
    await dialog.getByRole('textbox', { name: 'Alias' }).fill('fixture-only');
    await dialog.getByRole('textbox', { name: 'Alias' }).press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.getByRole('status')).toContainText('Identifier "fixture-only" created.');
});

test('Add Remote uses the same containment with a different form', async ({ page }) => {
    await page.setViewportSize({ width: 411, height: 845 });
    await page.goto('/fortweb/app/index.html#/_fixtures/remotes/empty');
    const opener = page.getByRole('button', { name: 'Add Remote Identifier', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add Remote Identifier', exact: true });
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Resolve OOBI', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('textbox', { name: 'OOBI URL' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('textbox', { name: 'Alias' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
});

test('background isolation preserves inert attributes and the shared announcer', async ({ page }) => {
    await page.goto('/fortweb/app/index.html#/_fixtures/identifiers/empty');
    await page.evaluate(() => {
        const background = document.createElement('button');
        background.textContent = 'Already inert';
        background.id = 'previously-inert';
        background.setAttribute('inert', 'preserved');
        document.body.append(background);
    });
    await page.evaluate(async () => {
        const url = '/fortweb/app/ui/core/a11y.js';
        const { announce } = await import(url);
        announce('Before dialog');
    });
    await page.getByRole('button', { name: 'Add Identifier', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Identifier', exact: true });
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await expect(page.locator('#fw-live-region')).not.toHaveAttribute('inert');
    await page.evaluate(async () => {
        const button = document.createElement('button');
        button.textContent = 'Late background action';
        button.id = 'late-background';
        document.body.append(button);
        const { announce } = await import('/fortweb/app/ui/core/a11y.js');
        announce('Modal feedback');
    });
    await expect(page.locator('#late-background')).toHaveAttribute('inert', '');
    await expect(page.getByRole('status')).toHaveText('Modal feedback');
    // Overlay dismissal stays intentional and does not activate the covered link.
    const originalURL = page.url();
    await page.mouse.click(5, 5);
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(originalURL);
    await expect(page.getByRole('button', { name: 'Add Identifier', exact: true })).toBeFocused();
    await expect(page.locator('#previously-inert')).toHaveAttribute('inert', 'preserved');
    await expect(page.locator('#late-background')).not.toHaveAttribute('inert');
});

test('generic modal handles dynamic controls, fallback, destroy and reopen', async ({ page }) => {
    await page.goto('/fortweb/app/index.html#/_fixtures/identifiers/empty');
    const opener = page.getByRole('button', { name: 'Add Identifier', exact: true });
    await opener.focus();
    await page.evaluate(async () => {
        const { createModal } = await import('/fortweb/app/ui/composites/modal.js');
        globalThis['modalUnderTest'] = createModal({
            title: 'Generic modal',
            body: `<a href="#">Link</a><input aria-label="Input"><select aria-label="Choice"><option>One</option></select>
                <textarea aria-label="Notes"></textarea><div tabindex="0">Explicit target</div>
                <button disabled>Disabled</button><button hidden>Hidden</button>
                <button style="display:none">Not rendered</button><button tabindex="-1">Not tabbable</button>`,
        });
        globalThis['modalUnderTest'].open();
    });
    const dialog = page.getByRole('dialog', { name: 'Generic modal', exact: true });
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByText('Explicit target', { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    for (const control of [dialog.getByRole('link', { name: 'Link' }),
        dialog.getByRole('textbox', { name: 'Input', exact: true }),
        dialog.getByRole('combobox', { name: 'Choice' }),
        dialog.getByRole('textbox', { name: 'Notes' }), dialog.getByText('Explicit target', { exact: true }), close]) {
        await page.keyboard.press('Tab');
        await expect(control).toBeFocused();
    }
    await dialog.evaluate((element) => {
        const final = document.createElement('button');
        final.textContent = 'Dynamic final';
        element.append(final);
    });
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Dynamic final' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Dynamic final' }).evaluate((element) => {
        (element as HTMLButtonElement).disabled = true;
    });
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await dialog.evaluate((element) => element.replaceChildren(document.createTextNode('No controls')));
    await page.keyboard.press('Tab');
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog).toBeFocused();
    await page.evaluate(() => globalThis['modalUnderTest'].destroy());
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await page.evaluate(() => globalThis['modalUnderTest'].open());
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    // Removed listeners must not intercept normal background keyboard activation.
    await page.keyboard.press('Space');
    await expect(page.getByRole('dialog', { name: 'Create Identifier', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
});
