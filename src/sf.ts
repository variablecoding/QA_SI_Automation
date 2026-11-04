/**
 * Salesforce Lightning helpers for UI tests. Lightning base components render accessible
 * labels and roles, so locators use getByRole / getByLabel instead of brittle CSS.
 * Inside a record create/edit modal, actions are scoped to the modal.
 */
import { expect, Locator, Page } from '@playwright/test';
import { env } from './env';

export class Sf {
    constructor(private readonly page: Page) {}

    /**
     * Opens Lightning with the session saved by global-setup.ts (one login per run; no
     * password is ever used).
     */
    static async login(page: Page): Promise<void> {
        await page.goto(`${env().instanceUrl}/lightning/page/home`);
        await page.waitForURL(/\/lightning\//, { timeout: 60_000 });
    }

    async goto(path: string): Promise<void> {
        await this.page.goto(env().instanceUrl + path);
        await this.page.waitForLoadState('domcontentloaded');
    }

    async openList(objectApiName: string): Promise<void> {
        await this.goto(`/lightning/o/${objectApiName}/list`);
    }

    async openNew(objectApiName: string): Promise<void> {
        await this.goto(`/lightning/o/${objectApiName}/new`);
        await this.page.getByRole('dialog').first().waitFor({ state: 'visible' });
    }

    async openRecord(recordId: string): Promise<void> {
        await this.goto(`/lightning/r/${recordId}/view`);
    }

    /** The open modal if there is one, otherwise the page. */
    private async scope(): Promise<Page | Locator> {
        // Only a visible modal counts; pages keep hidden dialogs and hidden inline-edit fields.
        const dialog = this.page.locator('[role="dialog"]:visible').last();
        return (await dialog.isVisible().catch(() => false)) ? dialog : this.page;
    }

    /** Matches a field label exactly, allowing the "*" Lightning adds to required fields. */
    private static labelPattern(label: string): RegExp {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^\\s*\\*?\\s*${escaped}\\s*$`);
    }

    async fill(label: string, value: string): Promise<void> {
        const scope = await this.scope();
        await scope.getByLabel(Sf.labelPattern(label)).locator('visible=true').first().fill(value);
    }

    /** Picklist (lightning-combobox): open it and choose the option. */
    async pick(label: string, value: string): Promise<void> {
        const scope = await this.scope();
        // The combobox's accessible name includes its current value, so locate it by label.
        await scope.getByLabel(Sf.labelPattern(label)).locator('visible=true').first().click();
        // Lightning options carry the value in data-value; their accessible name has extra hidden text.
        const byValue = this.page.locator(`[role="option"][data-value="${value.replace(/"/g, '\\"')}"]`).first();
        const byText = this.page.getByRole('option').filter({ hasText: Sf.labelPattern(value) }).first();
        await (await byValue.count() ? byValue : byText).click();
    }

    /** Lookup field: type a search term and choose the first match. */
    async lookup(label: string, search: string): Promise<void> {
        const scope = await this.scope();
        const input = scope.getByLabel(Sf.labelPattern(label)).locator('visible=true').first();
        await input.fill(search);
        await this.page.getByRole('option', { name: new RegExp(search, 'i') }).first().click();
    }

    async check(label: string, checked = true): Promise<void> {
        const scope = await this.scope();
        await scope.getByRole('checkbox', { name: Sf.labelPattern(label) }).locator('visible=true').first().setChecked(checked);
    }

    async click(name: string): Promise<void> {
        const scope = await this.scope();
        await scope.getByRole('button', { name, exact: true }).first().click();
    }

    async save(): Promise<void> {
        await this.click('Save');
    }

    async expectToast(text: string): Promise<void> {
        await expect(this.page.locator('.forceToastMessage, .slds-notify_toast').first()).toContainText(text);
    }

    /**
     * A validation error is shown: Lightning's "Complete this field" / "We hit a snag" texts,
     * or a custom validation-rule message passed as {@code message}.
     */
    async expectFieldError(message?: string): Promise<void> {
        const pattern = message ? new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : /Complete this field|We hit a snag|Review the (following )?errors|Required fields are missing/i;
        await expect(this.page.getByText(pattern).first()).toBeVisible();
    }

    async expectText(text: string): Promise<void> {
        await expect(this.page.getByText(text, { exact: false }).first()).toBeVisible();
    }
}
