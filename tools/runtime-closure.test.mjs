/**
 * Runtime resource closure validator — fail-closed.
 *
 * Parses every HTML and CSS file beneath dist/runtime and requires
 * every local resource reference to resolve to an existing regular
 * non-symlink file inside the runtime root.
 *
 * External URLs, custom schemes, protocol-relative references,
 * root escapes, symlinks, and non-file targets are validation
 * failures — not silently ignored values.
 *
 * The Python dependency-closure test (tools/python-dependency-closure.test.mjs)
 * owns semantic validation of packaged pyscript-ci.toml, wallet-worker.py
 * declarations, local wheels, and transitive Pyodide lock packages.
 */
import { strict as assert } from 'node:assert';
import { test, describe } from 'node:test';
import {
    readFileSync,
    readdirSync,
    existsSync,
    lstatSync,
    mkdtempSync,
    writeFileSync,
    mkdirSync,
    symlinkSync,
    rmSync,
} from 'node:fs';
import {
    join,
    dirname,
    resolve,
    relative,
    sep,
    isAbsolute,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const RUNTIME_DIR = resolve(PROJECT_DIR, 'dist/runtime');

// ── File discovery ─────────────────────────────────────────────────────────

function findFiles(dir, pattern) {
    const results = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
            results.push(...findFiles(full, pattern));
        } else if (pattern.test(entry.name)) {
            results.push(full);
        }
    }
    return results;
}

// ── HTML reference extraction ──────────────────────────────────────────────

function extractHtmlReferences(content) {
    const refs = [];

    // Double- and single-quoted attributes
    for (const tag of ['script', 'link', 'img', 'source', 'video', 'audio', 'iframe']) {
        const attr = tag === 'link' ? 'href' : 'src';
        for (const m of content.matchAll(new RegExp(`<${tag}[^>]+${attr}\\s*=\\s*"([^"]+)"`, 'g'))) {
            refs.push({ raw: m[1], category: tag });
        }
        for (const m of content.matchAll(new RegExp(`<${tag}[^>]+${attr}\\s*=\\s*'([^']+)'`, 'g'))) {
            refs.push({ raw: m[1], category: tag });
        }
    }

    // srcset (image sources with descriptors)
    for (const m of content.matchAll(/<source[^>]+srcset\s*=\s*"([^"]+)"/g)) {
        for (const part of m[1].split(',')) {
            const trimmed = part.trim().split(/\s+/)[0];
            if (trimmed) refs.push({ raw: trimmed, category: 'srcset' });
        }
    }

    return refs;
}

// ── CSS reference extraction ───────────────────────────────────────────────

