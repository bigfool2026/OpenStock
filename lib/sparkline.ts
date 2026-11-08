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
