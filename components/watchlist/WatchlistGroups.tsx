import { Plus } from 'lucide-react';
import { getWatchlistData } from '@/lib/actions/finnhub.actions';
import { getExtendedQuotes, getSparklines } from '@/lib/actions/yahoo.actions';
import WatchlistTable from '@/components/watchlist/WatchlistTable';
import Panel from '@/components/Panel';
import { SearchButton } from '@/components/SearchCommand';
import { ChartRangeProvider } from '@/components/watchlist/ChartRange';
import { WATCHLIST_TAGS, UNTAGGED, TAG_BLURB, sortTags } from '@/lib/watchlist-tags';

type Item = { symbol: string; tags?: string[] };

// Quotes and the one-year charts are fetched once for the whole watchlist, in parallel, then split into group
// panels, so a symbol in both MAGS and SEMI is priced once and drawn twice. getSparklines never throws: if
// Yahoo is down the rows just show a dash where the chart would be.
export default async function WatchlistGroups({ items }: { items: Item[] }) {
    const symbols = items.map((i) => i.symbol);
    const [rows, sparks, extended] = await Promise.all([getWatchlistData(symbols), getSparklines(symbols), getExtendedQuotes(symbols)]);
    const tagsBySymbol = Object.fromEntries(items.map((i) => [i.symbol, sortTags(i.tags ?? [])]));

    const groups = [...WATCHLIST_TAGS, UNTAGGED]
        .map((tag) => ({
            tag,
            rows: rows.filter((r) =>
                tag === UNTAGGED ? !tagsBySymbol[r.symbol]?.length : tagsBySymbol[r.symbol]?.includes(tag)
            ),
        }))
        .filter((g) => g.rows.length > 0);

    // Empty watchlist, or nothing categorised yet: one flat table, same as before.
    if (groups.length <= 1) {
        return (
            <ChartRangeProvider>
                <Panel title="Symbols" sub="Click a row for charts, technicals and financials">
                    <WatchlistTable initialRows={rows} tagsBySymbol={tagsBySymbol} sparks={sparks} extended={extended} />
                </Panel>
            </ChartRangeProvider>
        );
    }

    return (
        <ChartRangeProvider>
            <div className="flex flex-col gap-3">
                {groups.map(({ tag, rows: groupRows }) => (
                    <Panel
                        key={tag}
                        title={tag}
                        sub={`${groupRows.length} ${groupRows.length === 1 ? 'symbol' : 'symbols'} · ${TAG_BLURB[tag] ?? ''}`}
                        action={<SearchButton add tag={tag === UNTAGGED ? undefined : tag} className="btn btn-ghost"><Plus /> Add</SearchButton>}
                    >
                        <WatchlistTable initialRows={groupRows} tagsBySymbol={tagsBySymbol} sparks={sparks} extended={extended} emptyLabel="No symbols in this category" />
                    </Panel>
                ))}
            </div>
        </ChartRangeProvider>
    );
}
