// Geometry for the watchlist's one-year mini charts. Pure, so the edge cases (flat line, one point) are tested.

export type Point = [x: number, y: number];

// Maps values onto a width x height box with `pad` of breathing room, y flipped so higher prices sit higher.
// Fewer than two points can't make a line, so it returns [] and the caller shows a dash.
export function sparklinePoints(values: number[], width: number, height: number, pad = 2): Point[] {
    const n = values.length;
    if (n < 2) return [];
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const span = max - min;
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    // A price that never moved would divide by zero; park it on the midline instead
    return values.map((v, i) => [pad + (i / (n - 1)) * innerW, span === 0 ? height / 2 : pad + (1 - (v - min) / span) * innerH]);
}

// First-to-last move over the window, as a percentage. null when there is no baseline to compare against.
export function sparklineTrend(values: number[]): { change: number; up: boolean } | null {
    if (values.length < 2 || !values[0]) return null;
    const change = (values[values.length - 1] / values[0] - 1) * 100;
    return { change, up: change >= 0 };
}

// A symbol's daily closes with the time of each, as seconds. Parallel arrays rather than pairs: about 250 of each
// per symbol crosses the server/client boundary for every row, and this serialises smaller.
export type Spark = { t: number[]; c: number[] };

// The windows the watchlist can show. All come out of the one year of data already fetched, so switching is free.
export const SPARK_RANGES = [
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
