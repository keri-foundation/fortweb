#!/usr/bin/env node
/**
 * Capture screenshots for every registered fixture route.
 *
 * Usage:
 *   node capture-screenshots.mjs                  # save to screenshots/current/
 *   node capture-screenshots.mjs --update-baselines  # save to screenshots/baselines/
 *   node capture-screenshots.mjs --base-url http://localhost:8080  # custom server
 *
 * Prerequisites:
 *   - npm install (in this tools/ directory)
 *   - npx playwright install chromium
 *   - A running local server serving libs/fortweb/ (e.g. python3 -m http.server)
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURE_KEYS = [
    "vaults/empty",
    "vaults/populated",
    "unlock",
    "identifiers/empty",
    "identifiers/populated",
    "identifier-detail",
    "remotes/empty",
    "remotes/populated",
    "remote-detail",
    "witnesses/disconnected",
    "witnesses/connected",
    "witnesses/account",
    "witnesses/error",
    "watchers/placeholder",
    "watchers/populated",
    "settings",
];

const VIEWPORTS = [
    { name: "iphone-14", width: 390, height: 844 },
    { name: "pixel-7", width: 412, height: 915 },
];

function parseArgs() {
    const args = process.argv.slice(2);
    let updateBaselines = false;
    let baseUrl = "http://localhost:8000";

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--update-baselines") {
            updateBaselines = true;
        } else if (args[i] === "--base-url" && args[i + 1]) {
            baseUrl = args[i + 1];
            i++;
        }
    }

    return { updateBaselines, baseUrl };
}

async function captureAll() {
    const { updateBaselines, baseUrl } = parseArgs();
    const outDir = resolve(
        __dirname,
        "screenshots",
        updateBaselines ? "baselines" : "current",
    );

    mkdirSync(outDir, { recursive: true });

    const browser = await chromium.launch();
    let captured = 0;

    try {
        for (const viewport of VIEWPORTS) {
            const context = await browser.newContext({
                viewport: { width: viewport.width, height: viewport.height },
                deviceScaleFactor: 2,
            });
            const page = await context.newPage();

            for (const key of FIXTURE_KEYS) {
                const url = `${baseUrl}/app/index.html#/_fixtures/${key}`;
                const safeName = key.replace(/\//g, "--");
                const filename = `${viewport.name}--${safeName}.png`;
                const filepath = resolve(outDir, filename);

                await page.goto(url, { waitUntil: "networkidle" });
                await page.waitForTimeout(500);
                await page.screenshot({ path: filepath, fullPage: false });

                captured++;
                process.stdout.write(`  [${captured}] ${filename}\n`);
            }

            await context.close();
        }
    } finally {
        await browser.close();
    }

    const dest = updateBaselines ? "baselines" : "current";
    process.stdout.write(
        `\nDone. ${captured} screenshots saved to screenshots/${dest}/\n`,
    );
}

captureAll().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
});
