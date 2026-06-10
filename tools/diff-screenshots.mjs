#!/usr/bin/env node
/**
 * Compare current screenshots against baselines using pixelmatch.
 *
 * Usage:
 *   node diff-screenshots.mjs                    # default 0.5% threshold
 *   node diff-screenshots.mjs --threshold 1.0    # custom percentage threshold
 *
 * Output:
 *   For each pair the script reports mismatch percentage.
 *   Diff images are written to screenshots/diffs/.
 *   Exits with code 1 if any pair exceeds the threshold.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASELINES_DIR = resolve(__dirname, "screenshots", "baselines");
const CURRENT_DIR = resolve(__dirname, "screenshots", "current");
const DIFFS_DIR = resolve(__dirname, "screenshots", "diffs");

function parseArgs() {
    const args = process.argv.slice(2);
    let threshold = 0.5;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--threshold" && args[i + 1]) {
            threshold = parseFloat(args[i + 1]);
            i++;
        }
    }

    return { threshold };
}

function loadPng(filepath) {
    const buffer = readFileSync(filepath);
    return PNG.sync.read(buffer);
}

function run() {
    const { threshold } = parseArgs();

    if (!existsSync(BASELINES_DIR)) {
        process.stderr.write(
            "No baselines found. Run 'npm run update-baselines' first.\n",
        );
        process.exit(1);
    }

    if (!existsSync(CURRENT_DIR)) {
        process.stderr.write(
            "No current screenshots found. Run 'npm run capture' first.\n",
        );
        process.exit(1);
    }

    mkdirSync(DIFFS_DIR, { recursive: true });

    const baselineFiles = readdirSync(BASELINES_DIR).filter((f) =>
        f.endsWith(".png"),
    );

    if (baselineFiles.length === 0) {
        process.stderr.write("No baseline PNGs found.\n");
        process.exit(1);
    }

    let failures = 0;
    let compared = 0;

    for (const filename of baselineFiles) {
        const baselinePath = resolve(BASELINES_DIR, filename);
        const currentPath = resolve(CURRENT_DIR, filename);
        const diffPath = resolve(DIFFS_DIR, filename);

        if (!existsSync(currentPath)) {
            process.stdout.write(`  SKIP ${filename} (no current screenshot)\n`);
            continue;
        }

        const baseline = loadPng(baselinePath);
        const current = loadPng(currentPath);

        if (
            baseline.width !== current.width ||
            baseline.height !== current.height
        ) {
            process.stdout.write(
                `  FAIL ${filename} — size mismatch: ` +
                    `${baseline.width}x${baseline.height} vs ${current.width}x${current.height}\n`,
            );
            failures++;
            continue;
        }

        const { width, height } = baseline;
        const diff = new PNG({ width, height });
        const totalPixels = width * height;

        const mismatchedPixels = pixelmatch(
            baseline.data,
            current.data,
            diff.data,
            width,
            height,
            { threshold: 0.1 },
        );

        const mismatchPct = (mismatchedPixels / totalPixels) * 100;
        const passed = mismatchPct <= threshold;
        const label = passed ? "PASS" : "FAIL";

        process.stdout.write(
            `  ${label} ${filename} — ${mismatchPct.toFixed(3)}% (${mismatchedPixels}/${totalPixels} px)\n`,
        );

        if (!passed) {
            writeFileSync(diffPath, PNG.sync.write(diff));
            failures++;
        }

        compared++;
    }

    process.stdout.write(
        `\nCompared ${compared} pairs. Threshold: ${threshold}%. Failures: ${failures}\n`,
    );

    if (failures > 0) {
        process.exit(1);
    }
}

run();
