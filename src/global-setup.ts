/**
 * Logs in once before all tests and saves the browser session (auth/state.json); every test
 * reuses it. The login uses a single-use frontdoor URL: SF_FRONTDOOR_URL if set, otherwise one
 * requested from /services/oauth2/singleaccess. Current orgs reject raw session ids on
 * frontdoor.jsp.
 */
import { chromium, FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { frontdoorUrl } from './env';

export const STATE_FILE = 'auth/state.json';

export default async function globalSetup(_config: FullConfig): Promise<void> {
    // SF_FRONTDOOR_URL (from `sf org open --url-only`) wins; otherwise ask Salesforce for one.
    const loginUrl = process.env.SF_FRONTDOOR_URL || (await frontdoorUrl());
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(loginUrl);
    await page.waitForURL(/\/lightning\//, { timeout: 90_000 });
    await page.context().storageState({ path: STATE_FILE });
    await browser.close();
}
