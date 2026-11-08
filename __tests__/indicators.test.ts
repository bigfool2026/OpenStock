import { describe, expect, it } from 'vitest';
import { ema, macd, rsi, sma } from '@/lib/indicators';

describe('sma', () => {
    it('is null until the window fills, then the mean of the last N', () => {
        expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    });
    it('returns all nulls when there is less data than the period', () => {
        expect(sma([1, 2], 5)).toEqual([null, null]);
    });
    it('keeps the input length', () => {
        expect(sma(Array.from({ length: 300 }, (_, i) => i), 200)).toHaveLength(300);
    });
});

describe('ema', () => {
    it('seeds with the SMA of the first N, then smooths by 2/(N+1)', () => {
        // seed (1+2+3)/3 = 2 at index 2; k = 0.5 -> 4*.5 + 2*.5 = 3 -> 5*.5 + 3*.5 = 4
        expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    });
    it('stays flat on a flat series', () => {
        expect(ema([7, 7, 7, 7, 7, 7], 3).slice(2)).toEqual([7, 7, 7, 7]);
    });
});

describe('rsi', () => {
    // The worked example from StockCharts' RSI article; their first RSI(14) is 70.53. It needs their
    // 4-decimal closes: rounded to cents the same series gives 70.46, which is not a bug.
    const closes = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282];
    it('matches the published Wilder example', () => {
        const out = rsi(closes, 14);
        expect(out.slice(0, 14).every((v) => v === null)).toBe(true);
        expect(out[14]).toBeCloseTo(70.53, 1);
    });
    it('is 100 on a rising series and 0 on a falling one', () => {
        expect(rsi([1, 2, 3, 4, 5, 6], 3).at(-1)).toBe(100);
        expect(rsi([6, 5, 4, 3, 2, 1], 3).at(-1)).toBe(0);
    });
    it('returns all nulls when there is not enough data', () => {
        expect(rsi([1, 2, 3], 14)).toEqual([null, null, null]);
    });
});

describe('macd', () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 10 + i * 0.3);
    it('lines up with the input and warms up in the right places', () => {
        const m = macd(values);
        expect(m.macd).toHaveLength(60);
        expect(m.macd.findIndex((v) => v !== null)).toBe(25); // slow EMA (26) needs 26 bars
        expect(m.signal.findIndex((v) => v !== null)).toBe(33); // plus 9 for the signal EMA
        expect(m.histogram.findIndex((v) => v !== null)).toBe(33);
    });
    it('histogram is macd minus signal', () => {
        const m = macd(values);
        const i = 50;
        expect(m.histogram[i]).toBeCloseTo(m.macd[i]! - m.signal[i]!, 10);
    });
    it('is zero on a flat series', () => {
        const m = macd(new Array(60).fill(10));
        expect(m.macd.at(-1)).toBeCloseTo(0, 10);
        expect(m.histogram.at(-1)).toBeCloseTo(0, 10);
    });
});
