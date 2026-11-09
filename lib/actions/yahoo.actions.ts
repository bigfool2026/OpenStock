'use server';

import type { Spark } from '@/lib/sparkline';
import { candlesFromChart, dailyQuoteFromChart, extendedQuotesFromSpark, normalizeYahooSymbol, sparklinesFromSpark, yahooChartSymbol, type Candle, type ExtendedQuote, type YahooDailyQuote } from '@/lib/yahoo';

// Daily Tadawul quotes from Yahoo Finance (free, no key, covers .SR), keyed by the symbol passed in.
// One chart call per symbol (no batch endpoint without login) behind a shared 5-minute cache,
// so the Saudi dashboard costs ~17 requests every 5 minutes, not per user.
export async function getYahooDailyQuotes(symbols: string[]): Promise<Record<string, YahooDailyQuote>> {
    const entries = await Promise.all(
        symbols.map(async (symbol) => {
            const yahooSymbol = normalizeYahooSymbol(symbol);
            if (!yahooSymbol) return [symbol, null] as const;
            try {
                const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    next: { revalidate: 300 },
                });
                if (!res.ok) return [symbol, null] as const;
                return [symbol, dailyQuoteFromChart(await res.json())] as const;
            } catch (e) {
                console.error('Yahoo daily quote error', symbol, e);
                return [symbol, null] as const;
            }
        }),
    );
    return Object.fromEntries(entries.filter(([, q]) => q)) as Record<string, YahooDailyQuote>;
}

// Two years of daily candles for the native chart: a year to show plus enough lead-in for the 200-day average to
// start at the left edge. [] means "no data we trust" (unmapped symbol, Yahoo error, too few bars), and the
// stock page then falls back to the TradingView embed instead of drawing a stub.
const MIN_CANDLES = 30;

export async function getDailyCandles(symbol: string): Promise<Candle[]> {
    const yahooSymbol = yahooChartSymbol(symbol);
    if (!yahooSymbol) return [];
    try {
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=2y`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            next: { revalidate: 300 },
        });
        if (!res.ok) return [];
        const candles = candlesFromChart(await res.json());
        return candles.length >= MIN_CANDLES ? candles : [];
    } catch (e) {
        console.error('Yahoo candles error', symbol, e);
        return [];
    }
}

// A year of daily closes (with their times) for each symbol, for the watchlist's mini charts. Yahoo's spark endpoint prices many
// symbols per request but rejects more than 20 with a 400, so a long watchlist goes out in batches of 20. A
// symbol Yahoo doesn't know is simply missing from the answer, and a failed batch costs only its own rows.
// Cached for an hour: it's daily data, and the page already says it refreshes hourly.
const SPARK_BATCH = 20;

export async function getSparklines(symbols: string[]): Promise<Record<string, Spark>> {
    const appSymbolsByYahoo = new Map<string, string[]>();
    for (const symbol of symbols) {
        const yahooSymbol = yahooChartSymbol(symbol);
        if (yahooSymbol) appSymbolsByYahoo.set(yahooSymbol, [...(appSymbolsByYahoo.get(yahooSymbol) ?? []), symbol]);
    }

    const yahooSymbols = [...appSymbolsByYahoo.keys()];
    const batches: string[][] = [];
    for (let i = 0; i < yahooSymbols.length; i += SPARK_BATCH) batches.push(yahooSymbols.slice(i, i + SPARK_BATCH));

    const out: Record<string, Spark> = {};
    await Promise.all(
        batches.map(async (batch) => {
            try {
                const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${batch.map(encodeURIComponent).join(',')}&range=1y&interval=1d`, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    next: { revalidate: 3600 },
                });
                if (!res.ok) return;
                for (const [yahooSymbol, spark] of Object.entries(sparklinesFromSpark(await res.json()))) {
                    for (const symbol of appSymbolsByYahoo.get(yahooSymbol) ?? []) out[symbol] = spark;
                }
            } catch (e) {
                console.error('Yahoo spark error', batch, e);
            }
        }),
    );
    return out;
}

// Pre-market and after-hours prices, keyed by the symbol passed in. Two days of 5-minute bars including extended
// hours, 20 symbols per spark request, cached for a minute. Only symbols whose latest print is outside the regular
// session come back, so during the day (or for crypto) the answer is empty. Never throws: a failed batch costs
// only its own rows.
export async function getExtendedQuotes(symbols: string[]): Promise<Record<string, ExtendedQuote>> {
    const appSymbolsByYahoo = new Map<string, string[]>();
    for (const symbol of symbols) {
        const yahooSymbol = yahooChartSymbol(symbol);
        if (yahooSymbol) appSymbolsByYahoo.set(yahooSymbol, [...(appSymbolsByYahoo.get(yahooSymbol) ?? []), symbol]);
    }
    const yahooSymbols = [...appSymbolsByYahoo.keys()];
    const batches: string[][] = [];
    for (let i = 0; i < yahooSymbols.length; i += SPARK_BATCH) batches.push(yahooSymbols.slice(i, i + SPARK_BATCH));

    const out: Record<string, ExtendedQuote> = {};
    await Promise.all(
        batches.map(async (batch) => {
            try {
                const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/spark?symbols=${batch.map(encodeURIComponent).join(',')}&range=2d&interval=5m&includePrePost=true`, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    next: { revalidate: 60 },
                });
                if (!res.ok) return;
                for (const [yahooSymbol, quote] of Object.entries(extendedQuotesFromSpark(await res.json()))) {
                    for (const symbol of appSymbolsByYahoo.get(yahooSymbol) ?? []) out[symbol] = quote;
                }
            } catch (e) {
                console.error('Yahoo extended-hours error', batch, e);
            }
        }),
    );
    return out;
}
