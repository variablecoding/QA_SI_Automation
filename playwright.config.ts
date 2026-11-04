import { defineConfig, devices } from '@playwright/test';

/**
 * Specs in ./generated are written by src/manifest.ts from the Salesforce run manifest.
 * Results (with screenshots) are posted back to Salesforce by src/reporter.ts.
 */
export default defineConfig({
    testDir: './generated',
    timeout: 120_000,
    expect: { timeout: 15_000 },
    retries: 1,
    workers: 2,
    reporter: [['list'], ['./src/reporter.ts']],
    globalSetup: './src/global-setup.ts',
    use: {
        ...devices['Desktop Chrome'],
        storageState: 'auth/state.json',
        screenshot: 'on',
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
        actionTimeout: 20_000,
        navigationTimeout: 60_000
    }
});
