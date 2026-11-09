import { describe, expect, it } from 'vitest';
import {
    aggregateCandles,
    fourHourFromHourly,
    intradayCandlesFromChart,
    makeLocalSeconds,
    monthKey,
    quarterKey,
    weekKey,
    yearKey,
    type Candle,
} from '@/lib/yahoo';
import { DEFAULT_TIMEFRAME, TIMEFRAMES, getTimeframe, yahooChartQuery } from '@/lib/timeframes';

const day = (time: string, open: number, high: number, low: number, close: number, volume = 100): Candle => ({ time, open, high, low, close, volume });
const wall = (y: number, mo: number, d: number, h: number, mi: number) => Date.UTC(y, mo - 1, d, h, mi) / 1000;

describe('makeLocalSeconds', () => {
    it('reads exchange wall-clock time per bar, across a daylight-saving change', () => {
        const ny = makeLocalSeconds('America/New_York');
        expect(ny(Date.UTC(2026, 7, 17, 13, 30) / 1000)).toBe(wall(2026, 8, 17, 9, 30)); // EDT, UTC-4
        expect(ny(Date.UTC(2026, 10, 9, 14, 30) / 1000)).toBe(wall(2026, 11, 9, 9, 30)); // EST, UTC-5
    });
    it('falls back to the fixed offset for an unknown zone', () => {
        expect(makeLocalSeconds('Not/AZone', -18000)(1000)).toBe(1000 - 18000);
        expect(makeLocalSeconds(undefined, 3600)(1000)).toBe(4600);
    });
});

describe('intradayCandlesFromChart', () => {
    const q = (o: (number | null)[], h: (number | null)[], l: (number | null)[], c: (number | null)[], v: (number | null)[]) => ({ open: o, high: h, low: l, close: c, volume: v });
    const chart = (timestamp: number[], quote: ReturnType<typeof q>) => ({ chart: { result: [{ meta: { exchangeTimezoneName: 'America/New_York' }, timestamp, indicators: { quote: [quote] } }] } });

    it('shifts each bar to exchange time as a number, drops holes, keeps the later of duplicates, sorts', () => {
        const summer = Date.UTC(2026, 7, 17, 13, 30) / 1000;
        const winter = Date.UTC(2026, 10, 9, 14, 30) / 1000;
        const out = intradayCandlesFromChart(chart(
            [winter, summer, summer + 900, summer + 900],
            q([2, 1, 5, 6], [2, 1, 5, 6], [2, 1, 5, 6], [2, 1, null, 7], [20, 10, 50, 60]),
        ));
        expect(out.map((c) => c.time)).toEqual([wall(2026, 8, 17, 9, 30), wall(2026, 8, 17, 9, 45), wall(2026, 11, 9, 9, 30)]);
        expect(out[1].close).toBe(7);
        expect(out[2].volume).toBe(20);
    });
    it('survives garbage', () => {
        expect(intradayCandlesFromChart(null)).toEqual([]);
        expect(intradayCandlesFromChart({ chart: { result: null } })).toEqual([]);
    });
});

describe('aggregateCandles', () => {
    // Wed, Fri, then Mon of the next week
    const days = [day('2026-11-04', 10, 12, 9, 11, 100), day('2026-11-06', 11, 15, 10, 14, 200), day('2026-11-09', 14, 14, 8, 9, 300)];

    it('merges a run into first open, high, low, last close, summed volume, first time', () => {
        const [a] = aggregateCandles(days.slice(0, 2), () => 'x');
        expect(a).toEqual({ time: '2026-11-04', open: 10, high: 15, low: 9, close: 14, volume: 300 });
    });
    it('does not mutate its input', () => {
        const copy = JSON.parse(JSON.stringify(days));
        aggregateCandles(days, () => 'x');
        expect(days).toEqual(copy);
    });
    it('weeks start Monday', () => {
        const out = aggregateCandles(days, weekKey);
        expect(out).toHaveLength(2);
        expect(out[0]).toMatchObject({ time: '2026-11-04', open: 10, close: 14, volume: 300 });
        expect(out[1]).toMatchObject({ time: '2026-11-09', open: 14, close: 9 });
        expect(weekKey(day('2026-11-08', 1, 1, 1, 1))).toBe('2026-11-02'); // Sunday belongs to the week before
    });
    it('months, quarters and years split on the calendar', () => {
        const d = [day('2026-09-30', 1, 1, 1, 1), day('2026-10-01', 2, 2, 2, 2), day('2026-12-31', 3, 3, 3, 3), day('2027-01-04', 4, 4, 4, 4)];
        expect(aggregateCandles(d, monthKey).map((c) => c.time)).toEqual(['2026-09-30', '2026-10-01', '2026-12-31', '2027-01-04']);
        expect(aggregateCandles(d, quarterKey).map((c) => c.time)).toEqual(['2026-09-30', '2026-10-01', '2027-01-04']); // Oct and Dec share Q4
        expect(aggregateCandles(d, yearKey).map((c) => c.time)).toEqual(['2026-09-30', '2027-01-04']);
    });
});

