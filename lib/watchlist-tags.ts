// Watchlist categories. Client-safe: imported by both server actions and client components.
// scripts/add-watchlist.mjs keeps its own copy of this list (it can't import TypeScript); a test keeps the two equal.
export const WATCHLIST_TAGS = ['MAGS', 'SEMI', 'SaaS', 'Bonds', 'Commodity', 'Crypto', 'Index'] as const;

export type WatchlistTag = (typeof WATCHLIST_TAGS)[number];

export const UNTAGGED = 'Ungrouped';

// What each group is for, shown under the panel heading.
export const TAG_BLURB: Record<string, string> = {
    MAGS: 'Mega caps above a trillion',
    SEMI: 'Semiconductors and equipment',
    SaaS: 'Software and subscription models',
    Bonds: 'Treasuries, credit and duration',
    Commodity: 'Energy, metals and agriculture',
    Crypto: 'Digital assets and proxies',
    Index: 'Broad market index funds',
    [UNTAGGED]: 'Not in a category yet',
};

// Case-insensitive match against the catalog, so "semi" and "SEMI" are one tag.
export function normalizeTag(value: string): WatchlistTag | null {
    const want = String(value ?? '').trim().toLowerCase();
    return WATCHLIST_TAGS.find((t) => t.toLowerCase() === want) ?? null;
}

// Keeps catalog order regardless of the order tags were added in.
export function sortTags(tags: string[]): string[] {
    return WATCHLIST_TAGS.filter((t) => tags.includes(t));
}
