import { describe, expect, it } from 'vitest';
import { sparklinePoints, sparklineTrend } from '@/lib/sparkline';

describe('sparklinePoints', () => {
    it('puts the low at the bottom and the high at the top, inside the padding', () => {
        const pts = sparklinePoints([10, 20, 15], 100, 40, 2);
        expect(pts[0]).toEqual([2, 38]); // lowest value, bottom edge
        expect(pts[1]).toEqual([50, 2]); // highest value, top edge
        expect(pts[2][1]).toBeCloseTo(20, 10); // halfway between
    });
    it('spans the full padded width, first point to last', () => {
        const pts = sparklinePoints([1, 2, 3, 4, 5], 100, 40, 2);
        expect(pts[0][0]).toBe(2);
        expect(pts.at(-1)![0]).toBe(98);
    });
    it('draws a flat series on the midline instead of dividing by zero', () => {
        const pts = sparklinePoints([7, 7, 7], 100, 40);
        expect(pts.every(([, y]) => y === 20)).toBe(true);
        expect(pts.flat().every(Number.isFinite)).toBe(true);
    });
    it('returns nothing when there is no line to draw', () => {
        expect(sparklinePoints([], 100, 40)).toEqual([]);
        expect(sparklinePoints([5], 100, 40)).toEqual([]);
    });
});

describe('sparklineTrend', () => {
    it('reports the first-to-last move and its direction', () => {
        expect(sparklineTrend([100, 150])).toEqual({ change: 50, up: true });
        expect(sparklineTrend([200, 150])?.change).toBeCloseTo(-25, 10);
        expect(sparklineTrend([200, 150])?.up).toBe(false);
    });
    it('treats no move as up, so a flat line is not painted red', () => {
        expect(sparklineTrend([5, 9, 5])).toEqual({ change: 0, up: true });
    });
    it('has no trend without a usable baseline', () => {
        expect(sparklineTrend([1])).toBeNull();
        expect(sparklineTrend([0, 5])).toBeNull();
    });
});