describe('fourHourFromHourly', () => {
    const hour = (d: number, h: number, mi: number, price: number): Candle => ({ time: wall(2026, 11, d, h, mi), open: price, high: price + 1, low: price - 1, close: price + 0.5, volume: 10 });
    const session = (d: number) => [hour(d, 9, 30, 100), hour(d, 10, 30, 101), hour(d, 11, 30, 102), hour(d, 12, 30, 103), hour(d, 13, 30, 104), hour(d, 14, 30, 105), hour(d, 15, 30, 106)];

    it('cuts a seven-bar US day into 4 + 3 and never spans two days', () => {
        const out = fourHourFromHourly([...session(6), ...session(9)]);
        expect(out).toHaveLength(4);
        expect(out[0]).toMatchObject({ time: wall(2026, 11, 6, 9, 30), open: 100, low: 99, high: 104, close: 103.5, volume: 40 });
        expect(out[1]).toMatchObject({ time: wall(2026, 11, 6, 13, 30), open: 104, high: 107, close: 106.5, volume: 30 });
        expect(out[2].time).toBe(wall(2026, 11, 9, 9, 30));
    });
});

describe('timeframes', () => {
    it('offers 15 minutes, 4 hours, daily, weekly, monthly, quarterly and yearly, shortest first', () => {
        expect(TIMEFRAMES.map((t) => t.label)).toEqual(['15 minutes', '4 hours', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly']);
        expect(TIMEFRAMES.filter((t) => t.intraday).map((t) => t.key)).toEqual(['15m', '4h']);
        expect(getTimeframe(DEFAULT_TIMEFRAME)?.label).toBe('Daily');
        expect(getTimeframe('nope')).toBeUndefined();
    });
    it('asks Yahoo for what it serves, and for full daily history where it must be built', () => {
        const now = Date.UTC(2026, 10, 9, 11, 20);
        expect(yahooChartQuery(getTimeframe('15m')!, now)).toBe('interval=15m&range=60d');
        expect(yahooChartQuery(getTimeframe('4h')!, now)).toBe('interval=60m&range=730d');
        const monthly = yahooChartQuery(getTimeframe('1mo')!, now);
        expect(monthly).toMatch(/^interval=1d&period1=0&period2=\d+$/);
        // Same hour, same URL, so the fetch cache can reuse it
        expect(yahooChartQuery(getTimeframe('1mo')!, now + 60_000)).toBe(monthly);
    });
    it('builds weekly and longer from daily candles', () => {
        const json = {
            chart: { result: [{ meta: { gmtoffset: 0 }, timestamp: [Date.UTC(2026, 10, 4, 14) / 1000, Date.UTC(2026, 10, 9, 14) / 1000], indicators: { quote: [{ open: [1, 2], high: [3, 4], low: [0.5, 1], close: [2, 3], volume: [10, 20] }] } }] },
        };
        expect(getTimeframe('1w')!.build(json)).toHaveLength(2);
        expect(getTimeframe('1mo')!.build(json)).toEqual([{ time: '2026-11-04', open: 1, high: 4, low: 0.5, close: 3, volume: 30 }]);
        expect(getTimeframe('1y')!.build(json)).toHaveLength(1);
    });
});
