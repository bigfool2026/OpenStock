import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TAG_BLURB, UNTAGGED, WATCHLIST_TAGS, normalizeTag, sortTags } from '@/lib/watchlist-tags';

describe('watchlist categories', () => {
    it('matches a category in any case and rejects anything else', () => {
        expect(normalizeTag('semi')).toBe('SEMI');
        expect(normalizeTag('  INDEX ')).toBe('Index');
        expect(normalizeTag('saas')).toBe('SaaS');
        expect(normalizeTag('nope')).toBeNull();
        expect(normalizeTag(UNTAGGED)).toBeNull(); // Ungrouped is where untagged symbols land, not a category to pick
    });

    it('sorts tags into catalogue order and drops unknown ones', () => {
        expect(sortTags(['Index', 'SEMI', 'bogus', 'MAGS'])).toEqual(['MAGS', 'SEMI', 'Index']);
    });

    it('has a description for every category and for Ungrouped', () => {
        for (const tag of [...WATCHLIST_TAGS, UNTAGGED]) expect(TAG_BLURB[tag], tag).toBeTruthy();
    });

    it('has no duplicates', () => {
        expect(new Set(WATCHLIST_TAGS).size).toBe(WATCHLIST_TAGS.length);
    });
});

// scripts/add-watchlist.mjs is plain JavaScript and can't import this TypeScript, so it carries its own list.
// If the two drift, the script silently refuses a category the app accepts (or the reverse).
describe('scripts/add-watchlist.mjs', () => {
    it('knows exactly the categories the app does, in the same order', () => {
        const source = readFileSync(new URL('../scripts/add-watchlist.mjs', import.meta.url), 'utf8');
        const match = /const TAGS = \[([^\]]*)\]/.exec(source);
        expect(match, 'could not find the TAGS list in the script').not.toBeNull();
        const inScript = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
        expect(inScript).toEqual([...WATCHLIST_TAGS]);
    });
});
