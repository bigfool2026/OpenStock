"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { SPARK_RANGES, type SparkRangeKey } from "@/lib/sparkline";
import { cn } from "@/lib/utils";

// One choice for the whole page: the watchlist is several tables, and picking 3M in one should move them all.
// Kept per browser, like the chart indicators on a stock page.
const STORAGE_KEY = 'openstock:watchlist-chart-range';
const DEFAULT_RANGE: SparkRangeKey = '1y';

const isRangeKey = (value: unknown): value is SparkRangeKey => SPARK_RANGES.some((r) => r.key === value);

type RangeContextValue = { range: SparkRangeKey; setRange: (key: SparkRangeKey) => void };

// Outside a provider the table still works, fixed at the default
const RangeContext = createContext<RangeContextValue>({ range: DEFAULT_RANGE, setRange: () => {} });

export function ChartRangeProvider({ children }: { children: React.ReactNode }) {
    const [range, setRangeState] = useState<SparkRangeKey>(DEFAULT_RANGE);

    // Read after mount so the first client render matches what the server sent; a saved choice then takes over
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (isRangeKey(saved)) setRangeState(saved);
        } catch { /* private mode: the default still works */ }
    }, []);

    const setRange = useCallback((key: SparkRangeKey) => {
        setRangeState(key);
        try { localStorage.setItem(STORAGE_KEY, key); } catch { /* still applies for this visit */ }
    }, []);

    const value = useMemo(() => ({ range, setRange }), [range, setRange]);
    return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

export function useChartRange() {
    const { range, setRange } = useContext(RangeContext);
    const current = SPARK_RANGES.find((r) => r.key === range) ?? SPARK_RANGES[SPARK_RANGES.length - 1];
    return { range, setRange, months: current.months, long: current.long };
}

// Sits in each table's chart column header
export function RangeToggle() {
    const { range, setRange } = useChartRange();
    return (
        <div role="group" aria-label="Chart range" className="inline-flex items-center gap-1">
            {SPARK_RANGES.map((r) => (
                <button
                    key={r.key}
                    type="button"
                    onClick={() => setRange(r.key)}
                    aria-pressed={range === r.key}
                    title={`Show the last ${r.long}`}
                    className={cn(
                        'rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide transition-colors',
                        range === r.key ? 'bg-white/10 text-foreground' : 'text-faint hover:text-foreground',
                    )}
                >
                    {r.short}
                </button>
            ))}
        </div>
    );
}
