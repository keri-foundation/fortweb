/**
 * Runtime resource closure validator.
 * Parses HTML/CSS in dist/runtime/ and verifies every local resource reference
 * resolves to an existing file. Ignores external URLs and data: URIs.
 */
import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(__dirname, '..', 'dist/runtime');

function findFiles(dir, pattern) {
    const results = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findFiles(full, pattern));
        } else if (pattern.test(entry.name)) {
            results.push(full);
        }
    }
    return results;
}

function extractHtmlReferences(htmlPath) {
    const content = readFileSync(htmlPath, 'utf-8');
    const refs = [];

    for (const m of content.matchAll(/<script[^>]+src\s*=\s*"([^"]+)"/g)) {
        refs.push({ path: m[1], category: 'script' });
    }
    for (const m of content.matchAll(/<link[^>]+href\s*=\s*"([^"]+)"/g)) {
        refs.push({ path: m[1], category: 'stylesheet' });
    }
    for (const m of content.matchAll(/<img[^>]+src\s*=\s*"([^"]+)"/g)) {
        refs.push({ path: m[1], category: 'image' });
    }
    for (const m of content.matchAll(/<source[^>]+srcset\s*=\s*"([^"]+)"/g)) {
        for (const part of m[1].split(',')) {
            const trimmed = part.trim().split(/\s+/)[0];
            if (trimmed) refs.push({ path: trimmed, category: 'image' });
        }
    }

    return refs;
}

function extractCssReferences(cssPath) {
    const content = readFileSync(cssPath, 'utf-8');
    const refs = [];

    for (const m of content.matchAll(/url\(\s*"([^"]+)"\s*\)/g)) {
        refs.push({ path: m[1], category: 'css-resource' });
    }
    for (const m of content.matchAll(/url\(\s*([^")\s]+)\s*\)/g)) {
        refs.push({ path: m[1], category: 'css-resource' });
    }

    return refs;
}

function resolveReference(ref, baseFile) {
    if (/^https?:\/\//i.test(ref)) return null;
    if (/^data:/i.test(ref)) return null;
    if (ref.startsWith('#')) return null;
    if (/^javascript:/i.test(ref)) return null;
    if (/^[a-z]+:/i.test(ref) && !ref.startsWith('/') && !ref.startsWith('./') && !ref.startsWith('../')) return null;

    const cleanRef = ref.split('?')[0].split('#')[0];

    // Resolve against runtime root: paths starting with / are app-root-relative
    let resolved;
    if (cleanRef.startsWith('/')) {
        resolved = join(RUNTIME_DIR, cleanRef.replace(/^\//, ''));
    } else {
        resolved = resolve(dirname(baseFile), cleanRef);
    }

    // Reject path traversal outside runtime root
    const relToRoot = relative(RUNTIME_DIR, resolved);
    if (relToRoot.startsWith('..')) return null;

    return resolved;
}

function collectMissingResources() {
    const missing = [];
    const htmlFiles = findFiles(RUNTIME_DIR, /\.html$/);
    const cssFiles = findFiles(RUNTIME_DIR, /\.css$/);

    for (const htmlFile of htmlFiles) {
        const relFile = relative(RUNTIME_DIR, htmlFile);
        const refs = extractHtmlReferences(htmlFile);
        for (const ref of refs) {
            const r = resolveReference(ref.path, htmlFile);
            if (r === null) continue;
            if (!existsSync(r)) {
                missing.push({
                    referringFile: relFile,
                    reference: ref.path,
                    resolvedPath: relative(RUNTIME_DIR, r),
                    category: ref.category,
                });
            }
        }
    }

    for (const cssFile of cssFiles) {
        const relFile = relative(RUNTIME_DIR, cssFile);
        const refs = extractCssReferences(cssFile);
        for (const ref of refs) {
            const r = resolveReference(ref.path, cssFile);
            if (r === null) continue;
            if (!existsSync(r)) {
                missing.push({
                    referringFile: relFile,
                    reference: ref.path,
                    resolvedPath: relative(RUNTIME_DIR, r),
                    category: ref.category,
                });
            }
        }
    }

    return missing;
}

describe('runtime resource closure', () => {
    test('runtime directory exists and is non-empty', () => {
        assert.ok(existsSync(RUNTIME_DIR), 'dist/runtime must exist');
        const entries = readdirSync(RUNTIME_DIR);
        assert.ok(entries.length > 0, 'dist/runtime must not be empty');
    });

    test('no missing locally referenced resources', () => {
        const missing = collectMissingResources();
        if (missing.length > 0) {
            const report = missing.map((m) =>
                `  ${m.referringFile} \u2192 ${m.reference} (${m.category}) \u2192 ${m.resolvedPath} MISSING`
            ).join('\n');
            assert.fail(`${missing.length} missing resource(s):\n${report}`);
        }
    });
});

describe('resource closure edge cases', () => {
    test('external URLs are ignored', () => {
        assert.strictEqual(
            resolveReference('https://cdn.example.com/lib.js', join(RUNTIME_DIR, 'x.html')),
            null,
        );
    });

    test('data URIs are ignored', () => {
        assert.strictEqual(
            resolveReference('data:image/svg+xml,abc', join(RUNTIME_DIR, 'x.html')),
            null,
        );
    });

    test('strips query strings', () => {
        const r = resolveReference('/app/app/main.js?v=2', join(RUNTIME_DIR, 'x.html'));
        assert.ok(r !== null && !r.includes('?'));
    });

    test('strips fragments', () => {
        const r = resolveReference('/app/app/main.js#anchor', join(RUNTIME_DIR, 'x.html'));
        assert.ok(r !== null && !r.includes('#'));
    });

    test('rejects path traversal', () => {
        assert.strictEqual(
            resolveReference('../../../etc/passwd', join(RUNTIME_DIR, 'x.html')),
            null,
        );
    });
});
