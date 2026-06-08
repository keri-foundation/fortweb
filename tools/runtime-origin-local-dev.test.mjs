import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
    isPlainLocalBrowserDevLocation,
    isRuntimeOriginContractRequired,
} from '../dist/runtime/app/runtime/origin-contract.js';

test('isPlainLocalBrowserDevLocation allows local browser dev origins', () => {
    const allowedOrigins = [
        { protocol: 'http:', hostname: 'localhost' },
        { protocol: 'http:', hostname: '127.0.0.1' },
        { protocol: 'http:', hostname: '::1' },
        { protocol: 'http:', hostname: '[::1]' },
        { protocol: 'https:', hostname: 'localhost' },
    ];

    for (const origin of allowedOrigins) {
        assert.strictEqual(
            isPlainLocalBrowserDevLocation(origin),
            true,
            `Expected ${origin.protocol}//${origin.hostname} to be allowed`
        );
        assert.strictEqual(
            isRuntimeOriginContractRequired(origin),
            false,
            `Expected ${origin.protocol}//${origin.hostname} to not require contract`
        );
    }
});

test('isPlainLocalBrowserDevLocation blocks non-local/bundled/native origins', () => {
    const blockedOrigins = [
        { protocol: 'https:', hostname: 'example.com' },
        { protocol: 'http:', hostname: '192.168.1.10' },
        { protocol: 'http:', hostname: '0.0.0.0' },
        { protocol: 'app:', hostname: 'local' },
        { protocol: 'capacitor:', hostname: 'localhost' },
        { protocol: 'file:', hostname: '' },
    ];

    for (const origin of blockedOrigins) {
        assert.strictEqual(
            isPlainLocalBrowserDevLocation(origin),
            false,
            `Expected ${origin.protocol}//${origin.hostname} to be blocked`
        );
        assert.strictEqual(
            isRuntimeOriginContractRequired(origin),
            true,
            `Expected ${origin.protocol}//${origin.hostname} to require contract`
        );
    }
});