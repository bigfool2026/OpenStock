import { makeLocalSeconds, type Candle, type ExtendedQuote } from '@/lib/yahoo';

// Pure helpers for Schwab's market data (quotes and price history), kept apart from the network and token code in
// lib/schwab.ts so they can be unit-tested.

// Same shape Finnhub's /quote returns, so callers don't care which source priced a symbol, plus the day's volume and,
// after the close, the after-hours print.
export type SchwabQuote = {
    c: number; d: number; dp: number; h?: number; l?: number; o?: number; pc?: number; t?: number;
    v?: number;
    ext?: ExtendedQuote;
};

// App symbol -> Schwab symbol, or null when Schwab can't price it (crypto pairs, non-US listings, indices).
//   AAPL -> AAPL, BRK.B -> BRK/B (Schwab writes share classes with a slash)
export function schwabSymbol(symbol: string): string | null {
    const upper = (symbol || '').trim().toUpperCase();
    if (/^[A-Z]{1,5}$/.test(upper)) return upper;
    if (/^[A-Z]{1,5}\.[A-Z]$/.test(upper)) return upper.replace('.', '/');
    return null;
}

const ET = 'America/New_York';
const etClock = new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short', hourCycle: 'h23', hour: 'numeric', minute: 'numeric' });
const etDay = new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' });

// Which US session a print at this time (ms) belongs to. Holidays aren't modelled; weekends count as after-hours
// (the last print of the weekend is Friday's).
export function usSession(ms: number): 'pre' | 'regular' | 'post' {
    const p = Object.fromEntries(etClock.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    if (p.weekday === 'Sat' || p.weekday === 'Sun') return 'post';
    const minutes = (Number(p.hour) % 24) * 60 + Number(p.minute);
    if (minutes >= 570 && minutes < 960) return 'regular'; // 9:30 to 16:00
    return minutes >= 240 && minutes < 570 ? 'pre' : 'post';
}

// YYYY-MM-DD in New York for a time in ms.
export const etDate = (ms: number) => etDay.format(new Date(ms));

type SchwabQuotesJson = Record<string, { quote?: Record<string, unknown>; errors?: unknown } | { invalidSymbols?: string[] }>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// Quotes keyed by the *app* symbol. `requested` maps each Schwab symbol we asked for back to the app symbol(s).
// A symbol Schwab reports as invalid, or whose entry has no usable last price, is left out so the caller can
// fall back to another source instead of showing a zero.
//
// After the close Schwab's lastPrice follows after-hours trades, and postMarketChange is that move against the regular
// close. So for a post-market print the regular close is lastPrice - postMarketChange: that becomes the quote's own price
// and day change (what the exchange's session actually did), and the after-hours move goes in `ext`. Before the open
// the lastPrice is shown as the price, against the previous close, with no `ext`: Schwab gives no separate regular
// close then.
export function quotesFromSchwab(json: unknown, requested: Map<string, string[]>): Record<string, SchwabQuote> {
    const out: Record<string, SchwabQuote> = {};
    for (const [sym, entry] of Object.entries((json ?? {}) as SchwabQuotesJson)) {
        const q = (entry as { quote?: Record<string, unknown> })?.quote;
        const last = num(q?.lastPrice);
        if (!q || !last || last <= 0) continue;
        const tradeTime = num(q.tradeTime);
        const prevClose = num(q.closePrice);
        const quote: SchwabQuote = {
            c: last,
            d: num(q.netChange) ?? 0,
            dp: num(q.netPercentChange) ?? 0,
            h: num(q.highPrice),
            l: num(q.lowPrice),
            o: num(q.openPrice),
            pc: prevClose,
            t: tradeTime ? Math.floor(tradeTime / 1000) : undefined,
            v: num(q.totalVolume),
        };
        const pm = num(q.postMarketChange);
        if (tradeTime && pm && prevClose && prevClose > 0 && usSession(tradeTime) === 'post') {
            const regularClose = last - pm;
            if (regularClose > 0) {
                quote.c = regularClose;
                quote.d = regularClose - prevClose;
                quote.dp = (quote.d / prevClose) * 100;
                quote.ext = {
                    session: 'post',
                    price: last,
                    change: pm,
                    changePercent: num(q.postMarketPercentChange) ?? (pm / regularClose) * 100,
                    t: Math.floor(tradeTime / 1000),
                };
            }
        }
        for (const appSymbol of requested.get(sym) ?? []) out[appSymbol] = quote;
    }
    return out;
}

// ---- Price history ---------------------------------------------------------------------------------------------------

type SchwabHistoryJson = { candles?: Array<{ open?: number; high?: number; low?: number; close?: number; volume?: number; datetime?: number }> };

// Bars from /marketdata/v1/pricehistory. Daily and longer carry a date (Schwab stamps them in the early UTC morning, so
// the UTC date is the trading date); intraday carry New York wall-clock seconds, like the Yahoo path. A bar missing a
// price or time is dropped.
export function candlesFromSchwab(json: unknown, kind: 'daily' | 'intraday'): Candle[] {
    const local = makeLocalSeconds(ET);
    const out: Candle[] = [];
    for (const b of (json as SchwabHistoryJson)?.candles ?? []) {
        const { open, high, low, close } = b;
        if (typeof b.datetime !== 'number' || ![open, high, low, close].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
        out.push({
            time: kind === 'daily' ? new Date(b.datetime).toISOString().slice(0, 10) : local(Math.floor(b.datetime / 1000)),
            open: open!, high: high!, low: low!, close: close!,
            volume: typeof b.volume === 'number' ? b.volume : 0,
        });
    }
    return out;
}

// Schwab's daily history stops at the last completed day, so while the market is open (or just after it closed) today's
// bar comes from the live quote. Nothing is added before the open, on weekends, or when the history already has the day.
export function withTodayBar(daily: Candle[], quote: SchwabQuote | undefined): Candle[] {
    if (!quote?.t || quote.o === undefined || quote.h === undefined || quote.l === undefined) return daily;
    if (usSession(quote.t * 1000) === 'pre') return daily;
    const today = etDate(quote.t * 1000);
    const lastBar = daily[daily.length - 1];
    if (lastBar && String(lastBar.time) >= today) return daily;
    return [...daily, { time: today, open: quote.o, high: quote.h, low: quote.l, close: quote.c, volume: quote.v ?? 0 }];
}
