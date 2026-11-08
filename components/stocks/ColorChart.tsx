'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
    CandlestickSeries,
    ColorType,
    HistogramSeries,
    LineSeries,
    LineStyle,
    createChart,
    type ISeriesApi,
    type MouseEventParams,
    type Time,
} from "lightweight-charts";
import Panel from "@/components/Panel";
import { macd, rsi, sma } from "@/lib/indicators";
import type { Candle } from "@/lib/yahoo";
import { cn } from "@/lib/utils";

// TradingView's free embed ignores indicator colours, so this chart is drawn here instead: the colours are ours.
const MAS = [
    { key: 'sma8', period: 8, label: 'SMA 8', color: '#A855F7' }, // purple
    { key: 'sma20', period: 20, label: 'SMA 20', color: '#3B82F6' }, // blue
    { key: 'sma50', period: 50, label: 'SMA 50', color: '#EF4444' }, // red
    { key: 'sma200', period: 200, label: 'SMA 200', color: '#22C55E' }, // green
] as const;

const CHART_HEIGHT = 760;
const VISIBLE_BARS = 250; // about a year of trading days; the rest is lead-in so the 200-day line starts at the left edge
const BACKGROUND = '#1f1e1a'; // --card
const TEXT = '#a8a29e';

const fmt = (v: number | null | undefined, digits = 2) => (v == null ? '—' : v.toFixed(digits));

type Row = Record<string, number | null>;

