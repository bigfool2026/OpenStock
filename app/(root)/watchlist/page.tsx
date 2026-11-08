import { Suspense } from 'react';
import { Plus } from 'lucide-react';
import { getUserWatchlist } from '@/lib/actions/watchlist.actions';
import { getUserAlerts } from '@/lib/actions/alert.actions';
import { getNews } from '@/lib/actions/finnhub.actions';
import WatchlistGroups from '@/components/watchlist/WatchlistGroups';
import AlertsPanel from '@/components/watchlist/AlertsPanel';
import NewsList from '@/components/watchlist/NewsList';
import Panel from '@/components/Panel';
import DataFreshness from '@/components/DataFreshness';
import { SearchButton } from '@/components/SearchCommand';

const RowsSkeleton = ({ rows = 4 }: { rows?: number }) => (
    <div className="row-list" aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-3.5">
                <span className="size-8 animate-pulse rounded-full bg-hover" />
                <span className="h-3.5 flex-1 animate-pulse rounded-md bg-hover" />
                <span className="h-3.5 w-20 animate-pulse rounded-md bg-hover" />
            </div>
        ))}
    </div>
);

async function News({ symbols }: { symbols: string[] }) {
    return <NewsList news={await getNews(symbols).catch(() => [] as MarketNewsArticle[])} />;
}

// DB reads render first; everything from Finnhub and Yahoo streams in behind skeletons.
// One full-width column: alerts as a slim strip on top, then the symbol tables, then news.
export default async function WatchlistPage() {
    const [items, alerts] = await Promise.all([getUserWatchlist(), getUserAlerts()]);
    const symbols: string[] = items.map((item: { symbol: string }) => item.symbol);

    return (
        <>
            <header className="page-head">
                <div>
                    <h1 className="page-title">Watchlist</h1>
                    <p className="page-sub num flex flex-wrap items-center gap-x-2">
                        {symbols.length} {symbols.length === 1 ? 'symbol' : 'symbols'} <span aria-hidden>·</span> <DataFreshness />
                    </p>
                </div>
                <SearchButton className="btn btn-primary"><Plus /> Add symbol</SearchButton>
            </header>

            <div className="flex min-w-0 flex-col gap-3">
                <Panel bodyClassName="px-3.5 py-3">
                    <AlertsPanel alerts={alerts} />
                </Panel>

                <Suspense fallback={
                    <Panel title="Symbols" sub="Click a row for charts, technicals and financials">
                        <RowsSkeleton rows={Math.max(1, Math.min(symbols.length, 6))} />
                    </Panel>
                }>
                    <WatchlistGroups items={items} />
                </Suspense>

                <Panel title="News" sub={symbols.length ? 'Latest stories for the symbols you watch' : 'General market news'}>
                    <Suspense fallback={<RowsSkeleton />}>
                        <News symbols={symbols} />
                    </Suspense>
                </Panel>
            </div>
        </>
    );
}
