import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ZIP_BASENAME } from './runtime-package-manifest.mjs';

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILDER = path.join(PROJECT_DIR, 'tools/build-runtime.mjs');
const SCRATCH = path.join(PROJECT_DIR, 'dist/.runtime-builds');
const BUILD_1 = path.join(SCRATCH, `idempotency-a-${process.pid}`);
const BUILD_2 = path.join(SCRATCH, `idempotency-b-${process.pid}`);
const PACKAGE_1 = path.join(SCRATCH, `idempotency-package-a-${process.pid}`);
const PACKAGE_2 = path.join(SCRATCH, `idempotency-package-b-${process.pid}`);

function runPackager(runtime, output) {
    const args = [path.join(PROJECT_DIR, 'tools/package-runtime.mjs'),
        '--runtime-dir', runtime, '--output-dir', output];
    if (process.env.PACKAGE_REF) args.push('--ref', process.env.PACKAGE_REF);
    return spawnSync(process.execPath, args, { cwd: PROJECT_DIR, encoding: 'utf8' });
}

function runBuilder(target, fault = '', operationFault = '') {
    return spawnSync(process.execPath, [BUILDER, '--out-dir', path.relative(PROJECT_DIR, target)], {
        cwd: PROJECT_DIR,
        encoding: 'utf8',
        env: {
            ...process.env,
            FORTWEB_RUNTIME_BUILD_FAULT: fault,
            FORTWEB_RUNTIME_OPERATION_FAULT: operationFault,
        },
    });
}

function backupPaths(target) {
    const prefix = `.${path.basename(target)}.backup-`;
    return readdirSync(SCRATCH)
        .filter((name) => name.startsWith(prefix))
        .map((name) => path.join(SCRATCH, name));
}

function snapshot(root) {
    const rows = [];
    function walk(directory, prefix = '') {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            const full = path.join(directory, entry.name);
            assert.equal(entry.isSymbolicLink(), false, relative);
            if (entry.isDirectory()) {
                walk(full, relative);
                continue;
            }
            assert.equal(entry.isFile(), true, relative);
            assert.equal(lstatSync(full).nlink, 1, relative);
            const bytes = readFileSync(full);
            rows.push({
                path: relative,
                bytes: bytes.length,
                sha256: createHash('sha256').update(bytes).digest('hex'),
            });
        }
    }
    walk(root);
    rows.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
    const digest = createHash('sha256');
    for (const row of rows) {
        digest.update(`${row.path}\0${row.bytes}\0${row.sha256}\n`);
    }
    return { rows, digest: digest.digest('hex') };
}

function removeTarget(target) {
    assert.equal(path.dirname(path.resolve(target)), path.resolve(SCRATCH));
    rmSync(target, { recursive: true, force: true });
}

after(() => {
    removeTarget(BUILD_1);
    removeTarget(BUILD_2);
    removeTarget(PACKAGE_1);
    removeTarget(PACKAGE_2);
});

test('two clean runtime builds and all three verified package products are byte identical', () => {
    removeTarget(BUILD_1);
    removeTarget(BUILD_2);
    removeTarget(PACKAGE_1);
    removeTarget(PACKAGE_2);
    const first = runBuilder(BUILD_1);
    assert.equal(first.status, 0, first.stderr);
    const firstPackage = runPackager(BUILD_1, PACKAGE_1);
    assert.equal(firstPackage.status, 0, firstPackage.stderr);
    const second = runBuilder(BUILD_2);
    assert.equal(second.status, 0, second.stderr);
    const secondPackage = runPackager(BUILD_2, PACKAGE_2);
    assert.equal(secondPackage.status, 0, secondPackage.stderr);
    assert.deepEqual(snapshot(BUILD_1), snapshot(BUILD_2));
    const products = [ZIP_BASENAME, `${ZIP_BASENAME}.sha256`, 'fortweb-release.json'].sort();
    assert.deepEqual(readdirSync(PACKAGE_1).sort(), products);
    assert.deepEqual(readdirSync(PACKAGE_2).sort(), products);
    for (const name of products) {
        assert(readFileSync(path.join(PACKAGE_1, name)).equals(readFileSync(path.join(PACKAGE_2, name))), name);
    }
});

test('rebuild removes stale and changed output bytes', () => {
    const baseline = snapshot(BUILD_1);
    writeFileSync(path.join(BUILD_1, 'stale-output.txt'), 'stale\n');
    writeFileSync(path.join(BUILD_1, 'app/index.html'), 'changed\n');
    assert.notEqual(snapshot(BUILD_1).digest, baseline.digest);
    const result = runBuilder(BUILD_1);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(path.join(BUILD_1, 'stale-output.txt')), false);
    assert.deepEqual(snapshot(BUILD_1), baseline);
});

for (const fault of ['before-backup', 'after-backup', 'during-promotion']) {
    test(`transactional promotion preserves the complete old tree on ${fault}`, () => {
        const before = snapshot(BUILD_2);
        const result = runBuilder(BUILD_2, fault);
        assert.notEqual(result.status, 0, `${fault} unexpectedly succeeded`);
        assert.ok(existsSync(BUILD_2), `${fault} removed the old target`);
        assert.deepEqual(snapshot(BUILD_2), before);
        const residue = readdirSync(SCRATCH).filter((name) => name.includes(`.${path.basename(BUILD_2)}.`));
        assert.deepEqual(residue, []);
    });
}

test('failure after promotion keeps the complete new tree and recoverable backup', () => {
    const before = snapshot(BUILD_2);
    const result = runBuilder(BUILD_2, 'after-promotion');
    assert.notEqual(result.status, 0);
    assert.deepEqual(snapshot(BUILD_2), before);
    const backups = backupPaths(BUILD_2);
    assert.equal(backups.length, 1);
    assert.deepEqual(snapshot(backups[0]), before);
    removeTarget(backups[0]);
});

test('backup cleanup failure keeps the committed new tree', () => {
    const before = snapshot(BUILD_2);
    const result = runBuilder(BUILD_2, '', 'backup-cleanup');
    assert.notEqual(result.status, 0);
    assert.deepEqual(snapshot(BUILD_2), before);
    const backups = backupPaths(BUILD_2);
    assert.equal(backups.length, 1);
    assert.equal(existsSync(path.join(backups[0], 'app/index.html')), false);
    assert.notEqual(snapshot(backups[0]).digest, before.digest);
    removeTarget(backups[0]);
});

test('backup restore failure retains the complete backup for explicit recovery', () => {
    const before = snapshot(BUILD_2);
    const result = runBuilder(BUILD_2, 'after-backup', 'backup-restore');
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(BUILD_2), false);
    const backups = backupPaths(BUILD_2);
    assert.equal(backups.length, 1);
    assert.deepEqual(snapshot(backups[0]), before);
    renameSync(backups[0], BUILD_2);
    assert.deepEqual(snapshot(BUILD_2), before);
});