export default function ColorChart({ candles, extraAction }: { candles: Candle[]; extraAction?: React.ReactNode }) {
    const container = useRef<HTMLDivElement>(null);
    const lineSeries = useRef<Record<string, ISeriesApi<'Line'>>>({});
    const [hidden, setHidden] = useState<string[]>([]);
    const [hover, setHover] = useState<string | null>(null); // null = latest bar

    // One value per bar for every indicator, computed once per data set
    const { rows, indexByTime, series } = useMemo(() => {
        const closes = candles.map((c) => c.close);
        const mas = Object.fromEntries(MAS.map((m) => [m.key, sma(closes, m.period)]));
        const rsi14 = rsi(closes, 14);
        const m = macd(closes);
        const rows: Row[] = candles.map((_, i) => ({
            ...Object.fromEntries(MAS.map((x) => [x.key, mas[x.key][i]])),
            rsi: rsi14[i],
            macd: m.macd[i],
            signal: m.signal[i],
            hist: m.histogram[i],
        }));
        return { rows, indexByTime: new Map(candles.map((c, i) => [c.time, i])), series: { mas, rsi14, m } };
    }, [candles]);

    useEffect(() => {
        const el = container.current;
        if (!el) return;

        const chart = createChart(el, {
            autoSize: true,
            layout: {
                background: { type: ColorType.Solid, color: BACKGROUND },
                textColor: TEXT,
                fontSize: 12,
                panes: { separatorColor: 'rgba(255,255,255,0.08)', separatorHoverColor: 'rgba(255,255,255,0.16)' },
            },
            grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
            rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
            timeScale: { borderColor: 'rgba(255,255,255,0.08)', rightOffset: 4 },
            crosshair: { vertLine: { color: 'rgba(255,255,255,0.25)' }, horzLine: { color: 'rgba(255,255,255,0.25)' } },
        });

        // Pane 0: candles, volume along the bottom edge, and the four averages
        const candle = chart.addSeries(CandlestickSeries, {
            upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
        });
        candle.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.22 } });
        candle.setData(candles.map(({ time, open, high, low, close }) => ({ time: time as Time, open, high, low, close })));

        const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', lastValueVisible: false, priceLineVisible: false });
        volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        volume.setData(candles.map((c) => ({ time: c.time as Time, value: c.volume, color: c.close >= c.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)' })));

        const toLine = (values: (number | null)[]) =>
            values.flatMap((v, i) => (v === null ? [] : [{ time: candles[i].time as Time, value: v }]));

        lineSeries.current = {};
        for (const m of MAS) {
            const s = chart.addSeries(LineSeries, { color: m.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, 0);
            s.setData(toLine(series.mas[m.key]));
            lineSeries.current[m.key] = s;
        }

        // Pane 1: RSI(14) with its 70/30 bands
        const rsiLine = chart.addSeries(LineSeries, { color: '#F59E0B', lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, 1);
        rsiLine.setData(toLine(series.rsi14));
        for (const level of [70, 30]) {
            rsiLine.createPriceLine({ price: level, color: 'rgba(255,255,255,0.25)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
        }

        // Pane 2: MACD(12,26,9), histogram behind its two lines
        const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 2);
        hist.setData(series.m.histogram.flatMap((v, i) => (v === null ? [] : [{ time: candles[i].time as Time, value: v, color: v >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)' }])));
        const macdLine = chart.addSeries(LineSeries, { color: '#38BDF8', lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 2);
        macdLine.setData(toLine(series.m.macd));
        const signalLine = chart.addSeries(LineSeries, { color: '#FB923C', lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 2);
        signalLine.setData(toLine(series.m.signal));

        const panes = chart.panes();
        panes[0]?.setStretchFactor(3);
        panes[1]?.setStretchFactor(0.9);
        panes[2]?.setStretchFactor(1);

        const last = candles.length;
        chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, last - VISIBLE_BARS), to: last + 4 });

        const onMove = (param: MouseEventParams<Time>) => setHover(typeof param.time === 'string' ? param.time : null);
        chart.subscribeCrosshairMove(onMove);

        return () => {
            chart.unsubscribeCrosshairMove(onMove);
            chart.remove();
            lineSeries.current = {};
        };
    }, [candles, series]);

    // Toggling a chip hides the line without rebuilding the chart
    useEffect(() => {
        for (const m of MAS) lineSeries.current[m.key]?.applyOptions({ visible: !hidden.includes(m.key) });
    }, [hidden, candles, series]);

    const at = hover !== null && indexByTime.has(hover) ? indexByTime.get(hover)! : candles.length - 1;
    const row = rows[at] ?? {};
    const bar = candles[at];
    const toggle = (key: string) => setHidden((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));

    return (
        <Panel
            title="Chart"
            sub={`Daily · ${bar ? bar.time : ''} · O ${fmt(bar?.open)}  H ${fmt(bar?.high)}  L ${fmt(bar?.low)}  C ${fmt(bar?.close)}`}
            action={extraAction ?? <Link href="?chart=tv" scroll={false} className="btn btn-ghost h-8 px-2.5 text-[13px]">TradingView chart</Link>}
        >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-white/5 px-3.5 py-2 text-[12px]">
                {MAS.map((m) => {
                    const off = hidden.includes(m.key);
                    return (
                        <button
                            key={m.key}
                            type="button"
                            onClick={() => toggle(m.key)}
                            aria-pressed={!off}
                            title={off ? `Show ${m.label}` : `Hide ${m.label}`}
                            className={cn('num inline-flex items-center gap-1.5 transition-opacity', off && 'opacity-40')}
                        >
                            <span className="inline-block h-[3px] w-4 rounded-full" style={{ backgroundColor: m.color }} />
                            <span className="text-faint">{m.label}</span>
                            <span className="text-foreground">{fmt(row[m.key])}</span>
                        </button>
                    );
                })}
                <span className="num inline-flex items-center gap-1.5">
                    <span className="inline-block h-[3px] w-4 rounded-full" style={{ backgroundColor: '#F59E0B' }} />
                    <span className="text-faint">RSI 14</span><span className="text-foreground">{fmt(row.rsi)}</span>
                </span>
                <span className="num inline-flex items-center gap-1.5">
                    <span className="inline-block h-[3px] w-4 rounded-full" style={{ backgroundColor: '#38BDF8' }} />
                    <span className="text-faint">MACD</span><span className="text-foreground">{fmt(row.macd)}</span>
                    <span className="inline-block h-[3px] w-4 rounded-full" style={{ backgroundColor: '#FB923C' }} />
                    <span className="text-faint">Signal</span><span className="text-foreground">{fmt(row.signal)}</span>
                    <span className="text-faint">Hist</span><span className="text-foreground">{fmt(row.hist)}</span>
                </span>
            </div>
            <div ref={container} style={{ height: CHART_HEIGHT }} />
        </Panel>
    );
}
