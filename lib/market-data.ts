// How fresh market numbers are. Safe to import from client components (no keys here).
//
//   cached   (default) Public instance: quotes refresh hourly, shared by every user via the data cache.
//   realtime           OpenStock Cloud or self-hosted with your own Finnhub keys: quotes refresh every 15s.
export type DataMode = 'cached' | 'realtime';

export const DATA_MODE: DataMode = process.env.NEXT_PUBLIC_OPENSTOCK_DATA_MODE === 'realtime' ? 'realtime' : 'cached';

export const QUOTE_TTL_SECONDS = DATA_MODE === 'realtime' ? 15 : 3600;

export const isRealtime = DATA_MODE === 'realtime';

// How often an open tab asks for fresh prices in realtime mode. 15s suits Finnhub's free quota; with a Schwab feed
// (lib/schwab.ts) 2s is fine, because one batch call covers the whole watchlist. Fixed at build time like the mode.
const pollMs = Number(process.env.NEXT_PUBLIC_OPENSTOCK_POLL_MS);
export const QUOTE_POLL_MS = Number.isFinite(pollMs) && pollMs >= 1000 ? pollMs : 15_000;

// Email price alerts are an OpenStock Cloud feature: on in realtime mode (Cloud or self-hosted), off on the free hourly site.
export const alertsEnabled = isRealtime;
