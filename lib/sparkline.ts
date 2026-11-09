// Geometry for the watchlist's one-year mini charts. Pure, so the edge cases (flat line, one point) are tested.

export type Point = [x: number, y: number];

// Vertical scale shared by the line and any reference level drawn on it.
function yScale(values: number[], height: number, pad: number, include?: number) {
    let min = include ?? Infinity;
    let max = include ?? -Infinity;
    for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const span = max - min;
    const innerH = height - pad * 2;
    // A price that never moved would divide by zero; park it on the midline instead
    return (v: number) => (span === 0 ? height / 2 : pad + (1 - (v - min) / span) * innerH);
}

// Maps values onto a width x height box with `pad` of breathing room, y flipped so higher prices sit higher.
// Fewer than two points can't make a line, so it returns [] and the caller shows a dash.
// `include` stretches the scale to cover one more level (the previous close on a 1D chart) without adding a point.
export function sparklinePoints(values: number[], width: number, height: number, pad = 2, include?: number): Point[] {
    const n = values.length;
    if (n < 2) return [];
    const y = yScale(values, height, pad, include);
    const innerW = width - pad * 2;
    return values.map((v, i) => [pad + (i / (n - 1)) * innerW, y(v)]);
}

// Where a reference level (the previous close) sits on the same scale as sparklinePoints(values, ..., include = level).
export function sparklineLevelY(level: number, values: number[], height: number, pad = 2): number {
    return yScale(values, height, pad, level)(level);
}

// Move over the window as a percentage: first-to-last, or last against `baseline` when one is given (the previous close
// on a 1D chart, so the number agrees with the day's change in the table). null when there is nothing to compare against.
export function sparklineTrend(values: number[], baseline?: number): { change: number; up: boolean } | null {
    const from = baseline ?? values[0];
    if (values.length < 2 || !from) return null;
    const change = (values[values.length - 1] / from - 1) * 100;
    return { change, up: change >= 0 };
}

// A symbol's daily closes with the time of each, as seconds. Parallel arrays rather than pairs: about 250 of each
// per symbol crosses the server/client boundary for every row, and this serialises smaller.
export type Spark = { t: number[]; c: number[]; pc?: number }; // pc: previous close, set on intraday sparks only

// The windows the watchlist can show. All come out of the one year of data already fetched, so switching is free.
export const SPARK_RANGES = [
    // Today's 15-minute bars: fetched separately (getIntradaySparklines), not cut from the year, so months is 0
    { key: '1d', short: '1D', long: 'today, 15-minute bars', months: 0 },
    { key: '3m', short: '3M', long: '3 months', months: 3 },
    { key: '6m', short: '6M', long: '6 months', months: 6 },
    { key: '1y', short: '1Y', long: '1 year', months: 12 },
] as const;

export type SparkRangeKey = (typeof SPARK_RANGES)[number]['key'];

// Closes from the last `months` calendar months, counted back from the newest bar. Cutting by date rather than
// by bar count matters: a year is about 250 bars for a stock and 365 for crypto, so "the last 63 bars" would be
// three months of one and two of the other.
export function sliceSpark(spark: Spark | undefined, months: number): number[] {
    if (!spark || spark.c.length === 0) return [];
    if (months >= 12) return spark.c; // the fetch is a year, so this is all of it
    const cutoff = new Date(spark.t[spark.t.length - 1] * 1000);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const from = spark.t.findIndex((t) => t >= cutoff.getTime() / 1000);
    return from === -1 ? [] : spark.c.slice(from);
}
