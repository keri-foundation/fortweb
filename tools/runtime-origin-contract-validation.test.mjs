import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
    validateRuntimeOriginContract,
    RuntimeOriginContractError,
} from '../dist/runtime/app/runtime/origin-contract.js';

const BASE_IOS_CONTRACT = {
    schema: "fortweb.runtime-origin.v1",
    version: 1,
    platform: "ios-wkwebview",
    mode: "bundled-offline",
    documentOrigin: "app://local",
    appBaseUrl: "app://local",
    entryUrl: "app://local/fortweb/app/index.html",
    workerUrl: "app://local/fortweb/app/runtime/wallet-worker.py",
    configUrl: "app://local/fortweb/pyscript-ci.toml",
    storage: {
        storageNamespace: "keri-wallet-ios",
        indexedDbRequired: true,
        originPartition: "app://local/",
    },
    capabilities: {
        customScheme: true,
        httpsLikeAssetOrigin: false,
        implicitBlobOriginSafe: false,
        networkAllowed: false,
        bundledAssetsOnly: true,
    },
};

test('validateRuntimeOriginContract accepts valid ios-wkwebview app-local contract', () => {
    const contract = validateRuntimeOriginContract(BASE_IOS_CONTRACT);
    assert.strictEqual(contract.appBaseUrl, "app://local");
    assert.strictEqual(contract.documentOrigin, "app://local");
    assert.strictEqual(contract.entryUrl, "app://local/fortweb/app/index.html");
});

test('validateRuntimeOriginContract rejects appBaseUrl with application directory path', () => {
    const badContract = {
        ...BASE_IOS_CONTRACT,
        appBaseUrl: "app://local/fortweb/app/",
    };
    assert.throws(
        () => validateRuntimeOriginContract(badContract),
        /must use app base URL app:\/\/local/
    );
});

test('validateRuntimeOriginContract accepts appBaseUrl with trailing slash', () => {
    const contract = validateRuntimeOriginContract({
        ...BASE_IOS_CONTRACT,
        appBaseUrl: "app://local/",
    });
    assert.strictEqual(contract.appBaseUrl, "app://local");
});

test('validateRuntimeOriginContract rejects appBaseUrl with wrong host', () => {
    assert.throws(
        () => validateRuntimeOriginContract({
            ...BASE_IOS_CONTRACT,
            appBaseUrl: "app://notlocal",
        }),
        /must use app base URL app:\/\/local/
    );
});

test('validateRuntimeOriginContract rejects appBaseUrl with wrong scheme', () => {
    assert.throws(
        () => validateRuntimeOriginContract({
            ...BASE_IOS_CONTRACT,
            appBaseUrl: "http://local",
        }),
        /must use app base URL app:\/\/local/
    );
});

test('validateRuntimeOriginContract rejects relative appBaseUrl', () => {
    assert.throws(
        () => validateRuntimeOriginContract({
            ...BASE_IOS_CONTRACT,
            appBaseUrl: "/fortweb/app/",
        }),
        /must be an absolute URL/
    );
});

test('validateRuntimeOriginContract rejects missing appBaseUrl', () => {
    const { appBaseUrl, ...missing } = BASE_IOS_CONTRACT;
    assert.throws(
        () => validateRuntimeOriginContract(missing),
        /must be a non-empty string/
    );
});

test('validateRuntimeOriginContract preserves entryUrl with subdirectory path', () => {
    const contract = validateRuntimeOriginContract(BASE_IOS_CONTRACT);
    assert.strictEqual(contract.entryUrl, "app://local/fortweb/app/index.html");
    assert.ok(contract.entryUrl.startsWith("app://local/"));
});

test('validateRuntimeOriginContract preserves originPartition as app://local', () => {
    const contract = validateRuntimeOriginContract(BASE_IOS_CONTRACT);
    assert.strictEqual(contract.storage.originPartition, "app://local");
});