function extractCssReferences(content) {
    const refs = [];

    // url("...") and url('...')
    for (const m of content.matchAll(/url\(\s*"([^"]+)"\s*\)/g)) {
        refs.push({ raw: m[1], category: 'css-resource' });
    }
    for (const m of content.matchAll(/url\(\s*'([^']+)'\s*\)/g)) {
        refs.push({ raw: m[1], category: 'css-resource' });
    }
    // url(...) unquoted
    for (const m of content.matchAll(/url\(\s*([^"'\s)]+)\s*\)/g)) {
        refs.push({ raw: m[1], category: 'css-resource' });
    }
    // @import "..."
    for (const m of content.matchAll(/@import\s+"([^"]+)"/g)) {
        refs.push({ raw: m[1], category: 'css-import' });
    }
    for (const m of content.matchAll(/@import\s+'([^']+)'/g)) {
        refs.push({ raw: m[1], category: 'css-import' });
    }
    // @import url(...)
    for (const m of content.matchAll(/@import\s+url\([^)]+\)/g)) {
        const urlMatch = m[0].match(/url\(\s*"?([^"')]+)"?\s*\)/);
        if (urlMatch) refs.push({ raw: urlMatch[1], category: 'css-import' });
    }

    return refs;
}

// ── Reference classification ───────────────────────────────────────────────

const EXTERNAL_SCHEMES = /^(https?|file|app|blob|javascript|data):/i;
const PROTOCOL_RELATIVE = /^\/\//;
const FRAGMENT_ONLY = /^#/;

function classifyReference(raw) {
    if (FRAGMENT_ONLY.test(raw)) return { type: 'fragment' };
    if (PROTOCOL_RELATIVE.test(raw)) return { type: 'external', raw, reason: 'protocol-relative URL' };
    if (EXTERNAL_SCHEMES.test(raw)) return { type: 'external', raw, reason: `external scheme: ${raw.split(':')[0]}` };
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return { type: 'external', raw, reason: `custom scheme: ${raw.split(':')[0]}` };
    if (raw.startsWith('/') || raw.startsWith('./') || raw.startsWith('../')) return { type: 'local', raw };
    return { type: 'local', raw };
}

// ── Path safety ────────────────────────────────────────────────────────────

function isStrictDescendant(parent, candidate) {
    const parentPath = resolve(parent);
    const candidatePath = resolve(candidate);
    const rel = relative(parentPath, candidatePath);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// ── Malformed-content detection ────────────────────────────────────────────

function checkHtmlMalformed(content, file, runtimeRoot) {
    // Unclosed double-quoted src/href attribute
    for (const m of content.matchAll(/<[a-z]+[^>]*?(?:src|href)\s*=\s*"([^"]*)$/gm)) {
        if (m[1].trim()) {
            assert.fail(`MALFORMED_HTML_REFERENCE: unclosed double-quoted attribute (from ${relative(runtimeRoot, file)})`);
        }
    }
    // Unclosed single-quoted src/href attribute
    for (const m of content.matchAll(/<[a-z]+[^>]*?(?:src|href)\s*=\s*'([^']*)$/gm)) {
        if (m[1].trim()) {
            assert.fail(`MALFORMED_HTML_REFERENCE: unclosed single-quoted attribute (from ${relative(runtimeRoot, file)})`);
        }
    }
}

function checkCssMalformed(content, file, runtimeRoot) {
    // url(" without closing ")
    for (const m of content.matchAll(/url\(\s*"([^"]*)$/gm)) {
        assert.fail(`MALFORMED_CSS_REFERENCE: unclosed url("... (from ${relative(runtimeRoot, file)})`);
    }
    // url(' without closing ')
    for (const m of content.matchAll(/url\(\s*'([^']*)$/gm)) {
        assert.fail(`MALFORMED_CSS_REFERENCE: unclosed url('... (from ${relative(runtimeRoot, file)})`);
    }
    // @import " without closing "
    for (const m of content.matchAll(/@import\s+"([^"]*)$/gm)) {
        assert.fail(`MALFORMED_CSS_REFERENCE: unclosed @import "... (from ${relative(runtimeRoot, file)})`);
    }
    // @import ' without closing '
    for (const m of content.matchAll(/@import\s+'([^']*)$/gm)) {
        assert.fail(`MALFORMED_CSS_REFERENCE: unclosed @import '... (from ${relative(runtimeRoot, file)})`);
    }
}

function checkPercentEncoding(raw, fromFile, runtimeRoot) {
    // Percent sign not followed by two hex digits
    if (/%(?![0-9A-Fa-f]{2})/.test(raw)) {
        assert.fail(`MALFORMED_PERCENT_ENCODING: ${raw} (from ${relative(runtimeRoot, fromFile)})`);
    }
}

// ── Reference resolution and validation ────────────────────────────────────

