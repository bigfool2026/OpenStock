import { describe, expect, it } from 'vitest';
import { candlesFromSchwab, etDate, quotesFromSchwab, schwabSymbol, usSession, withTodayBar } from '@/lib/schwab-quotes';
import { fourHourFromHalfHourly, type Candle } from '@/lib/yahoo';
import { TIMEFRAMES } from '@/lib/timeframes';

describe('schwabSymbol', () => {
    it('maps US tickers and share classes, and refuses what Schwab cannot price', () => {
        expect(schwabSymbol('aapl')).toBe('AAPL');
        expect(schwabSymbol('BRK.B')).toBe('BRK/B');
        expect(schwabSymbol('BINANCE:BTCUSDT')).toBeNull();
        expect(schwabSymbol('2222.SR')).toBeNull();
        expect(schwabSymbol('0700.HK')).toBeNull();
        expect(schwabSymbol('')).toBeNull();
    });
});

describe('quotesFromSchwab', () => {
    const entry = (q: Record<string, unknown>) => ({ quote: q, realtime: true });
    const requested = new Map([['NVDA', ['NVDA']], ['BRK/B', ['BRK.B']], ['XLE', ['XLE']]]);

    it('turns Schwab quotes into Finnhub-shaped ones, keyed by app symbol', () => {
        const out = quotesFromSchwab({
            NVDA: entry({ lastPrice: 176.13, netChange: -10.51, netPercentChange: -5.63, highPrice: 179.9, lowPrice: 170.2, openPrice: 173, closePrice: 186.64, tradeTime: 1794241597108 }),
            'BRK/B': entry({ lastPrice: 566.86, netChange: -4.03, netPercentChange: -0.7, closePrice: 570.89 }),
        }, requested);
        expect(out.NVDA).toEqual({ c: 176.13, d: -10.51, dp: -5.63, h: 179.9, l: 170.2, o: 173, pc: 186.64, t: 1794241597 });
        expect(out['BRK.B'].c).toBe(566.86);
        expect(out['BRK/B']).toBeUndefined();
    });

    it('drops invalid symbols and entries without a usable last price', () => {
        const out = quotesFromSchwab({
            XLE: entry({ lastPrice: 0 }),
            NVDA: { errors: 'x' },
            errors: { invalidSymbols: ['BTC/USD'] },
        }, requested);
        expect(out).toEqual({});
    });

    it('survives garbage', () => {
        expect(quotesFromSchwab(null, requested)).toEqual({});
        expect(quotesFromSchwab('nope', requested)).toEqual({});
    });
});

const et = (mo: number, d: number, h: number, mi: number) => Date.UTC(2026, mo - 1, d, h + 5, mi); // November: EST, UTC-5

describe('usSession', () => {
    it('splits the New York day, and treats weekends as after-hours', () => {
        expect(usSession(et(11, 9, 8, 0))).toBe('pre');
        expect(usSession(et(11, 9, 9, 30))).toBe('regular');
        expect(usSession(et(11, 9, 15, 59))).toBe('regular');
        expect(usSession(et(11, 9, 16, 0))).toBe('post');
        expect(usSession(et(11, 9, 3, 0))).toBe('post'); // overnight still belongs to the last session
        expect(usSession(et(11, 7, 12, 0))).toBe('post'); // Saturday
    });
});

describe('quotesFromSchwab after hours', () => {
    const requested = new Map([['NVDA', ['NVDA']]]);
    const quote = (tradeTime: number, extra: Record<string, unknown> = {}) => ({
        NVDA: { quote: { lastPrice: 178.8461, netChange: -7.7939, netPercentChange: -4.1759, closePrice: 186.64, postMarketChange: 0.1761, postMarketPercentChange: 0.0986, openPrice: 173.065, highPrice: 179.92, lowPrice: 170.24, totalVolume: 458380963, tradeTime, ...extra } },
    });

    it('after the close: the regular close is the price, the after-hours move is ext', () => {
        const q = quotesFromSchwab(quote(et(11, 9, 17, 38)), requested).NVDA;
        expect(q.c).toBeCloseTo(178.67, 4);
        expect(q.d).toBeCloseTo(-7.97, 4);
        expect(q.dp).toBeCloseTo((-7.97 / 186.64) * 100, 4);
        expect(q.ext).toMatchObject({ session: 'post', price: 178.8461, change: 0.1761, changePercent: 0.0986 });
        expect(q.v).toBe(458380963);
    });
    it('during the session: the last price as is, no ext', () => {
        const q = quotesFromSchwab(quote(et(11, 9, 11, 46)), requested).NVDA;
        expect(q.c).toBe(178.8461);
        expect(q.dp).toBe(-4.1759);
        expect(q.ext).toBeUndefined();
    });
    it('before the open: the pre-market price as is, no ext (Schwab gives no separate regular close then)', () => {
        const q = quotesFromSchwab(quote(et(11, 9, 8, 15)), requested).NVDA;
        expect(q.c).toBe(178.8461);
        expect(q.ext).toBeUndefined();
    });
    it('no after-hours trades: no ext', () => {
        expect(quotesFromSchwab(quote(et(11, 9, 17, 38), { postMarketChange: 0 }), requested).NVDA.ext).toBeUndefined();
        expect(quotesFromSchwab(quote(et(11, 9, 17, 38), { postMarketChange: undefined }), requested).NVDA.ext).toBeUndefined();
    });
});

