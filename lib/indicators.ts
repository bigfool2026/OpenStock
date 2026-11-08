// Indicator maths for the native chart. Pure functions over close prices, covered by tests.
// Every function returns an array the same length as its input, with null where the
// indicator has not warmed up yet, so results line up with the candles by index.

export type Series = (number | null)[];

// Simple moving average of the last `period` values.
export function sma(values: number[], period: number): Series {
    const out: Series = new Array(values.length).fill(null);
    if (period < 1 || values.length < period) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period) sum -= values[i - period];
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}

// Exponential moving average, seeded with the SMA of the first `period` values (TradingView's convention).
export function ema(values: number[], period: number): Series {
    const out: Series = new Array(values.length).fill(null);
    if (period < 1 || values.length < period) return out;
    const k = 2 / (period + 1);
    let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period - 1] = prev;
    for (let i = period; i < values.length; i++) {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
}

// Wilder's RSI, the same smoothing TradingView uses.
export function rsi(values: number[], period = 14): Series {
    const out: Series = new Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
        const d = values[i] - values[i - 1];
        if (d >= 0) gain += d; else loss -= d;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    const at = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
    out[period] = at(avgGain, avgLoss);
    for (let i = period + 1; i < values.length; i++) {
        const d = values[i] - values[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
        out[i] = at(avgGain, avgLoss);
    }
    return out;
}

export type Macd = { macd: Series; signal: Series; histogram: Series };

// MACD line = EMA(fast) - EMA(slow); signal = EMA of the MACD line; histogram = the difference.
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): Macd {
    const fastEma = ema(values, fast);
    const slowEma = ema(values, slow);
    const line: Series = values.map((_, i) => (fastEma[i] !== null && slowEma[i] !== null ? fastEma[i]! - slowEma[i]! : null));

    // The signal EMA runs over the MACD line's defined part only
    const first = line.findIndex((v) => v !== null);
    const signal: Series = new Array(values.length).fill(null);
    if (first >= 0) {
        const tail = ema(line.slice(first) as number[], signalPeriod);
        tail.forEach((v, i) => { signal[first + i] = v; });
    }
    const histogram: Series = line.map((v, i) => (v !== null && signal[i] !== null ? v - signal[i]! : null));
    return { macd: line, signal, histogram };
}
