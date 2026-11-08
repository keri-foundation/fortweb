import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const specDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(specDir, '..');
const fixtureDir = path.join(specDir, 'fixtures');
const htmlPath = path.join(fixtureDir, 'context-selection-demo.html');
const scriptPath = path.join(fixtureDir, 'context-selection-demo.js');
const cssPath = path.join(fixtureDir, 'context-selection-demo.css');
const tokenPath = path.join(repoRoot, 'app/styles/tokens.css');
const baseStylesPath = path.join(repoRoot, 'app/styles/base.css');
const html = await readFile(htmlPath, 'utf8');
const diagnostics = new WeakMap<Page, { errors: string[]; requests: string[] }>();

test.afterEach(async ({ page }) => {
  const result = diagnostics.get(page);
  if (result) {
    expect(result.errors).toEqual([]);
    expect(result.requests).toEqual([]);
  }
});

async function openDemo(page: Page, mode: 'suggested' | 'first-use' = 'suggested') {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  diagnostics.set(page, { errors, requests });
  await page.setContent(html);
  await page.evaluate((initialMode) => { document.documentElement.dataset.mode = initialMode; }, mode);
  await page.addStyleTag({ path: tokenPath });
  await page.addStyleTag({ path: baseStylesPath });
  await page.addStyleTag({ path: cssPath });
  await page.addScriptTag({ path: scriptPath });
  return { errors, requests };
}

async function expectVisibleFrame(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.context-demo__surface')).toBeInViewport();
  const primary = page.locator('.context-demo__button--primary');
  if (await primary.count()) await expect(primary).toBeInViewport();
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    height: document.documentElement.clientHeight,
    surface: document.querySelector('.context-demo__surface')!.getBoundingClientRect().toJSON(),
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.surface.left).toBeGreaterThanOrEqual(0);
  expect(dimensions.surface.right).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.surface.top).toBeGreaterThanOrEqual(0);
  expect(dimensions.surface.bottom).toBeLessThanOrEqual(dimensions.height);
}

test('first use requires a name, trims it, and confirms the created context', async ({ page }) => {
  await openDemo(page, 'first-use');
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'NO_CONTEXTS');
  const save = page.getByRole('button', { name: 'Save context' });
  await expect(save).toBeDisabled();
  await page.getByLabel('Context name').fill('  Work  ');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'CONFIRMING_CONTEXT');
  await expect(page.getByText('Work', { exact: true })).toBeVisible();
});

test('accepts the visible suggestion and confirms it', async ({ page }) => {
  await openDemo(page);
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'SUGGESTED_CONTEXT');
  await expect(page.getByText('Suggested', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use Work' }).click();
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'CONFIRMING_CONTEXT');
  await expect(page.getByText('Work', { exact: true })).toBeVisible();
});

test('switches to Family using native radio selection and Continue', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Choose another' }).click();
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'SELECTING_CONTEXT');
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();
  const family = page.getByRole('radio', { name: 'Family' });
  await family.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Work' })).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(family).toBeChecked();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'CONFIRMING_CONTEXT');
  await expect(page.getByText('Family', { exact: true })).toBeVisible();
});

test('creates a new context from the selector and uses it', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Choose another' }).click();
  await page.getByRole('button', { name: 'Create new context' }).click();
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'CREATING_CONTEXT');
  await page.getByLabel('Context name').fill('Banking');
  await page.getByRole('button', { name: 'Save context' }).click();
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'CONFIRMING_CONTEXT');
  await expect(page.getByText('Banking', { exact: true })).toBeVisible();
});

test('blocks duplicate labels case-insensitively and offers the existing context', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Choose another' }).click();
  await page.getByRole('button', { name: 'Create new context' }).click();
  await page.getByLabel('Context name').fill('work');
  await page.getByRole('button', { name: 'Save context' }).click();
  await expect(page.getByRole('alert')).toHaveText('A context named Work already exists.');
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'CREATING_CONTEXT');
  await page.getByRole('button', { name: 'Use Work' }).click();
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'CONFIRMING_CONTEXT');
  await expect(page.getByText('Work', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change' }).click();
  await expect(page.getByRole('radio', { name: 'Work' })).toHaveCount(1);
});

test('Change returns to selection, and Continue only completes the demo boundary', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Use Work' }).click();
  await page.getByRole('button', { name: 'Change' }).click();
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'SELECTING_CONTEXT');
  await page.getByRole('radio', { name: 'Family' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#context-demo')).toHaveAttribute('data-state', 'DEMO_COMPLETE');
  await expect(page.getByText('This prototype stops before credentials are presented.')).toBeVisible();
  await expect(page.locator('#context-demo')).toContainText('Context confirmed');
  await expect(page.getByRole('heading', { name: 'Context confirmed' })).toBeFocused();
});

test('Why contexts? is keyboard operable and shows only the approved explanation', async ({ page }) => {
  await openDemo(page);
  const disclosure = page.getByText('Why contexts?', { exact: true });
  await page.keyboard.press('Tab');
  await expect(disclosure).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('details.context-demo__why')).toHaveAttribute('open', '');
  await expect(page.getByText('Some presentations can use different identifiers or credentials. Other information may still connect interactions.')).toBeVisible();
  await expect(page.locator('.context-demo__intro')).toContainText('This does not prevent all tracking.');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Choose another' })).toBeFocused();
});

for (const viewport of [
  { width: 1280, height: 720, name: 'desktop' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 390, height: 844, name: 'mobile 390' },
  { width: 360, height: 800, name: 'mobile 360' },
]) {
  test(`responsive ${viewport.name} keeps the suggestion and actions in view`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { errors, requests } = await openDemo(page);
    await expectVisibleFrame(page);
    await expect(page.getByRole('button', { name: 'Choose another' })).toBeInViewport();
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  });
}

test('long context names wrap on narrow screens and remain actionable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openDemo(page);
  await page.getByRole('button', { name: 'Choose another' }).click();
  await page.getByRole('button', { name: 'Create new context' }).click();
  const name = 'Volunteer Community Organization';
  await page.getByLabel('Context name').fill(name);
  await page.getByRole('button', { name: 'Save context' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expectVisibleFrame(page);
});

test('keeps selector actions reachable with ten contexts on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openDemo(page);
  const extraContexts = ['Banking', 'Context 4', 'Context 5', 'Context 6', 'Context 7', 'Context 8', 'Context 9', 'Context 10'];
  for (const [index, name] of extraContexts.entries()) {
    await page.getByRole('button', { name: index === 0 ? 'Choose another' : 'Change' }).click();
    await page.getByRole('button', { name: 'Create new context' }).click();
    await page.getByLabel('Context name').fill(name);
    await page.getByRole('button', { name: 'Save context' }).click();
  }
  await page.getByRole('button', { name: 'Change' }).click();
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.context-demo__surface')).toBeInViewport();
    await expect(page.locator('.context-demo__selector-footer')).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Create new context' })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeInViewport();
    const listAndFooter = await page.locator('.context-demo__surface').evaluate((surface) => {
      surface.scrollTop = surface.scrollHeight;
      const choices = surface.querySelectorAll('.context-demo__choice');
      const finalContext = choices.item(choices.length - 1)!;
      const footer = surface.querySelector('.context-demo__selector-footer')!;
      return {
        finalContextBottom: finalContext.getBoundingClientRect().bottom,
        footerTop: footer.getBoundingClientRect().top,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(listAndFooter.finalContextBottom).toBeLessThanOrEqual(listAndFooter.footerTop);
    expect(listAndFooter.scrollWidth).toBeLessThanOrEqual(listAndFooter.clientWidth);
  }
});
