import { describe, expect, it } from 'vitest';
import { SPARK_RANGES, sliceSpark, sparklinePoints, sparklineTrend, type Spark } from '@/lib/sparkline';

describe('sparklinePoints', () => {
    it('puts the low at the bottom and the high at the top, inside the padding', () => {
        const pts = sparklinePoints([10, 20, 15], 100, 40, 2);
        expect(pts[0]).toEqual([2, 38]); // lowest value, bottom edge
        expect(pts[1]).toEqual([50, 2]); // highest value, top edge
        expect(pts[2][1]).toBeCloseTo(20, 10); // halfway between
    });
    it('spans the full padded width, first point to last', () => {
        const pts = sparklinePoints([1, 2, 3, 4, 5], 100, 40, 2);
        expect(pts[0][0]).toBe(2);
        expect(pts.at(-1)![0]).toBe(98);
    });
    it('draws a flat series on the midline instead of dividing by zero', () => {
        const pts = sparklinePoints([7, 7, 7], 100, 40);
        expect(pts.every(([, y]) => y === 20)).toBe(true);
        expect(pts.flat().every(Number.isFinite)).toBe(true);
    });
    it('returns nothing when there is no line to draw', () => {
        expect(sparklinePoints([], 100, 40)).toEqual([]);
        expect(sparklinePoints([5], 100, 40)).toEqual([]);
    });
});

describe('sparklineTrend', () => {
    it('reports the first-to-last move and its direction', () => {
        expect(sparklineTrend([100, 150])).toEqual({ change: 50, up: true });
        expect(sparklineTrend([200, 150])?.change).toBeCloseTo(-25, 10);
        expect(sparklineTrend([200, 150])?.up).toBe(false);
    });
    it('treats no move as up, so a flat line is not painted red', () => {
        expect(sparklineTrend([5, 9, 5])).toEqual({ change: 0, up: true });
    });
    it('has no trend without a usable baseline', () => {
        expect(sparklineTrend([1])).toBeNull();
        expect(sparklineTrend([0, 5])).toBeNull();
    });
});

describe('sliceSpark', () => {
    const DAY = 86400;
    const end = Date.UTC(2026, 10, 6) / 1000; // 2026-11-06
    // `days` bars ending on `end`; step 1 is every calendar day (crypto), a weekday filter makes a stock
    const bars = (days: number, weekdaysOnly: boolean): Spark => {
        const t: number[] = [];
        for (let i = days - 1; i >= 0; i--) {
            const ts = end - i * DAY;
            const dow = new Date(ts * 1000).getUTCDay();
            if (!weekdaysOnly || (dow !== 0 && dow !== 6)) t.push(ts);
        }
        return { t, c: t.map((_, i) => 100 + i) };
    };
    const ymd = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

    it('cuts by calendar months back from the newest bar', () => {
        const spark = bars(365, true);
        const out = sliceSpark(spark, 6);
        const first = spark.t[spark.t.length - out.length];
        expect(ymd(first) >= '2026-05-06').toBe(true);
        expect(ymd(spark.t[spark.t.indexOf(first) - 1]) < '2026-05-06').toBe(true); // and the bar before it is earlier
    });
    it('gives a stock and a 7-day-a-week asset the same window, not the same bar count', () => {
        const stock = sliceSpark(bars(365, true), 3);
        const crypto = sliceSpark(bars(365, false), 3);
        expect(crypto.length).toBeGreaterThan(stock.length); // ~92 daily bars vs ~66 weekday bars
        expect(crypto.length).toBeGreaterThanOrEqual(90);
        expect(stock.length).toBeLessThanOrEqual(68);
    });
    it('keeps the newest value and returns the whole series for a year', () => {
        const spark = bars(365, false);
        expect(sliceSpark(spark, 3).at(-1)).toBe(spark.c.at(-1));
        expect(sliceSpark(spark, 12)).toBe(spark.c);
    });
    it('returns [] for no data', () => {
        expect(sliceSpark(undefined, 3)).toEqual([]);
        expect(sliceSpark({ t: [], c: [] }, 3)).toEqual([]);
    });
});

describe('SPARK_RANGES', () => {
    it('offers 3M, 6M and 1Y, shortest first', () => {
        expect(SPARK_RANGES.map((r) => r.short)).toEqual(['3M', '6M', '1Y']);
        expect(SPARK_RANGES.map((r) => r.months)).toEqual([3, 6, 12]);
    });
});
