import { describe, expect, it } from 'vitest';
import { layoutGroups, squarify, type Rect } from '@/lib/treemap';
import { parseScannerRows, spxQuery, symbolsQuery } from '@/lib/tv-scanner';

const area = (r: Rect) => r.w * r.h;
const overlap = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6;

describe('squarify', () => {
    const values = [60, 30, 20, 15, 10, 8, 5, 3, 2, 1];
    const rect = { x: 0, y: 0, w: 1000, h: 560 };

    it('tiles the rectangle exactly, in proportion to value', () => {
        const out = squarify(values, rect);
        const total = values.reduce((s, v) => s + v, 0);
        expect(out.reduce((s, r) => s + area(r), 0)).toBeCloseTo(area(rect), 3);
        out.forEach((r, i) => expect(area(r) / area(rect)).toBeCloseTo(values[i] / total, 6));
    });

    it('keeps every tile inside the rectangle and tiles apart', () => {
        const out = squarify(values, rect);
        for (const r of out) {
            expect(r.x).toBeGreaterThanOrEqual(-1e-9);
            expect(r.y).toBeGreaterThanOrEqual(-1e-9);
            expect(r.x + r.w).toBeLessThanOrEqual(rect.w + 1e-6);
            expect(r.y + r.h).toBeLessThanOrEqual(rect.h + 1e-6);
        }
        for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(overlap(out[i], out[j])).toBe(false);
    });

    it('keeps tiles reasonably square', () => {
        const out = squarify(values, rect);
        const worst = Math.max(...out.map((r) => Math.max(r.w / r.h, r.h / r.w)));
        expect(worst).toBeLessThan(6);
    });

    it('handles empty input and an empty rectangle', () => {
        expect(squarify([], rect)).toEqual([]);
        expect(squarify([1, 2], { x: 0, y: 0, w: 0, h: 10 })).toHaveLength(2);
    });
});

describe('layoutGroups', () => {
    type It = { id: string; size: number };
    const groups = [
        { key: 'Tech', items: [{ id: 'A', size: 50 }, { id: 'B', size: 30 }, { id: 'C', size: 0 }] as It[] },
        { key: 'Energy', items: [{ id: 'D', size: 15 }, { id: 'E', size: 5 }] as It[] },
        { key: 'Empty', items: [{ id: 'F', size: -1 }] as It[] },
    ];

    it('drops empty groups and non-positive items, biggest group first', () => {
        const boxes = layoutGroups(groups, (i) => i.size, { w: 1000, h: 560 });
        expect(boxes.map((b) => b.key)).toEqual(['Tech', 'Energy']);
        expect(boxes[0].tiles.map((t) => t.item.id)).toEqual(['A', 'B']);
    });

    it('sizes group boxes by their totals and keeps tiles inside their box', () => {
        const boxes = layoutGroups(groups, (i) => i.size, { w: 1000, h: 560 });
        expect(area(boxes[0].rect) / area(boxes[1].rect)).toBeCloseTo(80 / 20, 5);
        for (const b of boxes) {
            for (const { rect } of b.tiles) {
                expect(rect.x).toBeGreaterThanOrEqual(b.rect.x - 1e-6);
                expect(rect.y).toBeGreaterThanOrEqual(b.rect.y + b.headH - 1e-6);
                expect(rect.x + rect.w).toBeLessThanOrEqual(b.rect.x + b.rect.w + 1e-6);
                expect(rect.y + rect.h).toBeLessThanOrEqual(b.rect.y + b.rect.h + 1e-6);
            }
        }
    });
});

describe('parseScannerRows', () => {
    // columns: name, description, close, change, market_cap_basic, sector, aum, type
    const row = (d: unknown[]) => ({ s: 'X:' + d[0], d });
    const json = {
        data: [
            row(['AAPL', 'Apple Inc.', 350, 2.2, 5.0e12, 'Electronic Technology', null, 'stock']),
            row(['XLE', 'Energy Select Sector SPDR', 62, 0.9, null, 'Miscellaneous', 4.0e10, 'fund']),
            row(['NOCAP', 'No size', 10, 1, null, 'Finance', null, 'stock']),
            row(['NOCHG', 'No change', 10, null, 1e9, 'Finance', null, 'stock']),
            row(['ZERO', 'No price', 0, 1, 1e9, 'Finance', null, 'stock']),
            row(['AAPL', 'Apple (other listing)', 349, 2.1, 1.0e9, 'Electronic Technology', null, 'stock']),
        ],
    };

    it('reads stocks by market cap and funds by assets, grouped by sector', () => {
        const items = parseScannerRows(json);
        const bySymbol = Object.fromEntries(items.map((i) => [i.symbol, i]));
        expect(bySymbol.AAPL).toMatchObject({ name: 'Apple Inc.', group: 'Electronic Technology', size: 5.0e12, change: 2.2, price: 350 });
        expect(bySymbol.XLE).toMatchObject({ size: 4.0e10, group: 'Miscellaneous' });
    });

    it('drops rows with no usable size, price or change, and keeps the larger duplicate', () => {
        const items = parseScannerRows(json);
        expect(items.map((i) => i.symbol).sort()).toEqual(['AAPL', 'XLE']);
        expect(items.find((i) => i.symbol === 'AAPL')!.price).toBe(350);
    });

    it('lets the caller choose the group', () => {
        const items = parseScannerRows(json, (s) => (s === 'XLE' ? 'ETF' : 'Other'));
        expect(items.find((i) => i.symbol === 'XLE')!.group).toBe('ETF');
    });

    it('survives garbage', () => {
        expect(parseScannerRows(null)).toEqual([]);
        expect(parseScannerRows({ data: [{ d: 'x' }] })).toEqual([]);
    });
});

describe('scanner queries', () => {
    it('asks for the S&P 500 by index membership', () => {
        expect(spxQuery().symbols.groups[0]).toEqual({ type: 'index', values: ['SP:SPX'] });
    });
    it('asks for symbols by name, US markets only, with room for duplicates', () => {
        const q = symbolsQuery(['AAPL', 'BRK.B']);
        expect(q.filter[0]).toEqual({ left: 'name', operation: 'in_range', right: ['AAPL', 'BRK.B'] });
        expect(q.markets).toEqual(['america']);
        expect(q.range[1]).toBeGreaterThanOrEqual(4);
    });
});
