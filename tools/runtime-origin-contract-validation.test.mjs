import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    readWindowRuntimeOriginContract,
} from '../dist/runtime/app/runtime/origin-contract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');

const SOURCE_CONTRACT_PATH = resolve(PROJECT_DIR, 'app/runtime-origin-contract.json');
const PACKAGED_CONTRACT_PATH = resolve(PROJECT_DIR, 'dist/runtime/app/runtime-origin-contract.json');

// ── Load the authoritative source contract ──

const sourceContractBytes = readFileSync(SOURCE_CONTRACT_PATH);
const sourceContract = JSON.parse(sourceContractBytes.toString('utf8'));

const packagedContractBytes = readFileSync(PACKAGED_CONTRACT_PATH);
const packagedContract = JSON.parse(packagedContractBytes.toString('utf8'));

// Helper: wraps the public readWindowRuntimeOriginContract API
// with a minimal mock window carrying the contract under test.
function validateViaPublicApi(contract) {
    const mockWindow = { __FORT_RUNTIME_ORIGIN__: contract };
    return readWindowRuntimeOriginContract(mockWindow);
}

// Returns a fresh deep clone of the authoritative source contract.
// Negative tests must clone before mutating to avoid cross-test pollution.
function cloneSourceContract() {
    return structuredClone(sourceContract);
}

// ── Identity proofs ──

test('source contract exists and parses as JSON', () => {
    assert.ok(sourceContractBytes.length > 0, 'source contract must be non-empty');
    assert.strictEqual(typeof sourceContract, 'object');
});

test('source contract validates through the compiled runtime', () => {
    const validated = validateViaPublicApi(sourceContract);
    assert.notStrictEqual(validated, null);
    assert.strictEqual(validated.schema, 'fortweb.runtime-origin.v1');
});

test('packaged contract bytes equal source contract bytes', () => {
    assert.strictEqual(packagedContractBytes.length, sourceContractBytes.length);
    assert.ok(packagedContractBytes.equals(sourceContractBytes));
});

test('packaged contract validates through the compiled runtime', () => {
    const validated = validateViaPublicApi(packagedContract);
    assert.notStrictEqual(validated, null);
    assert.strictEqual(validated.schema, 'fortweb.runtime-origin.v1');
});

test('validated source and packaged contracts are deep-equal', () => {
    const src = validateViaPublicApi(sourceContract);
    const pkg = validateViaPublicApi(packagedContract);
    assert.deepStrictEqual(pkg, src);
});

// ── Positive validation using the authoritative source contract ──

test('valid contract returns expected normalized fields', () => {
    const contract = validateViaPublicApi(sourceContract);
    assert.notStrictEqual(contract, null);
    assert.strictEqual(contract.appBaseUrl, 'app://local');
    assert.strictEqual(contract.documentOrigin, 'app://local');
    assert.strictEqual(contract.entryUrl, 'app://local/fortweb/app/index.html');
});

test('accepts appBaseUrl with trailing slash', () => {
    const contract = validateViaPublicApi({
        ...sourceContract,
        appBaseUrl: 'app://local/',
    });
    assert.notStrictEqual(contract, null);
    assert.strictEqual(contract.appBaseUrl, 'app://local');
});

test('preserves entryUrl with subdirectory path', () => {
    const contract = validateViaPublicApi(sourceContract);
    assert.notStrictEqual(contract, null);
    assert.strictEqual(contract.entryUrl, 'app://local/fortweb/app/index.html');
    assert.ok(contract.entryUrl.startsWith('app://local/'));
});

test('preserves originPartition', () => {
    const contract = validateViaPublicApi(sourceContract);
    assert.notStrictEqual(contract, null);
    assert.strictEqual(contract.storage.originPartition, 'app://local');
});

test('accepts entryUrl below /fortweb/app/', () => {
    const contract = validateViaPublicApi({
        ...sourceContract,
        entryUrl: 'app://local/fortweb/app/vaults/index.html',
    });
    assert.notStrictEqual(contract, null);
    assert.strictEqual(contract.entryUrl, 'app://local/fortweb/app/vaults/index.html');
});

// ── Negative tests derived from the authoritative source contract ──

test('rejects appBaseUrl with application directory path', () => {
    const contract = cloneSourceContract();
    contract.appBaseUrl = 'app://local/fortweb/app/';
    assert.throws(() => validateViaPublicApi(contract));
});

test('rejects appBaseUrl with wrong host', () => {
    const contract = cloneSourceContract();
    contract.appBaseUrl = 'app://notlocal';
    assert.throws(() => validateViaPublicApi(contract));
});

test('rejects appBaseUrl with wrong scheme', () => {
    const contract = cloneSourceContract();
    contract.appBaseUrl = 'http://local';
    assert.throws(() => validateViaPublicApi(contract));
});

test('rejects relative appBaseUrl', () => {
    const contract = cloneSourceContract();
    contract.appBaseUrl = '/fortweb/app/';
    assert.throws(() => validateViaPublicApi(contract));
});

test('rejects missing appBaseUrl', () => {
    const contract = cloneSourceContract();
    delete contract.appBaseUrl;
    assert.throws(() => validateViaPublicApi(contract));
});

test('rejects entryUrl not under app://local', () => {
    const contract = cloneSourceContract();
    contract.entryUrl = 'app://other/index.html';
    assert.throws(() => validateViaPublicApi(contract));
});

// ── Capability tests ──

test('rejects httpsLikeAssetOrigin=true', () => {
    const contract = cloneSourceContract();
    contract.capabilities.httpsLikeAssetOrigin = true;
    assert.throws(() => validateViaPublicApi(contract));
});

test('rejects implicitBlobOriginSafe=true', () => {
    const contract = cloneSourceContract();
    contract.capabilities.implicitBlobOriginSafe = true;
    assert.throws(() => validateViaPublicApi(contract));
});

test('rejects customScheme=false', () => {
    const contract = cloneSourceContract();
    contract.capabilities.customScheme = false;
    assert.throws(() => validateViaPublicApi(contract));
});

test('rejects networkAllowed=true', () => {
    const contract = cloneSourceContract();
    contract.capabilities.networkAllowed = true;
    assert.throws(() => validateViaPublicApi(contract));
});

test('rejects bundledAssetsOnly=false', () => {
    const contract = cloneSourceContract();
    contract.capabilities.bundledAssetsOnly = false;
    assert.throws(() => validateViaPublicApi(contract));
});

test('validates complete ios capability vector', () => {
    const contract = validateViaPublicApi(sourceContract);
    assert.notStrictEqual(contract, null);
    assert.strictEqual(contract.capabilities.customScheme, true);
    assert.strictEqual(contract.capabilities.httpsLikeAssetOrigin, false);
    assert.strictEqual(contract.capabilities.implicitBlobOriginSafe, false);
    assert.strictEqual(contract.capabilities.networkAllowed, false);
    assert.strictEqual(contract.capabilities.bundledAssetsOnly, true);
});
