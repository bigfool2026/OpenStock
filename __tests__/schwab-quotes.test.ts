import { describe, expect, it } from 'vitest';
import { quotesFromSchwab, schwabSymbol } from '@/lib/schwab-quotes';

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
