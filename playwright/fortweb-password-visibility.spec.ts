import { expect, test, type Locator } from '@playwright/test';

// Show/hide passcode toggles use Material Symbols visibility / visibility_off,
// not the folder_open (browse) icon used for "View" row actions.
async function expectToggle(toggle: Locator, input: Locator): Promise<void> {
    const icon = toggle.locator('img');

    await expect(input).toHaveAttribute('type', 'password');
    await expect(icon).toHaveAttribute('src', /\/visibility\.svg$/);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await toggle.click();
    await expect(input).toHaveAttribute('type', 'text');
    await expect(icon).toHaveAttribute('src', /\/visibility_off\.svg$/);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await toggle.click();
    await expect(input).toHaveAttribute('type', 'password');
    await expect(icon).toHaveAttribute('src', /\/visibility\.svg$/);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
}

test('unlock passcode toggle uses eye icons', async ({ page }) => {
    await page.goto('/fortweb/app/index.html#/_fixtures/unlock');

    await expectToggle(
        page.getByRole('button', { name: 'Toggle password visibility' }),
        page.locator('#unlock-passcode'),
    );
});

test('new vault passcode toggle uses eye icons', async ({ page }) => {
    await page.route('**/pyscript-ci.toml', (route) => route.fulfill({ status: 503, body: 'Runtime unavailable' }));
    await page.goto('/fortweb/app/index.html#/');
    await page.getByRole('button', { name: 'Vaults', exact: true }).click();
    await page.getByRole('button', { name: 'Initialize New Vault' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Vault Initialization' });

    await expectToggle(
        dialog.getByRole('button', { name: 'Toggle password visibility' }),
        dialog.locator('input[name="passcode"]'),
    );
});

test('eye icons are served', async ({ request }) => {
    for (const name of ['visibility', 'visibility_off']) {
        const response = await request.get(`/fortweb/app/assets/icons/${name}.svg`);
        expect(response.status(), name).toBe(200);
        expect(response.headers()['content-type'], name).toContain('svg');
    }
});
