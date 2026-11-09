import fs from 'node:fs';
import path from 'node:path';
import { quotesFromSchwab, schwabSymbol, type SchwabQuote } from '@/lib/schwab-quotes';

// Real-time US quotes from the owner's own Schwab developer app. Opt-in: set SCHWAB_HOME to the folder where the
// desktop market_indicator app keeps schwab_tokens.json and settings.json (schwab_key / schwab_secret). Nothing is
// copied out of those files and nothing is written back to them: this module reads the token the desktop app
// already refreshes, and when that access token has lapsed it refreshes its own copy in memory (Schwab does not
// rotate the refresh token, so the two never fight). Read-only: only /marketdata/v1/quotes is ever called.
// Any failure returns {} and callers fall back to Finnhub. Schwab's refresh token lives 7 days; after that, log in
// again from the desktop app.

const API = 'https://api.schwabapi.com';
const HOME = process.env.SCHWAB_HOME?.trim();
const QUOTE_TTL_MS = 1_500; // Schwab allows ~120 requests/min; one batch call covers the whole watchlist, so a 2s poll costs ~30/min
const BATCH = 100;
const TIMEOUT_MS = 5_000;
const FAILURE_BACKOFF_MS = 60_000;
const SEEN_WINDOW_MS = 30_000; // symbols asked for recently are refreshed together
const REFRESH_TOKEN_LIFE_S = 7 * 24 * 3600;

type TokenFile = { access_token?: string; refresh_token?: string; expires_at?: number; refresh_token_issued_at?: number };
type Cached = { quote: SchwabQuote; until: number };

const quoteCache = new Map<string, Cached>();
const seen = new Map<string, number>(); // app symbol -> last time anyone asked for it
let refreshInFlight: Promise<void> | null = null;
let memToken: { access: string; expiresAt: number } | null = null; // our own refreshed copy (seconds)
let refreshing: Promise<string | null> | null = null;
let blockedUntil = 0;
let warnedAt = 0;

export const schwabEnabled = () => Boolean(HOME);

function warn(msg: string) {
    // At most one line a minute; never includes tokens or keys
    if (Date.now() - warnedAt > 60_000) { warnedAt = Date.now(); console.warn(`[schwab] ${msg}`); }
}

function readJSON<T>(name: string): T | null {
    try { return JSON.parse(fs.readFileSync(path.join(HOME!, name), 'utf8')) as T; } catch { return null; }
}

const nowS = () => Date.now() / 1000;

async function refreshAccessToken(file: TokenFile): Promise<string | null> {
    const settings = readJSON<{ schwab_key?: string; schwab_secret?: string }>('settings.json');
    if (!file.refresh_token || !settings?.schwab_key || !settings?.schwab_secret) return null;
    if (file.refresh_token_issued_at && nowS() > file.refresh_token_issued_at + REFRESH_TOKEN_LIFE_S) {
        warn('refresh token expired (7 days); log in again from the desktop app');
        return null;
    }
    const basic = Buffer.from(`${settings.schwab_key}:${settings.schwab_secret}`).toString('base64');
    const res = await fetch(`${API}/v1/oauth/token`, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: file.refresh_token }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
    });
    if (!res.ok) { warn(`token refresh failed (HTTP ${res.status})`); return null; }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) return null;
    memToken = { access: body.access_token, expiresAt: nowS() + (body.expires_in ?? 1800) - 60 };
    return memToken.access;
}

async function accessToken(): Promise<string | null> {
    const file = readJSON<TokenFile>('schwab_tokens.json');
    if (!file) { warn('schwab_tokens.json not found in SCHWAB_HOME'); return null; }
    const fileOk = file.access_token && (file.expires_at ?? 0) > nowS() + 30;
    const memOk = memToken && memToken.expiresAt > nowS() + 30;
    // Use whichever is valid for longer (the desktop app may have refreshed the file since)
    if (fileOk && (!memOk || (file.expires_at ?? 0) >= memToken!.expiresAt)) return file.access_token!;
    if (memOk) return memToken!.access;
    refreshing ??= refreshAccessToken(file).finally(() => { refreshing = null; });
    return refreshing;
}

async function fetchBatch(schwabSymbols: string[], byApp: Map<string, string[]>): Promise<Record<string, SchwabQuote>> {
    const token = await accessToken();
    if (!token) return {};
    const url = `${API}/marketdata/v1/quotes?symbols=${schwabSymbols.map(encodeURIComponent).join(',')}&fields=quote`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
    if (res.status === 401) memToken = null; // next call re-reads the file / refreshes
    if (!res.ok) { warn(`quotes request failed (HTTP ${res.status})`); return {}; }
    return quotesFromSchwab(await res.json(), byApp);
}

// One refresh for everything stale that anyone asked for lately. The watchlist is several tables, each polling its own
// symbols every couple of seconds; refreshing them together keeps Schwab at ~1 call per poll tick however many tables
// are on screen (its limit is ~120/min).
async function refreshStale(): Promise<void> {
    const now = Date.now();
    const byApp = new Map<string, string[]>(); // schwab symbol -> app symbols
    for (const [app, at] of seen) {
        if (now - at > SEEN_WINDOW_MS) { seen.delete(app); continue; }
        if ((quoteCache.get(app)?.until ?? 0) > now) continue;
        const sw = schwabSymbol(app);
        if (sw) byApp.set(sw, [...(byApp.get(sw) ?? []), app]);
    }
    const all = [...byApp.keys()];
    if (all.length === 0) return;
    const batches: string[][] = [];
    for (let i = 0; i < all.length; i += BATCH) batches.push(all.slice(i, i + BATCH));
    let got = 0;
    await Promise.all(batches.map(async (batch) => {
        try {
            const quotes = await fetchBatch(batch, byApp);
            for (const [app, quote] of Object.entries(quotes)) {
                quoteCache.set(app, { quote, until: Date.now() + QUOTE_TTL_MS });
                got++;
            }
        } catch (e) {
            warn(`quotes error: ${e instanceof Error ? e.message : 'unknown'}`);
        }
    }));
    if (got === 0) blockedUntil = Date.now() + FAILURE_BACKOFF_MS; // don't hammer a broken login
}

// Fresh quotes for every symbol Schwab can price, keyed by the app symbol. Symbols it can't price are simply absent.
export async function getSchwabQuotes(symbols: string[]): Promise<Record<string, SchwabQuote>> {
    if (!HOME || Date.now() < blockedUntil) return {};
    const wanted = [...new Set(symbols)].filter((s) => schwabSymbol(s));
    const now = Date.now();
    for (const s of wanted) seen.set(s, now);

    const isFresh = (s: string) => (quoteCache.get(s)?.until ?? 0) > Date.now();
    // At most two rounds: wait for a refresh already under way, then start one if some of ours are still stale
    for (let round = 0; round < 2 && wanted.some((s) => !isFresh(s)); round++) {
        if (refreshInFlight) { await refreshInFlight; continue; }
        refreshInFlight = refreshStale().finally(() => { refreshInFlight = null; });
        await refreshInFlight;
    }

    const out: Record<string, SchwabQuote> = {};
    for (const s of wanted) {
        const hit = quoteCache.get(s);
        if (hit && hit.until > Date.now()) out[s] = hit.quote;
    }
    return out;
}
