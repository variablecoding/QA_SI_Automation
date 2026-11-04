/**
 * Playwright reporter that posts each test's final outcome (with screenshots) to Salesforce
 * (POST /qa/v1/results). The last post carries "complete": true so the execution finishes and
 * the accelerator's defect analysis, dashboards and quality gate pick the results up.
 */
import { readFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { env, qaApi } from './env';

const OUTCOMES: Record<TestResult['status'], string> = {
    passed: 'Pass',
    failed: 'Fail',
    timedOut: 'Fail',
    skipped: 'Skipped',
    interrupted: 'Error'
};
const MAX_SCREENSHOTS = 3;
const MAX_SCREENSHOT_BYTES = 2_000_000;

export default class SalesforceReporter implements Reporter {
    /** Latest attempt per Salesforce result id (retries overwrite earlier attempts). */
    private readonly payloads = new Map<string, Record<string, unknown>>();

    onTestEnd(test: TestCase, result: TestResult): void {
        const resultId = test.annotations.find(a => a.type === 'resultId')?.description;
        if (!resultId) {
            return;
        }
        const screenshots = result.attachments
            .filter(a => a.contentType === 'image/png' && a.path)
            .slice(-MAX_SCREENSHOTS)
            .map((a, i) => ({ name: `${test.title.split(' ')[0]}-${i + 1}.png`, data: readFileSync(a.path!) }))
            .filter(s => s.data.length <= MAX_SCREENSHOT_BYTES)
            .map(s => ({ name: s.name, base64: s.data.toString('base64') }));
        const error = result.errors.map(e => e.message || '').join('\n').replace(/\u001b\[[0-9;]*m/g, '');
        this.payloads.set(resultId, {
            resultId,
            outcome: OUTCOMES[result.status] || 'Error',
            actualResult: result.status === 'passed' ? 'All UI steps and expectations passed.' : `UI test ${result.status} (attempt ${result.retry + 1}).`,
            errorMessage: error || undefined,
            log: result.steps.map(s => `${s.title} (${s.duration} ms)${s.error ? ' FAILED' : ''}`).join('\n'),
            durationMs: result.duration,
            runUrl: env().runUrl,
            screenshots
        });
    }

    async onEnd(): Promise<void> {
        const all = [...this.payloads.values()];
        for (let i = 0; i < all.length; i++) {
            const payload = i === all.length - 1 ? { ...all[i], complete: true } : all[i];
            try {
                await qaApi('results', { method: 'POST', body: payload });
            } catch (error) {
                console.error(`Could not report ${payload.resultId}:`, error);
            }
        }
        console.log(`Reported ${all.length} UI result(s) to Salesforce.`);
    }
}
