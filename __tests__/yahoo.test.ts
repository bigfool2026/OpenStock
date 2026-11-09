import { describe, expect, it } from 'vitest';
import { candlesFromChart, dailyQuoteFromChart, extendedQuotesFromSpark, normalizeYahooSymbol, sparklinesFromSpark, tadawulAppSymbol, yahooChartSymbol } from '@/lib/yahoo';
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

describe('sparklinesFromSpark', () => {
    const item = (symbol: string, close: (number | null)[], timestamp: number[] = close.map((_, i) => 1000 + i)) => ({
        symbol,
        response: [{ timestamp, indicators: { quote: [{ close }] } }],
    });

    it('returns closes with their times, keyed by symbol', () => {
        const out = sparklinesFromSpark({ spark: { result: [item('AAPL', [1, 2, 3], [10, 20, 30]), item('NVDA', [5, 6])] } });
        expect(out.AAPL).toEqual({ t: [10, 20, 30], c: [1, 2, 3] });
        expect(out.NVDA.c).toEqual([5, 6]);
    });
    it('drops a null close together with its timestamp, so the arrays stay aligned', () => {
        const out = sparklinesFromSpark({ spark: { result: [item('AAPL', [1, null, 3, 4], [10, 20, 30, 40])] } });
        expect(out.AAPL).toEqual({ t: [10, 30, 40], c: [1, 3, 4] });
    });
    it('drops a bar whose timestamp is missing', () => {
        const out = sparklinesFromSpark({ spark: { result: [item('AAPL', [1, 2, 3], [10, 20])] } });
        expect(out.AAPL).toEqual({ t: [10, 20], c: [1, 2] });
    });
    it('leaves out a symbol with fewer than two prices', () => {
        const out = sparklinesFromSpark({ spark: { result: [item('NEW', [9]), item('GONE', [null, null]), item('OK', [1, 2])] } });
        expect(Object.keys(out)).toEqual(['OK']);
    });
    it('tolerates an error payload or garbage', () => {
        expect(sparklinesFromSpark({ spark: { result: null, error: { code: 'x' } } })).toEqual({});
        expect(sparklinesFromSpark(null)).toEqual({});
        expect(sparklinesFromSpark({ spark: { result: [{ response: [] }] } })).toEqual({});
    });
});

describe('extendedQuotesFromSpark', () => {
    // One day: pre 100-200, regular 200-300, post 300-400 (seconds, small numbers keep the cases readable)
    const day = { pre: [[{ start: 100, end: 200 }]], regular: [[{ start: 200, end: 300 }]], post: [[{ start: 300, end: 400 }]] };
    const spark = (symbol: string, stamps: number[], close: (number | null)[], tradingPeriods: unknown = day) => ({
        spark: { result: [{ symbol, response: [{ meta: { tradingPeriods }, timestamp: stamps, indicators: { quote: [{ close }] } }] }] },
    });

    it('prices after-hours against the last regular-session print', () => {
        const q = extendedQuotesFromSpark(spark('NVDA', [210, 290, 310, 350], [99, 100, 101, 102]));
        expect(q.NVDA.session).toBe('post');
        expect(q.NVDA.price).toBe(102);
        expect(q.NVDA.t).toBe(350);
        expect(q.NVDA.change).toBeCloseTo(2);
        expect(q.NVDA.changePercent).toBeCloseTo(2);
    });

    it('prices pre-market against the previous regular close, skipping null holes', () => {
        const q = extendedQuotesFromSpark(spark('AMD', [210, 290, 150, 160], [99, 100, 105, null]));
        expect(q.AMD.session).toBe('pre');
        expect(q.AMD.price).toBe(105);
        expect(q.AMD.t).toBe(150);
        expect(q.AMD.changePercent).toBeCloseTo(5);
    });

    it('adds nothing while the regular session is the latest print', () => {
        expect(extendedQuotesFromSpark(spark('MSFT', [150, 250, 260], [1, 2, 3]))).toEqual({});
    });

    it('adds nothing for symbols with no extended-hours schedule (crypto, .SR)', () => {
        expect(extendedQuotesFromSpark(spark('BTC-USD', [250, 350], [1, 2], []))).toEqual({});
    });

    it('adds nothing when there is no regular print to measure the change from', () => {
        expect(extendedQuotesFromSpark(spark('XLE', [310, 350], [1, 2]))).toEqual({});
    });

    it('survives an error or empty response', () => {
        expect(extendedQuotesFromSpark({ spark: { result: null } })).toEqual({});
        expect(extendedQuotesFromSpark(null)).toEqual({});
    });
});

describe('sparklinesFromSpark previous close', () => {
    const json = { spark: { result: [{ symbol: 'NVDA', response: [{ meta: { previousClose: 186.64 }, timestamp: [1, 2, 3], indicators: { quote: [{ close: [176, null, 175] }] } }] }] } };
    it('keeps it only when asked (the 1d window)', () => {
        expect(sparklinesFromSpark(json).NVDA).toEqual({ t: [1, 3], c: [176, 175] });
        expect(sparklinesFromSpark(json, true).NVDA).toEqual({ t: [1, 3], c: [176, 175], pc: 186.64 });
    });
    it('omits it when Yahoo sends none', () => {
        const noMeta = { spark: { result: [{ symbol: 'X', response: [{ timestamp: [1, 2], indicators: { quote: [{ close: [1, 2] }] } }] }] } };
        expect(sparklinesFromSpark(noMeta, true).X).toEqual({ t: [1, 2], c: [1, 2] });
    });
});
