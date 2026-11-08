import { Suspense } from "react";
import Link from "next/link";
import { CandlestickChart } from "lucide-react";
import TradingViewWidget from "@/components/TradingViewWidget";
import StockHeader, { StockHeaderSkeleton } from "@/components/stocks/StockHeader";
import StockSentimentCard from "@/components/stocks/StockSentimentCard";
import StockChart from "@/components/stocks/StockChart";
import ColorChart from "@/components/stocks/ColorChart";
import { getDailyCandles } from "@/lib/actions/yahoo.actions";
import Panel from "@/components/Panel";
import {
    TECHNICAL_ANALYSIS_WIDGET_CONFIG,
    COMPANY_PROFILE_WIDGET_CONFIG,
    COMPANY_FINANCIALS_WIDGET_CONFIG,
} from "@/lib/constants";
import { getStockSentimentInsights } from '@/lib/actions/adanos.actions';
import { getStockMetrics } from '@/lib/actions/finnhub.actions';
import { formatSymbolForTradingView, isChartEmbeddable, tradingViewSymbolUrl } from '@/lib/utils';

const scriptUrl = `https://s3.tradingview.com/external-embedding/embed-widget-`;

async function Sentiment({ symbol }: { symbol: string }) {
    const insight = await getStockSentimentInsights(symbol);
    if (!insight) return null;
    return (
        <Panel title="Sentiment" sub="Reddit, X.com, news and Polymarket">
            <StockSentimentCard insight={insight} />
        </Panel>
    );
}

async function DividendYield({ symbol }: { symbol: string }) {
    const dividendYield = await getStockMetrics(symbol);
    return (
        <Panel title="Dividend Yield">
            <p className="text-2xl font-semibold text-white">
                {dividendYield !== null ? `${dividendYield.toFixed(2)}%` : "—"}
            </p>
        </Panel>
    );
}

// Daily candles from Yahoo get the native chart, where the averages keep our colours. A symbol Yahoo can't price
// (or ?chart=tv) gets the TradingView embed, so nothing that had a chart loses it.
async function ChartPanel({ symbol, tvSymbol, preferTradingView }: { symbol: string; tvSymbol: string; preferTradingView: boolean }) {
    const candles = await getDailyCandles(symbol);
    const native = candles.length > 0;
    if (native && !preferTradingView) return <ColorChart candles={candles} />;

    const switchLink = native ? (
        <Link href="?" scroll={false} className="btn btn-ghost h-8 px-2.5 text-[13px]">Colour chart</Link>
    ) : undefined;

    return isChartEmbeddable(tvSymbol) ? (
        <StockChart tvSymbol={tvSymbol} scriptUrl={`${scriptUrl}advanced-chart.js`} switchLink={switchLink} />
    ) : (
        // TradingView refuses this exchange's chart in embeds; say so instead of showing its error
        <Panel title="Chart" sub="Only on TradingView for this exchange">
            <div className="empty-state py-14">
                <span className="empty-icon"><CandlestickChart className="size-5" /></span>
                <h3>Chart not available here</h3>
                <p className="max-w-80 text-[13px]">
                    TradingView doesn’t license {tvSymbol.split(':')[0]} charts for other sites. Financials, technicals and the profile below still work.
                </p>
                <a href={tradingViewSymbolUrl(tvSymbol)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost mt-2">
                    Open chart on TradingView
                </a>
            </div>
        </Panel>
    );
}

// The price chart streams in behind its own Suspense and the other panels come straight from TradingView (live, no
// quota); only the header waits on Finnhub, and it streams.
export default async function StockDetails({ params, searchParams }: StockDetailsPageProps) {
    const { symbol: rawSymbol } = await params;
    const { chart } = (await searchParams) ?? {};
    const symbol = decodeURIComponent(rawSymbol).toUpperCase();
    const tvSymbol = formatSymbolForTradingView(symbol);

    return (
        <>
            <Suspense fallback={<StockHeaderSkeleton />}>
                <StockHeader symbol={symbol} />
            </Suspense>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
                <div className="flex min-w-0 flex-col gap-3">
                    <Suspense fallback={<Panel title="Chart" sub="Loading prices"><div className="tv-frame" style={{ height: 760 }} /></Panel>}>
                        <ChartPanel symbol={symbol} tvSymbol={tvSymbol} preferTradingView={chart === 'tv'} />
                    </Suspense>
                    <Panel title="Financials" sub="Income statement, balance sheet and ratios">
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}financials.js`}
                            config={COMPANY_FINANCIALS_WIDGET_CONFIG(tvSymbol)}
                            height={500}
                        />
                    </Panel>
                </div>

                <div className="flex min-w-0 flex-col gap-3">
                    <Panel title="Technicals" sub="Oscillators and moving averages, 1h">
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}technical-analysis.js`}
                            config={TECHNICAL_ANALYSIS_WIDGET_CONFIG(tvSymbol)}
                            height={400}
                        />
                    </Panel>
                    <Suspense fallback={null}>
                        <DividendYield symbol={symbol} />
                    </Suspense>
                    <Suspense fallback={null}>
                        <Sentiment symbol={symbol} />
                    </Suspense>
                    <Panel title="Profile" sub="What the company does">
                        <TradingViewWidget
                            scriptUrl={`${scriptUrl}symbol-profile.js`}
                            config={COMPANY_PROFILE_WIDGET_CONFIG(tvSymbol)}
                            height={440}
                        />
                    </Panel>
                </div>
            </div>
        </>
    );
}
