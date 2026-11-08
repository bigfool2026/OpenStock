import { describe, expect, it } from 'vitest';
import { candlesFromChart, dailyQuoteFromChart, normalizeYahooSymbol, tadawulAppSymbol, yahooChartSymbol } from '@/lib/yahoo';
import { formatSymbolForTradingView, isChartEmbeddable } from '@/lib/utils';

describe('Tadawul symbols', () => {
    it('maps app and TradingView symbols to Yahoo', () => {
        expect(normalizeYahooSymbol('2222.SR')).toBe('2222.SR');
        expect(normalizeYahooSymbol('tadawul:2222')).toBe('2222.SR');
        expect(normalizeYahooSymbol('TADAWUL:TASI')).toBe('^TASI.SR');
        // Bare numbers stay ambiguous: 7203 is Toyota in Tokyo
        expect(normalizeYahooSymbol('7203')).toBeNull();
        expect(normalizeYahooSymbol('AAPL')).toBeNull();
        expect(tadawulAppSymbol('TADAWUL:1120')).toBe('1120.SR');
        expect(tadawulAppSymbol('TADAWUL:TASI')).toBeNull();
    });

    it('charts .SR on TradingView as TADAWUL, without the embed it blocks', () => {
        expect(formatSymbolForTradingView('2222.SR')).toBe('TADAWUL:2222');
        expect(isChartEmbeddable('TADAWUL:2222')).toBe(false);
    });
});

describe('dailyQuoteFromChart', () => {
    const chart = (close: (number | null)[]) => ({ chart: { result: [{ meta: { currency: 'SAR', shortName: 'Saudi Arabian Oil Co.' }, indicators: { quote: [{ close }] } }] } });

    it('compares the last two closes, skipping gaps', () => {
        const q = dailyQuoteFromChart(chart([25, 26, null, 26.52]))!;
        expect(q.price).toBe(26.52);
        expect(q.change).toBeCloseTo(0.52);
        expect(q.changePercent).toBeCloseTo(2);
        expect(q).toMatchObject({ currency: 'SAR', name: 'Saudi Arabian Oil Co.' });
    });

    it("prefers Yahoo's own day change (TASI sends a single daily bar)", () => {
        const json = { chart: { result: [{ meta: { regularMarketPrice: 9921.5, fulldayChange: -101.97, regularMarketChangePercent: -1.017 }, indicators: { quote: [{ close: [9921.5] }] } }] } };
        expect(dailyQuoteFromChart(json)).toMatchObject({ price: 9921.5, change: -101.97, changePercent: -1.017 });
    });

    it('returns null when Yahoo has nothing', () => {
        expect(dailyQuoteFromChart({ chart: { result: null } })).toBeNull();
        expect(dailyQuoteFromChart(chart([null]))).toBeNull();
    });
});

describe('yahooChartSymbol', () => {
    it('passes plain US tickers and Yahoo-style exchange suffixes through', () => {
        expect(yahooChartSymbol('AAPL')).toBe('AAPL');
        expect(yahooChartSymbol('nvda')).toBe('NVDA');
        expect(yahooChartSymbol('2222.SR')).toBe('2222.SR');
        expect(yahooChartSymbol('0700.HK')).toBe('0700.HK');
        expect(yahooChartSymbol('RELIANCE.NS')).toBe('RELIANCE.NS');
    });
    it('rewrites share classes and crypto pairs to Yahoo spelling', () => {
        expect(yahooChartSymbol('BRK.B')).toBe('BRK-B');
        expect(yahooChartSymbol('BINANCE:BTCUSDT')).toBe('BTC-USD');
        expect(yahooChartSymbol('TADAWUL:2222')).toBe('2222.SR');
    });
    it('returns null rather than guess, so the caller falls back to TradingView', () => {
        expect(yahooChartSymbol('')).toBeNull();
        expect(yahooChartSymbol('M&M.NS')).toBeNull();
        expect(yahooChartSymbol('SOMETHING:ELSE')).toBeNull();
        expect(yahooChartSymbol('7203')).toBeNull();
    });
});

describe('candlesFromChart', () => {
    const day = 86400;
    const base = Date.UTC(2026, 0, 5, 14, 30) / 1000; // 2026-01-05 14:30 UTC, a US open
    const json = (over: Record<string, unknown> = {}) => ({
        chart: {
            result: [{
                meta: { gmtoffset: -18000 },
                timestamp: [base, base + day, base + 2 * day, base + 3 * day],
                indicators: {
                    quote: [{
                        open: [10, 11, null, 13],
                        high: [12, 13, 14, 15],
                        low: [9, 10, 11, 12],
                        close: [11, 12, 13, 14],
                        volume: [100, 200, 300, null],
                        ...over,
                    }],
                },
            }],
        },
    });

    it('builds sorted candles keyed by the exchange-local date', () => {
        const out = candlesFromChart(json());
        // 14:30 UTC is 09:30 in New York, still the same calendar day
        expect(out[0]).toEqual({ time: '2026-01-05', open: 10, high: 12, low: 9, close: 11, volume: 100 });
    });
    it('drops bars with a null o/h/l/c and zeroes a missing volume', () => {
        const out = candlesFromChart(json());
        expect(out.map((c) => c.time)).toEqual(['2026-01-05', '2026-01-06', '2026-01-08']); // 01-07 had a null open
        expect(out.at(-1)?.volume).toBe(0);
    });
    it('keeps the later bar when two share a calendar day', () => {
        const dup = json();
        dup.chart.result[0].timestamp = [base, base + 3600, base + day, base + 2 * day];
        const out = candlesFromChart(dup);
        expect(out.filter((c) => c.time === '2026-01-05')).toHaveLength(1);
        expect(out.find((c) => c.time === '2026-01-05')?.close).toBe(12); // the second one
    });
    it('uses the exchange offset, not UTC, to pick the date', () => {
        // 23:30 UTC on Jan 5 is already Jan 6 in Riyadh (UTC+3)
        const late = Date.UTC(2026, 0, 5, 23, 30) / 1000;
        const out = candlesFromChart({ chart: { result: [{ meta: { gmtoffset: 10800 }, timestamp: [late], indicators: { quote: [{ open: [1], high: [1], low: [1], close: [1], volume: [1] }] } }] } });
        expect(out[0].time).toBe('2026-01-06');
    });
    it('returns [] on an error or empty payload', () => {
        expect(candlesFromChart({ chart: { result: null } })).toEqual([]);
        expect(candlesFromChart(null)).toEqual([]);
        expect(candlesFromChart({})).toEqual([]);
    });
});
