import { parseScannerRows, spxQuery, symbolsQuery, type HeatItem } from '@/lib/tv-scanner';

// Network side of the heatmap: one scanner request per scope, shared by every viewer for 30s (the feed itself is
// 15 minutes delayed, so polling faster would buy nothing). A failed refresh keeps serving the last good answer.
const URL = 'https://scanner.tradingview.com/america/scan';
const TTL_MS = 30_000;
const TIMEOUT_MS = 8_000;

type Entry = { items: HeatItem[]; asOf: number };
const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Entry>>();

async function post(body: unknown, groupOf?: (symbol: string, sector: string) => string): Promise<HeatItem[]> {
    const res = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://www.tradingview.com', 'User-Agent': 'Mozilla/5.0' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(`TradingView scanner HTTP ${res.status}`);
    return parseScannerRows(await res.json(), groupOf);
}

async function cached(key: string, load: () => Promise<HeatItem[]>): Promise<Entry | null> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.asOf < TTL_MS) return hit;
    let pending = inFlight.get(key);
    if (!pending) {
        pending = load()
            .then((items) => {
                const entry = { items, asOf: Date.now() };
                if (items.length > 0) cache.set(key, entry);
                return entry;
            })
            .finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
    }
    try {
        return await pending;
    } catch (e) {
        console.error('Heatmap scanner error', e instanceof Error ? e.message : e);
        return hit ?? null;
    }
}

export const getSpxHeat = () => cached('spx', () => post(spxQuery()));

// `groupOf` maps a symbol to its category (the user's watchlist tag), so one request serves any grouping.
export function getSymbolsHeat(symbols: string[], groupOf: (symbol: string) => string) {
    const key = `sym:${[...symbols].sort().join(',')}`;
    return cached(key, () => post(symbolsQuery(symbols), (s) => groupOf(s)));
}
