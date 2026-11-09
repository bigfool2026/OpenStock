"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { layoutGroups } from "@/lib/treemap";
import type { HeatItem } from "@/lib/tv-scanner";

type Scope = "spx" | "watchlist";
type Payload = { scope: Scope; asOf: number; items: HeatItem[] };

// Virtual canvas the treemap is laid out in; tiles are drawn as percentages of it, so any width works.
const W = 1000;
const H = 560;
const POLL_MS = 30_000;
const SCOPES: { key: Scope; label: string }[] = [
    { key: "spx", label: "S&P 500" },
    { key: "watchlist", label: "My watchlist" },
];

// Neutral grey at 0%, full theme red/green at ±3%.
const tint = (change: number) => {
    const pct = Math.round(Math.min(Math.abs(change) / 3, 1) * 100);
    return `color-mix(in oklab, var(${change >= 0 ? "--up" : "--down"}) ${pct}%, oklch(0.30 0.01 250))`;
};

const fmtChange = (c: number) => `${c > 0 ? "+" : ""}${c.toFixed(2)}%`;
const fmtSize = (n: number) => (n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);

export default function Heatmap() {
    const [scope, setScope] = useState<Scope>("spx");
    const [data, setData] = useState<Payload | null>(null);
    const [failed, setFailed] = useState(false);

    const load = useCallback(async (s: Scope) => {
        if (document.visibilityState !== "visible") return;
        try {
            const res = await fetch(`/api/heatmap?scope=${s}`);
            if (!res.ok) throw new Error(String(res.status));
            setData(await res.json());
            setFailed(false);
        } catch {
            setFailed(true); // keep whatever is on screen
        }
    }, []);

    useEffect(() => {
        setData(null);
        load(scope);
        const id = setInterval(() => load(scope), POLL_MS);
        const onVisible = () => load(scope);
        document.addEventListener("visibilitychange", onVisible);
        return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
    }, [scope, load]);

    const boxes = useMemo(() => {
        if (!data) return [];
        const byGroup = new Map<string, HeatItem[]>();
        for (const it of data.items) byGroup.set(it.group, [...(byGroup.get(it.group) ?? []), it]);
        return layoutGroups([...byGroup].map(([key, items]) => ({ key, items })), (i) => i.size, { w: W, h: H });
    }, [data]);

    const pctX = (v: number) => `${(v / W) * 100}%`;
    const pctY = (v: number) => `${(v / H) * 100}%`;
    const asOf = data ? new Date(data.asOf).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null;

    return (
        <div>
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <div role="group" aria-label="Heatmap scope" className="inline-flex items-center gap-1">
                    {SCOPES.map((s) => (
                        <button
                            key={s.key}
                            type="button"
                            onClick={() => setScope(s.key)}
                            aria-pressed={scope === s.key}
                            className={cn(
                                "rounded px-2 py-1 text-[12px] font-semibold transition-colors",
                                scope === s.key ? "bg-white/10 text-foreground" : "text-faint hover:text-foreground",
                            )}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
                <span className="text-[12px] text-faint">
                    {failed ? "Couldn’t refresh · retrying" : asOf ? `Delayed 15 min · updated ${asOf}` : "Loading…"}
                </span>
            </div>

            <div className="relative w-full overflow-hidden rounded-[10px] bg-page/60" style={{ aspectRatio: `${W} / ${H}`, containerType: "inline-size" }}>
                {!data && <div className="absolute inset-0 animate-pulse bg-white/[0.03]" />}
                {data && boxes.length === 0 && (
                    <div className="absolute inset-0 grid place-items-center text-[13px] text-faint">
                        {scope === "watchlist" ? "Add symbols to your watchlist to see them here" : "No data"}
                    </div>
                )}
                {boxes.map((g) => (
                    <div key={g.key}>
                        {g.headH > 0 && (
                            <div
                                className="absolute truncate px-1 font-bold uppercase tracking-wide text-muted-foreground"
                                style={{ left: pctX(g.rect.x + 1.5), top: pctY(g.rect.y + 1), width: pctX(g.rect.w - 3), height: pctY(g.headH), lineHeight: `${(g.headH / W) * 100}cqw`, fontSize: "max(8px, 1cqw)" }}
                            >
                                {g.key}
                            </div>
                        )}
                        {g.tiles.map(({ item, rect }) => {
                            const showTicker = rect.w > 30 && rect.h > 18;
                            const showChange = rect.w > 40 && rect.h > 32;
                            const fs = Math.min(Math.max(Math.sqrt(rect.w * rect.h) * 0.2, 7), 30);
                            return (
                                <Link
                                    key={item.symbol}
                                    href={`/stocks/${item.symbol}`}
                                    title={`${item.symbol} · ${item.name}\n${item.price.toLocaleString("en-US", { maximumFractionDigits: 2 })} · ${fmtChange(item.change)}\nSize ${fmtSize(item.size)}`}
                                    className="absolute flex flex-col items-center justify-center overflow-hidden text-white no-underline outline-1 -outline-offset-1 outline-black/40 hover:z-10 hover:outline-2 hover:outline-white/80"
                                    style={{ left: pctX(rect.x), top: pctY(rect.y), width: pctX(rect.w), height: pctY(rect.h), background: tint(item.change), fontSize: `max(6px, ${(fs / W) * 100}cqw)`, lineHeight: 1.15 }}
                                >
                                    {showTicker && <span className="font-bold">{item.symbol}</span>}
                                    {showChange && <span className="opacity-90" style={{ fontSize: "0.82em" }}>{fmtChange(item.change)}</span>}
                                </Link>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
