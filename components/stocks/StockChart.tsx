'use client';

import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import TradingViewWidget from "@/components/TradingViewWidget";
import Panel from "@/components/Panel";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CANDLE_CHART_WIDGET_CONFIG } from "@/lib/constants";

// The free embed can't save indicators added inside it, so the ones picked here are kept per browser and
// passed in as `studies` on every chart. Each id was checked on a live advanced-chart embed.
//
// A study's period goes in `inputs.in_0` -- `length` is silently ignored and the study falls back to its
// default (SMA would render as SMA 9). The same id may appear several times, which is how one chart carries
// SMA 8/20/50/200 at once. `key` is what gets stored per browser, so it has to stay unique and stable.
type Indicator = { key: string; label: string; section: string; study: string | { id: string; inputs: Record<string, number> } };

const sma = (n: number): Indicator => ({ key: `sma${n}`, label: `SMA ${n}`, section: 'Moving averages', study: { id: 'STD;SMA', inputs: { in_0: n } } });
const ema = (n: number): Indicator => ({ key: `ema${n}`, label: `EMA ${n}`, section: 'Moving averages', study: { id: 'STD;EMA', inputs: { in_0: n } } });

const INDICATORS: Indicator[] = [
    sma(8), sma(20), sma(50), sma(200),
    ema(21), ema(50),
    { key: 'bb', label: 'Bollinger Bands', section: 'Overlays', study: 'STD;Bollinger_Bands' },
    { key: 'vwap', label: 'VWAP', section: 'Overlays', study: 'STD;VWAP' },
    { key: 'rsi', label: 'RSI', section: 'Oscillators', study: 'STD;RSI' },
    { key: 'macd', label: 'MACD', section: 'Oscillators', study: 'STD;MACD' },
    { key: 'stoch', label: 'Stochastic', section: 'Oscillators', study: 'STD;Stochastic' },
    { key: 'atr', label: 'ATR', section: 'Oscillators', study: 'STD;Average_True_Range' },
];

const SECTIONS = [...new Set(INDICATORS.map((i) => i.section))];
const STORAGE_KEY = 'openstock:chart-indicators';
// On a browser that has never opened the menu. Unchecking everything is remembered as an empty
// list, so these come back only for a genuinely new browser, not after you clear them on purpose.
const DEFAULT_PICKS = ['sma8', 'sma20', 'sma50', 'sma200', 'rsi', 'macd'];
const CHART_HEIGHT = 760; // RSI and MACD each take their own pane below the candles

const inCatalogOrder = (keys: string[]) => INDICATORS.map((i) => i.key).filter((key) => keys.includes(key));

const readSaved = (): string[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null) return inCatalogOrder(DEFAULT_PICKS); // nothing chosen in this browser yet
        const saved = JSON.parse(raw);
        // Filtering against the catalog drops keys from an older build rather than passing them to TradingView
        return Array.isArray(saved) ? inCatalogOrder(saved) : inCatalogOrder(DEFAULT_PICKS);
    } catch {
        return inCatalogOrder(DEFAULT_PICKS); // private mode: defaults still apply for this visit
    }
};

export default function StockChart({ tvSymbol, scriptUrl, switchLink }: { tvSymbol: string; scriptUrl: string; switchLink?: React.ReactNode }) {
    // null until the browser's saved list is read, so the chart mounts once with the right indicators
    const [picked, setPicked] = useState<string[] | null>(null);
    useEffect(() => setPicked(readSaved()), []);

    const toggle = (key: string) => {
        const current = picked ?? [];
        const next = inCatalogOrder(current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
        setPicked(next);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode: still applies for this visit */ }
    };

    const studies = picked && INDICATORS.filter((i) => picked.includes(i.key)).map((i) => i.study);

    const menu = (
        <DropdownMenu>
            <DropdownMenuTrigger className="btn btn-ghost h-8 px-2.5 text-[13px]" disabled={!picked}>
                <SlidersHorizontal /> Indicators{picked?.length ? <span className="num text-faint">{picked.length}</span> : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[420px] w-56 overflow-y-auto">
                <DropdownMenuLabel className="text-[12px] font-normal text-faint">Kept on every chart in this browser</DropdownMenuLabel>
                {SECTIONS.map((section) => (
                    <DropdownMenuGroup key={section}>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-faint">{section}</DropdownMenuLabel>
                        {INDICATORS.filter((i) => i.section === section).map(({ key, label }) => (
                            <DropdownMenuCheckboxItem key={key} checked={picked?.includes(key) ?? false} onCheckedChange={() => toggle(key)} onSelect={(e) => e.preventDefault()}>
                                {label}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuGroup>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );

    return (
        <Panel title="Chart" sub="Live from TradingView · switch interval and style in the chart" action={switchLink ? <div className="flex items-center gap-2">{switchLink}{menu}</div> : menu}>
            {studies ? (
                <TradingViewWidget scriptUrl={scriptUrl} config={{ ...CANDLE_CHART_WIDGET_CONFIG(tvSymbol), studies }} height={CHART_HEIGHT} allowExpand />
            ) : (
                <div className="tv-frame" style={{ height: CHART_HEIGHT }} />
            )}
        </Panel>
    );
}
