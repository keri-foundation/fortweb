import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './playwright',
    fullyParallel: false,
    workers: process.env['CI'] ? 1 : undefined,
    retries: process.env['CI'] ? 1 : 0,
    reporter: process.env['CI'] ? 'github' : 'list',
    webServer: {
        command: 'python3 scripts/serve_local.py --no-open --port 4173',
        url: 'http://127.0.0.1:4173/fortweb/app/',
        reuseExistingServer: !process.env['CI'],
        timeout: 60_000,
    },
    use: {
        baseURL: 'http://127.0.0.1:4173',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});