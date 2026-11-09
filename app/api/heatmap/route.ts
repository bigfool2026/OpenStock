import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/better-auth/auth";
import { getSpxHeat, getSymbolsHeat } from "@/lib/tv-heatmap";
import { getUserWatchlist } from "@/lib/actions/watchlist.actions";
import { sortTags, UNTAGGED } from "@/lib/watchlist-tags";

// Feeds the dashboard heatmap. scope=spx: the S&P 500 grouped by sector. scope=watchlist: the user's own symbols grouped
// by category (a symbol in several categories is drawn once, in the first). Signed-in only.
export async function GET(req: NextRequest) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const scope = req.nextUrl.searchParams.get("scope") === "watchlist" ? "watchlist" : "spx";
    let entry;
    if (scope === "spx") {
        entry = await getSpxHeat();
    } else {
        const list: { symbol: string; tags?: string[] }[] = await getUserWatchlist();
        const tagOf = new Map(list.map((i) => [i.symbol, sortTags(i.tags ?? [])[0] ?? UNTAGGED]));
        entry = list.length ? await getSymbolsHeat(list.map((i) => i.symbol), (s) => tagOf.get(s) ?? UNTAGGED) : { items: [], asOf: Date.now() };
    }
    if (!entry) return NextResponse.json({ error: "Data unavailable" }, { status: 502 });
    return NextResponse.json({ scope, asOf: entry.asOf, items: entry.items }, { headers: { "Cache-Control": "private, max-age=10" } });
}
