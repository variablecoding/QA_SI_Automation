/**
 * Step 1 of a run: checks the target org is not production, fetches the UI run manifest from
 * Salesforce and writes one Playwright spec per test into ./generated.
 * Tests without a script are reported as Error immediately.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authenticate, env, qaApi } from './env';

interface ManifestTest {
    resultId: string;
    testCaseId: string;
    name: string;
    title: string;
    basePath?: string;
    viewport?: string;
    script?: string;
}

async function assertNonProduction(): Promise<void> {
    const { instanceUrl, accessToken } = env();
    const query = encodeURIComponent('SELECT IsSandbox, OrganizationType FROM Organization');
    const response = await fetch(`${instanceUrl}/services/data/v62.0/query?q=${query}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const org = (await response.json()).records?.[0];
    if (!org || (!org.IsSandbox && org.OrganizationType !== 'Developer Edition')) {
        throw new Error('Refusing to run UI tests: the target org is a production org (sandbox-first rule).');
    }
}

function specFor(test: ManifestTest): string {
    const [width, height] = (test.viewport || '1440x900').split('x').map(Number);
    const body = (test.script || '')
        .split('\n')
        .map(line => '    ' + line)
        .join('\n');
    return `// Generated from Salesforce test ${test.name}. Do not edit: change the script in the UI Test Studio.
import { test, expect } from '@playwright/test';
import { Sf } from '../src/sf';

test.use({ viewport: { width: ${width || 1440}, height: ${height || 900} } });

test(${JSON.stringify(`${test.name} ${test.title}`)}, async ({ page }) => {
    test.info().annotations.push({ type: 'resultId', description: ${JSON.stringify(test.resultId)} });
    const sf = new Sf(page);
    await Sf.login(page);
    ${test.basePath ? `await sf.goto(${JSON.stringify(test.basePath)});` : ''}
${body}
    void expect;
});
`;
}

async function main(): Promise<void> {
    await authenticate();
    const { executionId, runUrl } = env();
    if (!executionId) {
        throw new Error('QA_EXECUTION_ID must be set.');
    }
    await assertNonProduction();
    const manifest = await qaApi(`ui-runs/${executionId}`);
    const dir = join(__dirname, '..', 'generated');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    let written = 0;
    for (const test of manifest.tests as ManifestTest[]) {
        if (!test.script) {
            await qaApi('results', { method: 'POST', body: { resultId: test.resultId, outcome: 'Error', errorMessage: 'No UI script for this test.', runUrl } });
            continue;
        }
        writeFileSync(join(dir, `${test.name}.spec.ts`), specFor(test));
        written++;
    }
    console.log(`Execution ${executionId}: wrote ${written} spec(s).`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