test('validateRuntimeOriginContract accepts entryUrl below /fortweb/app/', () => {
    const contract = validateRuntimeOriginContract({
        ...BASE_IOS_CONTRACT,
        entryUrl: "app://local/fortweb/app/vaults/index.html",
    });
    assert.strictEqual(contract.entryUrl, "app://local/fortweb/app/vaults/index.html");
});

test('validateRuntimeOriginContract rejects entryUrl not under app://local', () => {
    assert.throws(
        () => validateRuntimeOriginContract({
            ...BASE_IOS_CONTRACT,
            entryUrl: "app://other/index.html",
        }),
        /must use app:\/\/local URLs for entryUrl/
    );
});

// ── Capability tests ──

test('validateRuntimeOriginContract rejects httpsLikeAssetOrigin=true', () => {
    assert.throws(
        () => validateRuntimeOriginContract({
            ...BASE_IOS_CONTRACT,
            capabilities: { ...BASE_IOS_CONTRACT.capabilities, httpsLikeAssetOrigin: true },
        }),
        /must set httpsLikeAssetOrigin=false/
    );
});

test('validateRuntimeOriginContract rejects implicitBlobOriginSafe=true', () => {
    assert.throws(
        () => validateRuntimeOriginContract({
            ...BASE_IOS_CONTRACT,
            capabilities: { ...BASE_IOS_CONTRACT.capabilities, implicitBlobOriginSafe: true },
        }),
        /must set implicitBlobOriginSafe=false/
    );
});

test('validateRuntimeOriginContract rejects customScheme=false for app-local', () => {
    assert.throws(
        () => validateRuntimeOriginContract({
            ...BASE_IOS_CONTRACT,
            capabilities: { ...BASE_IOS_CONTRACT.capabilities, customScheme: false },
        }),
        /must set customScheme=true/
    );
});

test('validateRuntimeOriginContract rejects networkAllowed=true', () => {
    assert.throws(
        () => validateRuntimeOriginContract({
            ...BASE_IOS_CONTRACT,
            capabilities: { ...BASE_IOS_CONTRACT.capabilities, networkAllowed: true },
        }),
        /must be false/
    );
});

test('validateRuntimeOriginContract rejects bundledAssetsOnly=false', () => {
    assert.throws(
        () => validateRuntimeOriginContract({
            ...BASE_IOS_CONTRACT,
            capabilities: { ...BASE_IOS_CONTRACT.capabilities, bundledAssetsOnly: false },
        }),
        /must be true/
    );
});

test('validateRuntimeOriginContract validates complete ios capability vector', () => {
    const contract = validateRuntimeOriginContract(BASE_IOS_CONTRACT);
    assert.strictEqual(contract.capabilities.customScheme, true);
    assert.strictEqual(contract.capabilities.httpsLikeAssetOrigin, false);
    assert.strictEqual(contract.capabilities.implicitBlobOriginSafe, false);
    assert.strictEqual(contract.capabilities.networkAllowed, false);
    assert.strictEqual(contract.capabilities.bundledAssetsOnly, true);
});

// ── Short-circuit behavior ──

test('validateRuntimeOriginContract short-circuits on httpsLikeAssetOrigin before implicitBlobOriginSafe', () => {
    // Both wrong — only the first error (httpsLikeAssetOrigin) surfaces
    assert.throws(
        () => validateRuntimeOriginContract({
            ...BASE_IOS_CONTRACT,
            capabilities: {
                ...BASE_IOS_CONTRACT.capabilities,
                httpsLikeAssetOrigin: true,
                implicitBlobOriginSafe: true,
            },
        }),
        /must set httpsLikeAssetOrigin=false/
    );
});

test('validateRuntimeOriginContract catches implicitBlobOriginSafe after httpsLikeAssetOrigin is fixed', () => {
    // Fix first, second surfaces
    assert.throws(
        () => validateRuntimeOriginContract({
            ...BASE_IOS_CONTRACT,
            capabilities: {
                ...BASE_IOS_CONTRACT.capabilities,
                httpsLikeAssetOrigin: false,
                implicitBlobOriginSafe: true,
            },
        }),
        /must set implicitBlobOriginSafe=false/
    );
});
