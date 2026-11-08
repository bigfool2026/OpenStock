'use server';

import { candlesFromChart, dailyQuoteFromChart, normalizeYahooSymbol, yahooChartSymbol, type Candle, type YahooDailyQuote } from '@/lib/yahoo';

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
