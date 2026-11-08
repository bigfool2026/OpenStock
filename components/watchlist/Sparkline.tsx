import { sparklinePoints, sparklineTrend } from "@/lib/sparkline";

// A year of closes as a line, green when the year ended above where it began and red when below. Plain SVG, no
// client JS, so a watchlist of fifty draws fifty of these for free. Direction is also in the label, not just the colour.
export default function Sparkline({ values, width = 132, height = 36 }: { values?: number[]; width?: number; height?: number }) {
    const points = values ? sparklinePoints(values, width, height) : [];
    const trend = values ? sparklineTrend(values) : null;
    if (points.length === 0 || !trend) return <span className="text-faint" aria-label="No chart available">—</span>;

    const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const [endX, endY] = points[points.length - 1];
    const area = `${d}L${endX.toFixed(1)},${height}L${points[0][0].toFixed(1)},${height}Z`;
    const color = trend.up ? 'var(--up)' : 'var(--down)';
    const label = `1 year: ${trend.change >= 0 ? '+' : ''}${trend.change.toFixed(1)}%`;

    return (
        <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block">
            <title>{label}</title>
            <path d={area} fill={color} opacity={0.12} />
            <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={endX} cy={endY} r={2} fill={color} />
        </svg>
    );
}
