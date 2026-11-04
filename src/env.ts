/**
 * Runner configuration and Salesforce authentication.
 *
 * Auth: SF_AUTH_URL (the "Sfdx Auth Url" of the integration user, a GitHub secret) is
 * exchanged for an access token with the OAuth refresh-token flow. The token is cached in
 * auth/token.json so the manifest step, global setup and the reporter share one login.
 * SF_ACCESS_TOKEN + SF_INSTANCE_URL can be set instead for ad-hoc local runs.
 */
import { createSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const TOKEN_FILE = 'auth/token.json';

export interface RunnerEnv {
    instanceUrl: string;
    accessToken: string;
    executionId: string;
    runUrl?: string;
}

interface Token {
    instanceUrl: string;
    accessToken: string;
}

/**
 * Logs in to Salesforce, in order of preference:
 * 1. JWT bearer flow (CI standard): SF_CLIENT_ID + SF_USERNAME + SF_JWT_KEY (PEM private key of
 *    the Connected App certificate), optional SF_LOGIN_URL (default https://test.salesforce.com).
 * 2. SFDX auth URL (refresh token): SF_AUTH_URL.
 * 3. A ready access token: SF_ACCESS_TOKEN + SF_INSTANCE_URL (local runs).
 */
export async function authenticate(): Promise<Token> {
    if (process.env.SF_CLIENT_ID && process.env.SF_USERNAME && process.env.SF_JWT_KEY) {
        return save(await jwtLogin());
    }
    if (process.env.SF_ACCESS_TOKEN && process.env.SF_INSTANCE_URL) {
        return save({ instanceUrl: process.env.SF_INSTANCE_URL.replace(/\/$/, ''), accessToken: process.env.SF_ACCESS_TOKEN });
    }
    const authUrl = process.env.SF_AUTH_URL;
    if (!authUrl) {
        throw new Error('Set SF_CLIENT_ID + SF_USERNAME + SF_JWT_KEY (JWT), or SF_AUTH_URL, or SF_ACCESS_TOKEN + SF_INSTANCE_URL.');
    }
    const match = authUrl.trim().match(/^force:\/\/([^:]*):([^:]*):(.+)@(.+)$/);
    if (!match) {
        throw new Error('SF_AUTH_URL is not a valid SFDX auth URL.');
    }
    const [, clientId, clientSecret, refreshToken, host] = match;
    const loginUrl = host.startsWith('http') ? host : `https://${host}`;
    const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId || 'PlatformCLI', refresh_token: refreshToken });
    if (clientSecret) {
        body.set('client_secret', clientSecret);
    }
    const response = await fetch(`${loginUrl}/services/oauth2/token`, { method: 'POST', body });
    const json = (await response.json()) as { access_token?: string; instance_url?: string; error_description?: string };
    if (!response.ok || !json.access_token || !json.instance_url) {
        throw new Error(`Salesforce login failed: ${json.error_description || response.status}`);
    }
    return save({ instanceUrl: json.instance_url.replace(/\/$/, ''), accessToken: json.access_token });
}

/** OAuth 2.0 JWT bearer flow with the Connected App's certificate key. */
async function jwtLogin(): Promise<Token> {
    const loginUrl = (process.env.SF_LOGIN_URL || 'https://test.salesforce.com').replace(/\/$/, '');
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256' })}.${encode({
        iss: process.env.SF_CLIENT_ID,
        sub: process.env.SF_USERNAME,
        aud: loginUrl,
        exp: Math.floor(Date.now() / 1000) + 180
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(process.env.SF_JWT_KEY!.replace(/\\n/g, '\n'), 'base64url');
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` });
    const response = await fetch(`${loginUrl}/services/oauth2/token`, { method: 'POST', body });
    const json = (await response.json()) as { access_token?: string; instance_url?: string; error_description?: string };
    if (!response.ok || !json.access_token || !json.instance_url) {
        throw new Error(`Salesforce JWT login failed: ${json.error_description || response.status}`);
    }
    return { instanceUrl: json.instance_url.replace(/\/$/, ''), accessToken: json.access_token };
}

function save(token: Token): Token {
    mkdirSync('auth', { recursive: true });
    writeFileSync(TOKEN_FILE, JSON.stringify(token));
    return token;
}

/** Runner settings; requires authenticate() to have run in this or an earlier step. */
export function env(): RunnerEnv {
    if (!existsSync(TOKEN_FILE)) {
        throw new Error('Not authenticated: run the manifest step first.');
    }
    const token = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as Token;
    const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
    const runUrl = GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : undefined;
    return { ...token, executionId: process.env.QA_EXECUTION_ID || '', runUrl };
}

/** Calls the accelerator's REST API (/services/apexrest/qa/v1/...). */
export async function qaApi(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
    const { instanceUrl, accessToken } = env();
    const response = await fetch(`${instanceUrl}/services/apexrest/qa/v1/${path}`, {
        method: init.method || 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`QA API ${path} failed (${response.status}): ${text}`);
    }
    return text ? JSON.parse(text) : null;
}

/** Single-use browser login URL (frontdoor) for the authenticated user. */
export async function frontdoorUrl(): Promise<string> {
    const { instanceUrl, accessToken } = env();
    const response = await fetch(`${instanceUrl}/services/oauth2/singleaccess`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const json = (await response.json().catch(() => ({}))) as { frontdoor_uri?: string };
    if (!response.ok || !json.frontdoor_uri) {
        throw new Error(`Could not create a browser login URL (${response.status}).`);
    }
    return json.frontdoor_uri;
}
