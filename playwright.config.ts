import { defineConfig, devices } from '@playwright/test';

const PORT = process.env['FORTWEB_E2E_PORT'] ?? '4173';

export default defineConfig({
    testDir: './playwright',
    fullyParallel: false,
    workers: process.env['CI'] ? 1 : undefined,
    retries: process.env['CI'] ? 1 : 0,
    reporter: process.env['CI'] ? 'github' : 'list',
    webServer: {
        command: `python3 scripts/serve_local.py --no-open --port ${PORT}`,
        url: `http://127.0.0.1:${PORT}/fortweb/app/`,
        reuseExistingServer: false,
        timeout: 60_000,
    },
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});