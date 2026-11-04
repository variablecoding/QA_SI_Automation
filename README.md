# QA UI Runner

Executes the UI (click-through) tests of the QA Automation Accelerator with Playwright on GitHub Actions. This is the CRT-style split: tests are written, approved and triggered in Salesforce (**QA UI Testing** app), browsers run here, and results with screenshots go back to Salesforce.

```
Salesforce run completes ─► workflow_dispatch (QA_GitHub Named Credential)
GitHub Actions: sf login (SF_AUTH_URL) ─► sandbox check ─► GET /qa/v1/ui-runs/{id} ─► specs ─► Playwright
                └─► POST /qa/v1/results (outcome, errors, screenshots, run URL) ─► defect analysis, dashboard, quality gate
```

## Setup (once per org)

1. **Create a repository** from this folder (it is self-contained): copy `ui-runner/` to a new GitHub repo, then commit and push to `main`.
2. **Integration user** in the sandbox with the `QA_Executor` permission set (or `QA_UI_Designer`).
3. **Salesforce login for the runner: JWT bearer flow (recommended).** Current `sf` CLI versions redact access tokens and auth URLs, so the runner logs in by itself:
   - Create a certificate: `openssl req -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -days 730 -subj "/CN=qa-ui-runner"`.
   - Create a Connected App (or External Client App) with OAuth, "Use digital signatures" (upload `server.crt`) and scopes `api refresh_token web`. Pre-authorize the integration user's profile or permission set.
   - GitHub secrets: `SF_CLIENT_ID` (consumer key), `SF_USERNAME` (integration user), `SF_JWT_KEY` (contents of `server.key`). Variable `SF_LOGIN_URL`: `https://test.salesforce.com` for sandboxes (default) or `https://login.salesforce.com` for Developer Edition.
   - Alternative: secret `SF_AUTH_URL` (an SFDX auth URL with a refresh token), if your tooling can produce one.
4. **GitHub token for Salesforce**: a fine-grained personal access token limited to this repo with *Actions: Read and write* (and *Metadata: Read*).
5. **Salesforce Setup**:
   - Named Credentials → External Credentials → **QA GitHub** → Principals: create principal **GitHubRunner**, add an authentication parameter **Token** = the GitHub token.
   - Give the principal to users who run UI tests: Permission Set → External Credential Principal Access → `QA_GitHub - GitHubRunner`.
   - Custom Metadata → **QA Runner** → **GitHub**: set Repository (`owner/name`), Workflow File (`qa-ui-tests.yml`), Git Ref (`main`), Timeout Minutes, and tick **Active**.
6. In the **QA UI Testing** app → UI Test Studio, use "Check connection".

## Writing tests

Scripts are the body of a Playwright test. `page`, `expect` and the `sf` helper are available, and login has already happened:

```ts
await sf.openNew('Account');
await sf.fill('Account Name', 'Synthetic Co');
await sf.pick('Rating', 'Hot');
await sf.save();
await sf.expectToast('was created');
```

| Helper | Purpose |
|---|---|
| `sf.goto(path)`, `sf.openList(obj)`, `sf.openNew(obj)`, `sf.openRecord(id)` | Navigation |
| `sf.fill(label, value)`, `sf.pick(label, value)`, `sf.lookup(label, search)`, `sf.check(label)` | Fields (by visible label) |
| `sf.click(button)`, `sf.save()` | Buttons |
| `sf.expectToast(text)`, `sf.expectFieldError(message?)`, `sf.expectText(text)` | Assertions (`expectFieldError()` matches standard Lightning errors; pass a validation-rule message to match it) |

Plain Playwright (`page.getByRole(...)`, `expect(...)`) works too.

**Record a test:** run `npx playwright codegen https://<sandbox>.my.salesforce.com`, log in, click through, and paste the generated lines into the script in the UI Test Studio.

## Run locally

```bash
npm ci && npx playwright install chromium
export SF_INSTANCE_URL=https://<sandbox>.my.salesforce.com
export SF_ACCESS_TOKEN=$(node ../scripts/apex/ui-session-token.js "$(sf org open --target-org qa-ui-user --url-only --json | jq -r .result.url)")
export QA_EXECUTION_ID=<Test_Execution__c Id with pending UI results>   # e.g. from scripts/apex/smoke_ui_pending.apex
npm run run-ui
```

Login details:
- `src/env.ts` gets the API token (JWT, auth URL or `SF_ACCESS_TOKEN`).
- `src/global-setup.ts` opens the browser once with a single-use frontdoor URL (`/services/oauth2/singleaccess`, or `SF_FRONTDOOR_URL`) and shares that session with all tests.
- Current orgs reject raw session ids on `frontdoor.jsp`.

## Safety

- The runner refuses production orgs, and refuses an org other than the one that dispatched the run.
- No Salesforce credentials are stored in Salesforce or in scripts. The auth URL is only a GitHub secret.
- Scripts come from approved test cases. Review UI scripts like code, because they run with the integration user's access.
