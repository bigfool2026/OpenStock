// Pure helpers for Schwab's market-data quotes (https://api.schwabapi.com/marketdata/v1/quotes), kept apart from
// the network and token code in lib/schwab.ts so they can be unit-tested.

// Same shape Finnhub's /quote returns, so callers don't care which source priced a symbol.
export type SchwabQuote = { c: number; d: number; dp: number; h?: number; l?: number; o?: number; pc?: number; t?: number };

// App symbol -> Schwab symbol, or null when Schwab can't price it (crypto pairs, non-US listings, indices).
//   AAPL -> AAPL, BRK.B -> BRK/B (Schwab writes share classes with a slash)
export function schwabSymbol(symbol: string): string | null {
    const upper = (symbol || '').trim().toUpperCase();
    if (/^[A-Z]{1,5}$/.test(upper)) return upper;
    if (/^[A-Z]{1,5}\.[A-Z]$/.test(upper)) return upper.replace('.', '/');
    return null;
}

type SchwabQuotesJson = Record<string, { quote?: Record<string, unknown>; errors?: unknown } | { invalidSymbols?: string[] }>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

// Quotes keyed by the *app* symbol. `requested` maps each Schwab symbol we asked for back to the app symbol(s).
// A symbol Schwab reports as invalid, or whose entry has no usable last price, is left out so the caller can
// fall back to another source instead of showing a zero.
export function quotesFromSchwab(json: unknown, requested: Map<string, string[]>): Record<string, SchwabQuote> {
    const out: Record<string, SchwabQuote> = {};
    for (const [sym, entry] of Object.entries((json ?? {}) as SchwabQuotesJson)) {
        const q = (entry as { quote?: Record<string, unknown> })?.quote;
        const c = num(q?.lastPrice);
        if (!q || !c || c <= 0) continue;
        const tradeTime = num(q.tradeTime);
        const quote: SchwabQuote = {
            c,
            d: num(q.netChange) ?? 0,
            dp: num(q.netPercentChange) ?? 0,
            h: num(q.highPrice),
            l: num(q.lowPrice),
            o: num(q.openPrice),
            pc: num(q.closePrice),
            t: tradeTime ? Math.floor(tradeTime / 1000) : undefined,
        };
        for (const appSymbol of requested.get(sym) ?? []) out[appSymbol] = quote;
    }
    return out;
}
