import { sparklineLevelY, sparklinePoints, sparklineTrend } from "@/lib/sparkline";

// A run of closes as a line, green when it ended above where it began and red when below. Plain SVG, no
// client JS, so a watchlist of fifty draws fifty of these for free. Direction is also in the label, not just the colour.
// `baseline` (the previous close, on a 1D chart) is drawn as a dashed line and is what the colour and the % are measured against.
export default function Sparkline({ values, label = '1 year', width = 132, height = 36, baseline }: { values?: number[]; label?: string; width?: number; height?: number; baseline?: number }) {
    const points = values ? sparklinePoints(values, width, height, 2, baseline) : [];
    const trend = values ? sparklineTrend(values, baseline) : null;
    if (points.length === 0 || !trend) return <span className="text-faint" aria-label="No chart available">—</span>;

    const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const [endX, endY] = points[points.length - 1];
    const area = `${d}L${endX.toFixed(1)},${height}L${points[0][0].toFixed(1)},${height}Z`;
    const color = trend.up ? 'var(--up)' : 'var(--down)';
    const summary = `${label}: ${trend.change >= 0 ? '+' : ''}${trend.change.toFixed(1)}%${baseline ? ' vs previous close' : ''}`;
    const baseY = baseline && values ? sparklineLevelY(baseline, values, height) : null;

    return (
        <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block">
            <title>{summary}</title>
            {baseY !== null && <line x1={0} x2={width} y1={baseY} y2={baseY} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" strokeWidth={1} className="text-faint" />}
            <path d={area} fill={color} opacity={0.12} />
            <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={endX} cy={endY} r={2} fill={color} />
        </svg>
    );
}
