// TradingView's public market scanner (https://scanner.tradingview.com), the same feed its own screeners use. Quotes
// there are 15-minute delayed streaming for US stocks. Pure helpers only; the network call is in lib/tv-heatmap.ts.

export type HeatItem = {
    symbol: string;
    name: string;
    group: string;
    size: number; // market cap for stocks, assets under management for funds
    change: number; // % today
    price: number;
};

// Order matters: parseScannerRows reads columns by position.
export const SCANNER_COLUMNS = ['name', 'description', 'close', 'change', 'market_cap_basic', 'sector', 'aum', 'type'] as const;

const SORT = { sortBy: 'market_cap_basic', sortOrder: 'desc' } as const;

// The S&P 500 (~503 listings), by index membership.
export const spxQuery = () => ({
    symbols: { query: { types: [] }, tickers: [], groups: [{ type: 'index', values: ['SP:SPX'] }] },
    columns: SCANNER_COLUMNS,
    sort: SORT,
    range: [0, 600],
});

// Specific US symbols by name: BRK.B, XLE, AAPL.
export const symbolsQuery = (symbols: string[]) => ({
    filter: [
        { left: 'name', operation: 'in_range', right: symbols },
        { left: 'type', operation: 'in_range', right: ['stock', 'fund', 'dr'] },
    ],
    markets: ['america'],
    columns: SCANNER_COLUMNS,
    sort: SORT,
    range: [0, Math.max(50, symbols.length * 2)],
});

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Rows -> items. `groupOf` decides the group per symbol (default: the row's sector). A row without a usable size, price
// or change is dropped rather than drawn as a zero. The same symbol listed twice keeps its larger entry.
export function parseScannerRows(json: unknown, groupOf?: (symbol: string, sector: string) => string): HeatItem[] {
    const rows = (json as { data?: Array<{ d?: unknown[] }> })?.data ?? [];
    const best = new Map<string, HeatItem>();
    for (const r of rows) {
        const d = r.d ?? [];
        const symbol = typeof d[0] === 'string' ? d[0] : '';
        const price = num(d[2]);
        const change = num(d[3]);
        const size = num(d[4]) ?? num(d[6]);
        if (!symbol || !price || change === null || !size || size <= 0) continue;
        const sector = typeof d[5] === 'string' && d[5] ? d[5] : 'Other';
        const item: HeatItem = { symbol, name: typeof d[1] === 'string' ? d[1] : symbol, group: groupOf ? groupOf(symbol, sector) : sector, size, change, price };
        const prev = best.get(symbol);
        if (!prev || item.size > prev.size) best.set(symbol, item);
    }
    return [...best.values()];
}
