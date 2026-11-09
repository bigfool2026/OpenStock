import fs from 'node:fs';
import path from 'node:path';
import { candlesFromSchwab, quotesFromSchwab, schwabSymbol, withTodayBar, type SchwabQuote } from '@/lib/schwab-quotes';
import type { Candle } from '@/lib/yahoo';

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

// ---- Price history ----------------------------------------------------------------------------------------------------
// Charts, watchlist sparklines and the 1D chart come from /marketdata/v1/pricehistory, one request per symbol (there is no
// batch form), so everything is cached and metered: a token bucket keeps history to ~70 requests a minute (a burst of 90 for a cold
// page load), leaving room under Schwab's ~120/min for the quote polling. A symbol that can't be fetched returns [] and the caller falls back.

const HISTORY_BURST = 90;
const HISTORY_PER_SECOND = 1.2;
let bucket = { tokens: HISTORY_BURST, at: Date.now() };

async function takeHistoryToken() {
    for (;;) {
        const now = Date.now();
        bucket = { tokens: Math.min(HISTORY_BURST, bucket.tokens + ((now - bucket.at) / 1000) * HISTORY_PER_SECOND), at: now };
        if (bucket.tokens >= 1) { bucket.tokens -= 1; return; }
        await new Promise((r) => setTimeout(r, 250));
    }
}

const historyCache = new Map<string, { at: number; bars: Candle[] }>();
const historyInFlight = new Map<string, Promise<Candle[]>>();
const MAX_HISTORY_ENTRIES = 400;

async function history(key: string, ttlMs: number, kind: 'daily' | 'intraday', params: Record<string, string | number>, wanted: (hit: Candle[]) => boolean = () => true): Promise<Candle[]> {
    const hit = historyCache.get(key);
    if (hit && Date.now() - hit.at < ttlMs && wanted(hit.bars)) return hit.bars;
    let pending = historyInFlight.get(key);
    if (!pending) {
        pending = (async () => {
            const token = await accessToken();
            if (!token) return hit?.bars ?? [];
            await takeHistoryToken();
            const qs = new URLSearchParams(Object.entries({ needExtendedHoursData: 'false', ...params }).map(([k, v]) => [k, String(v)]));
            const res = await fetch(`${API}/marketdata/v1/pricehistory?${qs}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
            if (res.status === 401) memToken = null;
            if (!res.ok) { warn(`price history failed (HTTP ${res.status})`); return hit?.bars ?? []; }
            const bars = candlesFromSchwab(await res.json(), kind);
            if (historyCache.size >= MAX_HISTORY_ENTRIES) historyCache.delete(historyCache.keys().next().value!);
            historyCache.set(key, { at: Date.now(), bars });
            return bars;
        })()
            .catch((e) => { warn(`price history error: ${e instanceof Error ? e.message : 'unknown'}`); return hit?.bars ?? []; })
            .finally(() => historyInFlight.delete(key));
        historyInFlight.set(key, pending);
    }
    return pending;
}

// Schwab's `period` for yearly history only takes these
const YEAR_PERIODS = [1, 2, 3, 5, 10, 15, 20];

// Daily bars for the last `years` (rounded up to a period Schwab accepts), plus today's bar built from the live quote while
// the session is on. A longer span already cached for the symbol serves a shorter request, so one fetch feeds every view.
// Cached an hour. [] when Schwab is off, can't price the symbol, or fails.
export async function getSchwabDailyBars(symbol: string, years: number): Promise<Candle[]> {
    const sw = HOME ? schwabSymbol(symbol) : null;
    if (!sw) return [];
    const period = YEAR_PERIODS.find((y) => y >= years) ?? 20;
    let bars: Candle[] | undefined;
    for (const p of YEAR_PERIODS.filter((y) => y >= period)) {
        const hit = historyCache.get(`daily:${sw}:${p}`);
        if (hit && Date.now() - hit.at < 3_600_000) { bars = hit.bars; break; }
    }
    bars ??= await history(`daily:${sw}:${period}`, 3_600_000, 'daily', { symbol: sw, periodType: 'year', period, frequencyType: 'daily', frequency: 1 });
    if (bars.length === 0) return [];
    const now = new Date();
    const cutoff = `${now.getUTCFullYear() - period}${now.toISOString().slice(4, 10)}`;
    const quote = (await getSchwabQuotes([symbol]))[symbol];
    return withTodayBar(bars.filter((b) => String(b.time) >= cutoff), quote);
}

// Intraday bars of `frequency` minutes over the last `days` calendar days (regular hours). Cached `ttlMs`.
export async function getSchwabMinuteBars(symbol: string, frequency: number, days: number, ttlMs: number): Promise<Candle[]> {
    const sw = HOME ? schwabSymbol(symbol) : null;
    if (!sw) return [];
    const end = Date.now();
    return history(`min:${sw}:${frequency}:${days}`, ttlMs, 'intraday', { symbol: sw, frequencyType: 'minute', frequency, startDate: end - days * 86_400_000, endDate: end });
}

// Closes of the most recent session in 15-minute bars, for the watchlist's 1D chart; the last bar's date finds that session
// (today, or the last trading day on a weekend). Cached 3 minutes: a 15-minute bar changes slowly.
export async function getSchwabIntradayCloses(symbol: string): Promise<{ t: number[]; c: number[] } | null> {
    const bars = await getSchwabMinuteBars(symbol, 15, 5, 180_000);
    if (bars.length === 0) return null;
    // Wall-clock seconds read as UTC, so the UTC date of a bar is its New York date
    const dayOf = (b: Candle) => new Date((b.time as number) * 1000).toISOString().slice(0, 10);
    const last = dayOf(bars[bars.length - 1]);
    const session = bars.filter((b) => dayOf(b) === last);
    return session.length >= 2 ? { t: session.map((b) => b.time as number), c: session.map((b) => b.close) } : null;
}