describe('candlesFromSchwab', () => {
    it('daily: the UTC date is the trading date; bad bars are dropped', () => {
        const out = candlesFromSchwab({ candles: [
            { open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, datetime: Date.UTC(2026, 10, 6, 6, 0) },
            { open: 1, high: 2, low: 0.5, close: null, volume: 10, datetime: Date.UTC(2026, 10, 7, 6, 0) },
            { open: 1, high: 2, low: 0.5, close: 1, datetime: undefined },
        ] }, 'daily');
        expect(out).toEqual([{ time: '2026-11-06', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
    });
    it('intraday: New York wall-clock seconds, across a daylight-saving change', () => {
        const out = candlesFromSchwab({ candles: [
            { open: 1, high: 1, low: 1, close: 1, volume: 1, datetime: Date.UTC(2026, 9, 30, 13, 30) }, // EDT
            { open: 2, high: 2, low: 2, close: 2, volume: 1, datetime: Date.UTC(2026, 10, 9, 14, 30) }, // EST
        ] }, 'intraday');
        expect(out.map((c) => c.time)).toEqual([Date.UTC(2026, 9, 30, 9, 30) / 1000, Date.UTC(2026, 10, 9, 9, 30) / 1000]);
    });
    it('survives garbage', () => {
        expect(candlesFromSchwab(null, 'daily')).toEqual([]);
        expect(candlesFromSchwab({ candles: 'x' }, 'daily')).toEqual([]);
    });
});

describe('withTodayBar', () => {
    const daily: Candle[] = [{ time: '2026-11-06', open: 1, high: 2, low: 1, close: 2, volume: 5 }];
    const q = (t: number) => ({ c: 3, d: 1, dp: 1, o: 2, h: 4, l: 1.5, v: 99, t: Math.floor(t / 1000) });

    it('appends today from the quote once the session has started', () => {
        const out = withTodayBar(daily, q(et(11, 9, 11, 0)));
        expect(out[1]).toEqual({ time: '2026-11-09', open: 2, high: 4, low: 1.5, close: 3, volume: 99 });
        expect(withTodayBar(daily, q(et(11, 9, 17, 0)))).toHaveLength(2); // after the close too
    });
    it('adds nothing before the open, when the history has the day, or without a usable quote', () => {
        expect(withTodayBar(daily, q(et(11, 9, 8, 0)))).toBe(daily);
        expect(withTodayBar(daily, q(et(11, 6, 15, 0)))).toBe(daily); // quote is still Friday
        expect(withTodayBar(daily, undefined)).toBe(daily);
        expect(withTodayBar(daily, { c: 3, d: 0, dp: 0, t: Math.floor(et(11, 9, 11, 0) / 1000) })).toBe(daily); // no o/h/l
    });
    it('etDate is the New York calendar date', () => {
        expect(etDate(Date.UTC(2026, 10, 10, 2, 0))).toBe('2026-11-09'); // 21:00 the evening before
    });
});

describe('Schwab sources for each timeframe', () => {
    it('every timeframe has one, built from half-hour, daily or longer history', () => {
        expect(TIMEFRAMES.map((t) => [t.key, t.schwab.minute?.frequency ?? null, t.schwab.years ?? null])).toEqual([
            ['15m', 15, null], ['4h', 30, null], ['1d', null, 2], ['1w', null, 10], ['1mo', null, 20], ['3mo', null, 20], ['1y', null, 20],
        ]);
    });
    it('4-hour bars from half-hour ones: a 13-bar US day becomes 8 + 5', () => {
        const half = Array.from({ length: 13 }, (_, i) => ({ time: Date.UTC(2026, 10, 9, 9, 30 + i * 30) / 1000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10 }));
        const out = fourHourFromHalfHourly(half);
        expect(out).toHaveLength(2);
        expect(out[0]).toMatchObject({ open: 100, close: 107.5, volume: 80 });
        expect(out[1]).toMatchObject({ open: 108, close: 112.5, volume: 50 });
    });
});
