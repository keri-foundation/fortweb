import { expect, test } from '@playwright/test';

function parseViewportDirectives(content: string | null): Map<string, string> {
    if (!content) {
        return new Map();
    }

    return new Map(
        content.split(',').map((directive) => {
            const [rawName, ...rawValue] = directive.split('=');
            return [rawName.trim().toLowerCase(), rawValue.join('=').trim().toLowerCase()];
        }),
    );
}

test('viewport metadata preserves mobile layout and allows user enlargement', async ({ page }) => {
    await page.goto('/fortweb/app/index.html');

    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveCount(1);

    const directives = parseViewportDirectives(await viewport.getAttribute('content'));
    expect(directives.get('width')).toBe('device-width');
    expect(directives.get('initial-scale')).toBe('1');
    expect(directives.get('viewport-fit')).toBe('cover');
    expect(directives.get('user-scalable')).not.toBe('no');

    const maximumScale = directives.get('maximum-scale');
    expect(maximumScale === undefined || Number(maximumScale) >= 2).toBe(true);
});
