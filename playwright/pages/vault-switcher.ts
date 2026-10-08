import type { Locator, Page } from '@playwright/test';

export class VaultSwitcher {
    readonly trigger: Locator;
    readonly dialog: Locator;

    constructor(private readonly page: Page) {
        this.trigger = page.getByRole('button', { name: 'Vaults', exact: true });
        this.dialog = page.getByRole('dialog', { name: 'Vault switcher' });
    }

    get closeButton(): Locator {
        return this.dialog.getByRole('button', { name: 'Close vault switcher' });
    }

    async openWithKeyboard(): Promise<void> {
        await this.trigger.focus();
        await this.trigger.press('Enter');
        await this.dialog.waitFor({ state: 'visible' });
    }
}
