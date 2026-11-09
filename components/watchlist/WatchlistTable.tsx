"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Search, Star } from "lucide-react";
import CreateAlertModal from "./CreateAlertModal";
import WatchlistButton from "@/components/WatchlistButton";
import TagPicker from "./TagPicker";
import Sparkline from "./Sparkline";
import { RangeToggle, useChartRange } from "./ChartRange";
import { sliceSpark, type Spark } from "@/lib/sparkline";
import type { ExtendedQuote } from "@/lib/yahoo";
import ChangePill from "@/components/ChangePill";
import PriceFlash from "@/components/PriceFlash";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { SearchButton } from "@/components/SearchCommand";
import { formatNumber, formatPrice } from "@/lib/utils";
import { hasFinnhubQuotes } from "@/lib/markets";
import type { getWatchlistData } from "@/lib/actions/finnhub.actions";

type Row = Awaited<ReturnType<typeof getWatchlistData>>[number];
const SUGGESTIONS = ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'AMZN'];

export default function WatchlistTable({
    initialRows,
    tagsBySymbol = {},
    sparks = {},
    extended = {},
    emptyLabel,
}: {
    initialRows: Row[];
    tagsBySymbol?: Record<string, string[]>;
    sparks?: Record<string, Spark>; // a year of daily closes per symbol; the chosen range is cut from it here
    extended?: Record<string, ExtendedQuote>; // pre-market / after-hours print per symbol, when the latest print is outside the regular session
    emptyLabel?: string;
}) {
    const [baseRows, setBaseRows] = useState(initialRows);
    const live = useLiveQuotes(baseRows.map((r) => r.symbol));
    const { months, long } = useChartRange();

    // Server re-renders (after add/remove) replace the local copy
    useEffect(() => setBaseRows(initialRows), [initialRows]);

    const rows = baseRows.map((r) => {
        const q = live[r.symbol];
        return q?.c ? { ...r, price: q.c, change: q.d ?? r.change, changePercent: q.dp ?? r.changePercent } : r;
    });

    if (rows.length === 0 && emptyLabel) {
        return <div className="px-3.5 py-6 text-center text-[13px] text-faint">{emptyLabel}</div>;
    }

    if (rows.length === 0) {
        return (
            <div className="empty-state">
                <span className="empty-icon"><Star className="size-5" /></span>
                <h3>Nothing on your watchlist yet</h3>
                <p className="max-w-sm">Search for a company and star it to track its price here and set alerts.</p>
                <SearchButton className="btn btn-primary mt-3"><Search /> Search stocks</SearchButton>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                    {SUGGESTIONS.map((s) => (
                        <Link key={s} href={`/stocks/${s}`} className="pill mono h-7 px-3 hover:bg-hover hover:text-foreground">{s}</Link>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto rounded-[14px]">
            {/* Fixed column widths so Price, Today and the rest line up from one group panel to the next; the
                company column takes whatever is left, and min-width keeps it from being squeezed out on narrow screens */}
            <table className="data-table table-fixed min-w-[1184px]">
                <colgroup>
                    <col />
                    <col style={{ width: 252 }} />
                    <col style={{ width: 172 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 140 }} />
                </colgroup>
                <thead>
                    <tr>
                        <th>Company</th>
                        <th><RangeToggle /></th>
                        <th className="is-num">Price</th>
                        <th className="is-num">Today</th>
                        <th className="is-num">Change</th>
                        <th className="is-num">Market cap</th>
                        <th className="w-[88px]"><span className="sr-only">Actions</span></th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => (
                        <tr key={row.symbol}>
                            <td className="max-w-[320px]">
                                <Link href={`/stocks/${row.symbol}`} className="group flex items-center gap-3">
                                    {row.logo ? (
                                        <span className="logo-well"><img src={row.logo} alt="" className="size-full object-contain p-1" /></span>
                                    ) : (
                                        <span className="logo-well is-empty">{row.symbol[0]}</span>
                                    )}
                                    <span className="min-w-0">
                                        <span className="block truncate font-semibold text-foreground group-hover:text-brand-ink transition-colors" title={row.name}>{row.name}</span>
                                        <span className="mono block text-[12px] text-faint">{row.symbol}</span>
                                    </span>
                                </Link>
                            </td>
                            <td><Sparkline values={sliceSpark(sparks[row.symbol], months)} label={long} width={216} height={40} /></td>
                            <td className="is-num font-semibold text-foreground">
                                <PriceFlash value={row.price} className="px-1">{row.price ? formatPrice(row.price, row.currency) : '—'}</PriceFlash>
                                <ExtendedLine quote={extended[row.symbol]} currency={row.currency} />
                            </td>
                            <td className="is-num"><ChangePill value={row.price ? row.changePercent : null} /></td>
                            <td className="is-num text-muted-foreground">{row.price ? `${row.change > 0 ? '+' : ''}${row.change.toFixed(2)}` : '—'}</td>
                            <td className="is-num text-muted-foreground">{row.marketCap ? formatNumber(row.marketCap) : '—'}</td>
                            <td>
                                <div className="flex items-center justify-end gap-1">
                                    {hasFinnhubQuotes(row.symbol) ? (
                                        <CreateAlertModal symbol={row.symbol} currentPrice={row.price} currency={row.currency}>
                                            <button type="button" className="icon-btn" title={`Set a price alert for ${row.symbol}`} aria-label={`Set a price alert for ${row.symbol}`}>
                                                <Bell />
                                            </button>
                                        </CreateAlertModal>
                                    ) : (
                                        <span className="icon-btn opacity-40" title="Alerts are available for US stocks and crypto"><Bell /></span>
                                    )}
                                    <TagPicker symbol={row.symbol} tags={tagsBySymbol[row.symbol] ?? []} />
                                    <WatchlistButton
                                        symbol={row.symbol}
                                        company={row.name}
                                        isInWatchlist
                                        variant="icon"
                                        onWatchlistChange={(sym, added) => {
                                            if (!added) setBaseRows((current) => current.filter((r) => r.symbol !== sym));
                                        }}
                                    />
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

const EXTENDED_LABEL = { pre: 'Pre-market', post: 'After hours' } as const;

// "After hours $188.08 +0.5%" under the regular price; the tooltip says when that print happened.
function ExtendedLine({ quote, currency }: { quote?: ExtendedQuote; currency?: string }) {
    if (!quote) return null;
    const at = new Date(quote.t * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
    const up = quote.change >= 0;
    return (
        <span className="mt-0.5 block whitespace-nowrap px-1 text-[11px] font-normal text-faint" title={`${EXTENDED_LABEL[quote.session]} · last trade ${at} ET`}>
            {EXTENDED_LABEL[quote.session]} {formatPrice(quote.price, currency)}{' '}
            <span className={up ? 'text-up' : 'text-down'}>{up ? '+' : ''}{quote.changePercent.toFixed(2)}%</span>
        </span>
    );
}
