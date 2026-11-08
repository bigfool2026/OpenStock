// Yahoo Finance helpers for Tadawul (.SR) quotes, which TradingView's free embeds and Finnhub's free plan don't price.
// Pure functions, covered by tests; the network call lives in lib/actions/yahoo.actions.ts.

// "2222.SR" or "TADAWUL:2222" -> "2222.SR". TASI index -> "^TASI.SR". Anything else -> null.
export function normalizeYahooSymbol(symbol: string): string | null {
    const upper = (symbol || '').trim().toUpperCase();
    if (/^\d+\.SR$/.test(upper)) return upper;
    if (upper === 'TADAWUL:TASI' || upper === '^TASI.SR') return '^TASI.SR';
    const ticker = upper.startsWith('TADAWUL:') ? upper.slice('TADAWUL:'.length) : '';
    return /^\d+$/.test(ticker) ? `${ticker}.SR` : null;
}

export const isTadawulSymbol = (symbol: string) => normalizeYahooSymbol(symbol) !== null;

// "TADAWUL:2222" -> "2222.SR", the symbol our stock pages use. The TASI index has no stock page.
export const tadawulAppSymbol = (tvSymbol: string) => {
    const yahoo = normalizeYahooSymbol(tvSymbol);
    return yahoo && !yahoo.startsWith('^') ? yahoo : null;
};

export type YahooDailyQuote = {
    price: number;
    change: number;
    changePercent: number;
    currency: string;
    name: string;
};

type YahooChartJson = {
    chart?: {
        result?: Array<{
            meta?: { currency?: string; shortName?: string; longName?: string; regularMarketPrice?: number; fulldayChange?: number; regularMarketChangePercent?: number };
            indicators?: { quote?: Array<{ close?: (number | null)[] }> };
        }>;
    };
};

// Today's quote from a /v8/finance/chart response: Yahoo's own day change when it sends one,
// else the last two daily closes (the TASI index only ever returns one daily bar, so it needs the former).
export function dailyQuoteFromChart(json: unknown): YahooDailyQuote | null {
    const result = (json as YahooChartJson)?.chart?.result?.[0];
    const meta = result?.meta;
    const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((n): n is number => Number.isFinite(n));
    if (!result || closes.length === 0) return null;
    const price = meta?.regularMarketPrice ?? closes[closes.length - 1];
    const prev = closes.length > 1 ? closes[closes.length - 2] : null;
    const change = meta?.fulldayChange ?? (prev != null ? price - prev : 0);
    return {
        price,
        change,
        changePercent: meta?.regularMarketChangePercent ?? (prev ? (change / prev) * 100 : 0),
        currency: result.meta?.currency || 'SAR',
        name: result.meta?.shortName || result.meta?.longName || '',
    };
}

// App symbol -> the symbol Yahoo's chart endpoint wants, or null when we can't say. Callers fall back to the
// TradingView embed on null, so being strict here is safe: a wrong guess would draw another instrument's chart.
//   BRK.B -> BRK-B (Yahoo writes share classes with a dash), BINANCE:BTCUSDT -> BTC-USD, 2222.SR / 0700.HK / RELIANCE.NS as-is.
export function yahooChartSymbol(symbol: string): string | null {
    const upper = (symbol || '').trim().toUpperCase();
    const tadawul = normalizeYahooSymbol(upper);
    if (tadawul) return tadawul;
    const crypto = /^[A-Z0-9]+:([A-Z0-9]{2,10})USDT$/.exec(upper);
    if (crypto) return `${crypto[1]}-USD`;
    if (/^[A-Z]{1,5}\.[A-Z]$/.test(upper)) return upper.replace('.', '-'); // BRK.B, BF.B
    if (/^[A-Z0-9]{1,12}\.(NS|BO|HK|L|T|TO|SS|SZ|AX|SI|KS|DE|PA)$/.test(upper)) return upper;
    if (/^[A-Z]{1,5}$/.test(upper)) return upper;
    return null;
}

export type Candle = {
    time: string; // YYYY-MM-DD in the exchange's own calendar, which is what a daily chart axis wants
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

type YahooCandlesJson = {
    chart?: {
        result?: Array<{
            meta?: { gmtoffset?: number };
            timestamp?: number[];
            indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
        }>;
    };
};

// Daily candles from a /v8/finance/chart response. Yahoo leaves null holes in the arrays (halts, bad prints),
// and a bar missing any of o/h/l/c is dropped rather than patched. Two bars on one calendar day (an
// intraday partial next to the daily bar) keep the later one, since the chart axis rejects duplicate times.
export function candlesFromChart(json: unknown): Candle[] {
    const result = (json as YahooCandlesJson)?.chart?.result?.[0];
    const quote = result?.indicators?.quote?.[0];
    const stamps = result?.timestamp;
    if (!stamps || !quote) return [];
    const offset = result?.meta?.gmtoffset ?? 0;

    const byDay = new Map<string, Candle>();
    stamps.forEach((t, i) => {
        const open = quote.open?.[i];
        const high = quote.high?.[i];
        const low = quote.low?.[i];
        const close = quote.close?.[i];
        if (![open, high, low, close].every((n) => typeof n === 'number' && Number.isFinite(n))) return;
        const time = new Date((t + offset) * 1000).toISOString().slice(0, 10);
        byDay.set(time, { time, open: open!, high: high!, low: low!, close: close!, volume: quote.volume?.[i] ?? 0 });
    });
    return [...byDay.values()].sort((a, b) => (a.time < b.time ? -1 : 1));
}

type YahooSparkJson = {
    spark?: {
        result?: Array<{
            symbol?: string;
            response?: Array<{ indicators?: { quote?: Array<{ close?: (number | null)[] }> } }>;
        }>;
    };
};

// Closing prices per symbol from a /v7/finance/spark response, which prices many symbols in one request.
// Null closes are dropped, and a symbol with fewer than two prices is left out so the caller shows a dash.
export function sparklinesFromSpark(json: unknown): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const item of (json as YahooSparkJson)?.spark?.result ?? []) {
        const closes = (item.response?.[0]?.indicators?.quote?.[0]?.close ?? []).filter(
            (n): n is number => typeof n === 'number' && Number.isFinite(n),
        );
        if (item.symbol && closes.length >= 2) out[item.symbol] = closes;
    }
    return out;
}
