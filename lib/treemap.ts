// Squarified treemap (Bruls, Huijsmans, van Wijk): rectangles of area proportional to value, kept close to square so
// labels fit. Pure and unit-tested; the heatmap component only draws what this returns.

export type Rect = { x: number; y: number; w: number; h: number };

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

// Worst aspect ratio in a row of areas laid along a side of this length (lower is squarer)
function worst(row: number[], side: number) {
    const s = sum(row);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
}

// Rects for `values` (must be positive, sorted descending), in the same order, tiling `rect` exactly.
export function squarify(values: number[], rect: Rect): Rect[] {
    if (values.length === 0 || rect.w <= 0 || rect.h <= 0) return values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
    const scale = (rect.w * rect.h) / sum(values);
    const areas = values.map((v) => v * scale);
    const out: Rect[] = [];
    let { x, y, w, h } = rect;
    let i = 0;
    while (i < areas.length) {
        const side = Math.min(w, h);
        const row = [areas[i]];
        let j = i + 1;
        while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) row.push(areas[j++]);
        const rowSum = sum(row);
        if (w >= h) {
            // A column down the left edge
            const colW = rowSum / h;
            let cy = y;
            for (const a of row) { const ch = a / colW; out.push({ x, y: cy, w: colW, h: ch }); cy += ch; }
            x += colW; w -= colW;
        } else {
            // A row along the top edge
            const rowH = rowSum / w;
            let cx = x;
            for (const a of row) { const cw = a / rowH; out.push({ x: cx, y, w: cw, h: rowH }); cx += cw; }
            y += rowH; h -= rowH;
        }
        i = j;
    }
    return out;
}

export type Tile<T> = { item: T; rect: Rect };
export type GroupBox<T> = { key: string; rect: Rect; headH: number; tiles: Tile<T>[] };

// Two levels: groups tile the whole area by their total size, then each group's items tile what is left below its
// label strip. Items with no positive size are dropped. `pad` is the gap kept inside every group box.
export function layoutGroups<T>(
    groups: { key: string; items: T[] }[],
    size: (item: T) => number,
    area: { w: number; h: number },
    { pad = 1.5, head = 15 }: { pad?: number; head?: number } = {},
): GroupBox<T>[] {
    const sized = groups
        .map((g) => {
            const items = g.items.filter((it) => size(it) > 0).sort((a, b) => size(b) - size(a));
            return { key: g.key, items, total: sum(items.map(size)) };
        })
        .filter((g) => g.items.length > 0)
        .sort((a, b) => b.total - a.total);
    const boxes = squarify(sized.map((g) => g.total), { x: 0, y: 0, ...area });
    return sized.map((g, i) => {
        const rect = boxes[i];
        const headH = rect.h > head * 2.2 && rect.w > 50 ? head : 0;
        const inner: Rect = { x: rect.x + pad, y: rect.y + pad + headH, w: Math.max(0, rect.w - pad * 2), h: Math.max(0, rect.h - pad * 2 - headH) };
        const rects = squarify(g.items.map(size), inner);
        return { key: g.key, rect, headH, tiles: g.items.map((item, k) => ({ item, rect: rects[k] })) };
    });
}
