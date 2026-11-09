import { aggregateCandles, candlesFromChart, fourHourFromHourly, intradayCandlesFromChart, monthKey, quarterKey, weekKey, yearKey, type Candle } from '@/lib/yahoo';

// Chart timeframes. Yahoo only serves some of these directly (15m up to 60 days, hourly up to two years, daily); its
// 3-month interval is really monthly and a long daily request is silently thinned to monthly, so weekly and longer are
// built here from daily bars (a full history via period1=0), and 4-hour from hourly. That also keeps the partial
// current week, month and year correct instead of depending on Yahoo's end-of-series quirks.
export type TimeframeKey = '15m' | '4h' | '1d' | '1w' | '1mo' | '3mo' | '1y';

export type Timeframe = {
    key: TimeframeKey;
    label: string;
    intraday: boolean;
    visibleBars: number; // how many bars the chart opens on; the rest is lead-in so the long averages start at the left edge
    revalidate: number; // seconds the server may reuse the answer
    // Yahoo query for this timeframe. `from0` means the whole history (period1=0) rather than a fixed range.
    query: { interval: string; range?: string; from0?: boolean };
    build: (json: unknown) => Candle[];
};

export const TIMEFRAMES: Timeframe[] = [
    { key: '15m', label: '15 minutes', intraday: true, visibleBars: 130, revalidate: 60, query: { interval: '15m', range: '60d' }, build: intradayCandlesFromChart },
    { key: '4h', label: '4 hours', intraday: true, visibleBars: 120, revalidate: 120, query: { interval: '60m', range: '730d' }, build: (j) => fourHourFromHourly(intradayCandlesFromChart(j)) },
    { key: '1d', label: 'Daily', intraday: false, visibleBars: 250, revalidate: 300, query: { interval: '1d', range: '2y' }, build: candlesFromChart },
    { key: '1w', label: 'Weekly', intraday: false, visibleBars: 260, revalidate: 600, query: { interval: '1d', range: '10y' }, build: (j) => aggregateCandles(candlesFromChart(j), weekKey) },
    { key: '1mo', label: 'Monthly', intraday: false, visibleBars: 120, revalidate: 3600, query: { interval: '1d', from0: true }, build: (j) => aggregateCandles(candlesFromChart(j), monthKey) },
    { key: '3mo', label: 'Quarterly', intraday: false, visibleBars: 80, revalidate: 3600, query: { interval: '1d', from0: true }, build: (j) => aggregateCandles(candlesFromChart(j), quarterKey) },
    { key: '1y', label: 'Yearly', intraday: false, visibleBars: 60, revalidate: 3600, query: { interval: '1d', from0: true }, build: (j) => aggregateCandles(candlesFromChart(j), yearKey) },
];

export const DEFAULT_TIMEFRAME: TimeframeKey = '1d';

export const getTimeframe = (key: string): Timeframe | undefined => TIMEFRAMES.find((t) => t.key === key);

// Query string for Yahoo's chart endpoint. `now` is rounded up to the hour so a whole-history URL stays the same for
// an hour and the server's fetch cache can actually reuse it.
export function yahooChartQuery(tf: Timeframe, now = Date.now()): string {
    if (tf.query.from0) return `interval=${tf.query.interval}&period1=0&period2=${Math.ceil(now / 3_600_000) * 3600}`;
    return `interval=${tf.query.interval}&range=${tf.query.range}`;
}