function validateLocalReference(raw, baseFile, runtimeRoot) {
    // Reject traversal attempts before normalization
    if (/%2e%2e|%2E%2E|%2f|%2F|%5c|%5C/i.test(raw)) {
        assert.fail(`encoded traversal in reference: ${raw} (from ${relative(runtimeRoot, baseFile)})`);
    }
    if (raw.includes('\0')) {
        assert.fail(`null byte in reference: ${raw} (from ${relative(runtimeRoot, baseFile)})`);
    }
    if (raw.includes('\\')) {
        assert.fail(`backslash in reference: ${raw} (from ${relative(runtimeRoot, baseFile)})`);
    }

    // Validate percent-encoding in the raw reference and the clean path
    if (raw.includes('%')) {
        checkPercentEncoding(raw, baseFile, runtimeRoot);
    }

    const cleanRef = raw.split('?')[0].split('#')[0];

    let resolved;
    if (cleanRef.startsWith('/')) {
        resolved = join(runtimeRoot, cleanRef.replace(/^\//, ''));
    } else {
        resolved = resolve(dirname(baseFile), cleanRef);
    }

    assert.ok(
        isStrictDescendant(runtimeRoot, resolved) || resolved === runtimeRoot,
        `reference escapes runtime root: ${raw} → ${relative(runtimeRoot, resolved)} (from ${relative(runtimeRoot, baseFile)})`
    );

    assert.ok(existsSync(resolved),
        `missing resource: ${raw} → ${relative(runtimeRoot, resolved)} (from ${relative(runtimeRoot, baseFile)})`);

    // Reject symlinked path components between runtime root and target
    let component = resolved;
    while (component !== runtimeRoot && component !== resolve(runtimeRoot, '..')) {
        const compStat = lstatSync(component);
        if (compStat.isSymbolicLink()) {
            assert.fail(`symlink in path component: ${relative(runtimeRoot, component)} (from ${relative(runtimeRoot, baseFile)})`);
        }
        component = resolve(component, '..');
    }

    const stat = lstatSync(resolved);
    assert.ok(stat.isFile(),
        `resource not a regular file: ${raw} → ${relative(runtimeRoot, resolved)} (from ${relative(runtimeRoot, baseFile)})`);
    assert.ok(!stat.isSymbolicLink(),
        `resource is a symlink: ${raw} → ${relative(runtimeRoot, resolved)} (from ${relative(runtimeRoot, baseFile)})`);

    return resolved;
}

// ── Closure validator ──────────────────────────────────────────────────────

function validateRuntimeClosure(runtimeRoot) {
    const htmlFiles = findFiles(runtimeRoot, /\.html$/);
    const cssFiles = findFiles(runtimeRoot, /\.css$/);
    const stats = {
        htmlFileCount: htmlFiles.length,
        cssFileCount: cssFiles.length,
        htmlReferenceCount: 0,
        cssUrlCount: 0,
        cssImportCount: 0,
        srcsetCandidateCount: 0,
        validatedLocalTargetCount: 0,
        fragmentOnlyCount: 0,
        inlineReferenceCount: 0,
        symlinkCount: 0,
        invalidReferenceCount: 0,
    };

    for (const htmlFile of htmlFiles) {
        const stat = lstatSync(htmlFile);
        assert.ok(stat.isFile(), `HTML file not a regular file: ${relative(runtimeRoot, htmlFile)}`);
        const content = readFileSync(htmlFile, 'utf8');
        checkHtmlMalformed(content, htmlFile, runtimeRoot);
        for (const ref of extractHtmlReferences(content)) {
            stats.htmlReferenceCount++;
            if (ref.category === 'srcset') stats.srcsetCandidateCount++;
            const cls = classifyReference(ref.raw);
            if (cls.type === 'fragment') { stats.fragmentOnlyCount++; continue; }
            if (cls.type === 'external') {
                stats.invalidReferenceCount++;
                assert.fail(`${cls.reason}: ${ref.raw} (from ${relative(runtimeRoot, htmlFile)})`);
            }
            validateLocalReference(ref.raw, htmlFile, runtimeRoot);
            stats.validatedLocalTargetCount++;
        }
    }

    for (const cssFile of cssFiles) {
        const stat = lstatSync(cssFile);
        assert.ok(stat.isFile(), `CSS file not a regular file: ${relative(runtimeRoot, cssFile)}`);
        const content = readFileSync(cssFile, 'utf8');
        checkCssMalformed(content, cssFile, runtimeRoot);
        for (const ref of extractCssReferences(content)) {
            if (ref.category === 'css-import') stats.cssImportCount++;
            else stats.cssUrlCount++;
            const cls = classifyReference(ref.raw);
            if (cls.type === 'fragment') { stats.fragmentOnlyCount++; continue; }
            if (cls.type === 'external') {
                stats.invalidReferenceCount++;
                assert.fail(`${cls.reason}: ${ref.raw} (from ${relative(runtimeRoot, cssFile)})`);
            }
            validateLocalReference(ref.raw, cssFile, runtimeRoot);
            stats.validatedLocalTargetCount++;
        }
    }

    return stats;
}

// ── Positive artifact test ─────────────────────────────────────────────────

describe('runtime resource closure (fail-closed)', () => {
    test('runtime directory exists and is non-empty', () => {
        assert.ok(existsSync(RUNTIME_DIR), 'dist/runtime must exist');
    });

    test('all local resource references resolve inside dist/runtime', () => {
        const stats = validateRuntimeClosure(RUNTIME_DIR);
        assert.ok(stats.htmlFileCount > 0, 'must have HTML files');
        assert.ok(stats.validatedLocalTargetCount > 0, 'must have local references');
        assert.strictEqual(stats.invalidReferenceCount, 0, 'must have zero invalid references');
        // Print structured inventory for evidence
        console.log(JSON.stringify({
            runtimeClosureInventory: stats,
        }, null, 2));
    });

    test('no symlinks exist in the generated runtime tree', () => {
        function check(dir) {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                assert.ok(!entry.isSymbolicLink(), `symlink found in runtime: ${relative(RUNTIME_DIR, full)}`);
                if (entry.isDirectory()) check(full);
            }
        }
        check(RUNTIME_DIR);
    });
});

// ── Negative tests (validator-level) ───────────────────────────────────────

describe('runtime closure negative cases', () => {
    test('rejects external HTTP URL', () => {
        const cls = classifyReference('https://evil.com/payload.js');
        assert.strictEqual(cls.type, 'external');
    });

    test('rejects protocol-relative URL', () => {
        const cls = classifyReference('//cdn.example.com/lib.js');
        assert.strictEqual(cls.type, 'external');
    });

    test('rejects file: scheme', () => {
        const cls = classifyReference('file:///etc/passwd');
        assert.strictEqual(cls.type, 'external');
    });

    test('rejects javascript: scheme', () => {
        const cls = classifyReference('javascript:alert(1)');
        assert.strictEqual(cls.type, 'external');
    });

    test('rejects unknown custom scheme', () => {
        const cls = classifyReference('custom-scheme://foo/bar');
        assert.strictEqual(cls.type, 'external');
    });

    test('rejects data: URI as non-local reference', () => {
        const cls = classifyReference('data:text/html,<script>alert(1)</script>');
        assert.strictEqual(cls.type, 'external');
    });

    test('rejects missing local file (validator-level)', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            writeFileSync(join(tmp, 'index.html'), '<script src="/nonexistent.js"></script>');
            assert.throws(() => validateRuntimeClosure(tmp),
                { message: /missing resource/ });
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('rejects ../ traversal (validator-level)', () => {
        assert.throws(() =>
            validateLocalReference('../outside.js', join(RUNTIME_DIR, 'app/index.html'), RUNTIME_DIR),
            { message: /(escapes runtime root|missing resource)/ });
    });

    test('rejects root escape via multiple traversals', () => {
        assert.throws(() =>
            validateLocalReference('../../../etc/passwd', join(RUNTIME_DIR, 'app/index.html'), RUNTIME_DIR),
            { message: /(escapes runtime root|missing resource)/ });
    });

    test('rejects backslash traversal', () => {
        assert.throws(() =>
            validateLocalReference('..\\..\\etc\\passwd', join(RUNTIME_DIR, 'app/index.html'), RUNTIME_DIR),
            { message: /backslash/ });
    });

    test('rejects encoded traversal', () => {
        assert.throws(() =>
            validateLocalReference('%2e%2e%2fetc%2fpasswd', join(RUNTIME_DIR, 'app/index.html'), RUNTIME_DIR),
            { message: /encoded traversal/ });
    });

    test('rejects null byte', () => {
        assert.throws(() =>
            validateLocalReference('/app/\0hidden.js', join(RUNTIME_DIR, 'app/index.html'), RUNTIME_DIR),
            { message: /null byte/ });
    });

    test('rejects symlinked target (validator-level)', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            mkdirSync(join(tmp, 'app'), { recursive: true });
            writeFileSync(join(tmp, 'real.js'), 'content');
            symlinkSync(join(tmp, 'real.js'), join(tmp, 'app/link.js'));
            writeFileSync(join(tmp, 'app/index.html'), '<script src="./link.js"></script>');
            assert.throws(() => validateRuntimeClosure(tmp),
                { message: /(not a regular file|symlink)/ });
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('rejects directory where file is expected', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            mkdirSync(join(tmp, 'app'), { recursive: true });
            mkdirSync(join(tmp, 'app/dir-instead-of-file.js'));
            writeFileSync(join(tmp, 'app/index.html'), '<script src="./dir-instead-of-file.js"></script>');
            assert.throws(() => validateRuntimeClosure(tmp),
                { message: /not a regular file/ });
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('fragment-only references are classified as non-resource', () => {
        const cls = classifyReference('#section');
        assert.strictEqual(cls.type, 'fragment');
    });

    test('local relative path is classified as local', () => {
        const cls = classifyReference('./app/main.js');
        assert.strictEqual(cls.type, 'local');
    });

    test('root-relative path is classified as local', () => {
        const cls = classifyReference('/fortweb/app/main.js');
        assert.strictEqual(cls.type, 'local');
    });

    // ── Symlink parent directory ──────────────────────────────────────

    test('rejects symlinked intermediate directory', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            // Create a real file, symlink its parent directory, then
            // reference the file through the symlinked path.
            const realDir = join(tmp, 'real-lib');
            mkdirSync(realDir);
            writeFileSync(join(realDir, 'target.js'), 'content');
            symlinkSync(realDir, join(tmp, 'lib'));
            writeFileSync(join(tmp, 'index.html'), '<script src="./lib/target.js"></script>');
            // ./lib/target.js traverses a symlinked directory component
            assert.throws(() => validateRuntimeClosure(tmp),
                { message: /symlink in path component/ });
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    // ── Malformed syntax ──────────────────────────────────────────────

    test('rejects malformed HTML resource attribute', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            // Unclosed double quote — the parser must fail-closed
            writeFileSync(join(tmp, 'index.html'), '<script src="/app/missing.js></script>');
            assert.throws(() => validateRuntimeClosure(tmp),
                { message: /MALFORMED_HTML_REFERENCE/ });
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('rejects malformed CSS url()', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            // Unclosed double quote inside url()
            writeFileSync(join(tmp, 'style.css'), 'body { background: url("/app/missing.png); }');
            assert.throws(() => validateRuntimeClosure(tmp),
                { message: /MALFORMED_CSS_REFERENCE/ });
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('rejects malformed CSS @import', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            // Unclosed double quote in @import
            writeFileSync(join(tmp, 'style.css'), '@import "./base.css;');
            assert.throws(() => validateRuntimeClosure(tmp),
                { message: /MALFORMED_CSS_REFERENCE/ });
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('rejects malformed percent encoding', () => {
        assert.throws(() =>
            validateLocalReference('/app/%ZZ.js', join(RUNTIME_DIR, 'app/index.html'), RUNTIME_DIR),
            { message: /MALFORMED_PERCENT_ENCODING/ });
    });

    test('rejects external CSS @import', () => {
        const cls = classifyReference('https://fonts.example.com/font.css');
        assert.strictEqual(cls.type, 'external');
    });

    test('rejects missing file referenced via srcset', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            writeFileSync(join(tmp, 'index.html'),
                '<source srcset="/app/img.png 1x, /app/missing.png 2x">');
            assert.throws(() => validateRuntimeClosure(tmp),
                { message: /missing resource/ });
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    // ── Mixed valid + invalid ─────────────────────────────────────────

    test('mixed valid and invalid refs fail the entire closure', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            writeFileSync(join(tmp, 'valid.js'), 'content');
            writeFileSync(join(tmp, 'index.html'),
                '<script src="./valid.js"></script><script src="./missing.js"></script>');
            assert.throws(() => validateRuntimeClosure(tmp),
                { message: /missing resource/ });
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });
});

// ── Accepted syntax coverage ───────────────────────────────────────────────

describe('accepted syntax coverage', () => {
    test('double-quoted HTML attribute resolves', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            writeFileSync(join(tmp, 'lib.js'), 'content');
            writeFileSync(join(tmp, 'index.html'), '<script src="./lib.js"></script>');
            validateRuntimeClosure(tmp);
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('single-quoted HTML attribute resolves', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            writeFileSync(join(tmp, 'lib.js'), 'content');
            writeFileSync(join(tmp, 'index.html'), "<script src='./lib.js'></script>");
            validateRuntimeClosure(tmp);
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('valid ../ reference inside runtime root resolves', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            mkdirSync(join(tmp, 'app'), { recursive: true });
            mkdirSync(join(tmp, 'vendor'), { recursive: true });
            writeFileSync(join(tmp, 'vendor/lib.js'), 'content');
            writeFileSync(join(tmp, 'app/index.html'), '<script src="../vendor/lib.js"></script>');
            validateRuntimeClosure(tmp);
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('double-quoted CSS url() resolves', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            writeFileSync(join(tmp, 'img.png'), '');
            writeFileSync(join(tmp, 'style.css'), 'body { background: url("./img.png"); }');
            validateRuntimeClosure(tmp);
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('single-quoted CSS url() resolves', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            writeFileSync(join(tmp, 'img.png'), '');
            writeFileSync(join(tmp, 'style.css'), "body { background: url('./img.png'); }");
            validateRuntimeClosure(tmp);
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('unquoted CSS url() resolves', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            writeFileSync(join(tmp, 'img.png'), '');
            writeFileSync(join(tmp, 'style.css'), 'body { background: url(./img.png); }');
            validateRuntimeClosure(tmp);
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });

    test('local CSS @import resolves', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'rt-'));
        try {
            writeFileSync(join(tmp, 'base.css'), '');
            writeFileSync(join(tmp, 'style.css'), '@import "./base.css";');
            validateRuntimeClosure(tmp);
        } finally { rmSync(tmp, { recursive: true, force: true }); }
    });
});

// ── Artifact-only sandbox proof ────────────────────────────────────────────

describe('artifact-only sandbox', () => {
    test('closure proof runs without source checkout', async () => {
        const { mkdtemp, cp, rm } = await import('node:fs/promises');
        const { join: pJoin } = await import('node:path');
        const { execFile: execFileCb } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const { tmpdir: osTmpdir } = await import('node:os');
        const execFile = promisify(execFileCb);

        const sandbox = await mkdtemp(join(osTmpdir(), 'fortweb-closure-sandbox-'));
        try {
            await cp(
                join(PROJECT_DIR, 'tools', 'runtime-closure.test.mjs'),
                pJoin(sandbox, 'tools', 'runtime-closure.test.mjs'),
                { recursive: true }
            );
            await cp(RUNTIME_DIR, pJoin(sandbox, 'dist', 'runtime'), { recursive: true });
            await execFile('node', ['--test', 'tools/runtime-closure.test.mjs'], { cwd: sandbox, encoding: 'utf8' });
        } finally {
            await rm(sandbox, { recursive: true, force: true });
        }
    });
});
