import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/better-auth/auth";
import { getLiveQuotes } from "@/lib/actions/finnhub.actions";
import { isRateLimited } from "@/lib/rate-limit";
import { schwabEnabled } from "@/lib/schwab";
import { schwabSymbol } from "@/lib/schwab-quotes";

const MAX_SYMBOLS = 50; // the watchlist cap
const SYMBOL_PATTERN = /^[A-Z0-9.:\-]{1,20}$/;

// Polled by on-screen prices. Signed-in only and capped, so nobody can burn the shared Finnhub quota.
export async function GET(req: NextRequest) {
    const session = await getSession();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const symbols = [...new Set(
        (req.nextUrl.searchParams.get("symbols") ?? "")
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter((s) => SYMBOL_PATTERN.test(s)),
    )].slice(0, MAX_SYMBOLS);

    // Counted per symbol: unseen tickers each cost a Finnhub call. A 50-symbol watchlist polled every 15 s uses
    // about 200 a minute; the cap stops one free account from draining the shared key pool.
    // With Schwab on, everything it prices rides one shared batch call, so only the rest is counted per symbol
    // (a 2s poll is 30 requests a minute, well under the cap).
    const cost = schwabEnabled() ? Math.max(1, symbols.filter((s) => !schwabSymbol(s)).length) : symbols.length;
    if (await isRateLimited(`quotes:user:${session.user.id}`, 300, 60, cost)) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    return NextResponse.json(await getLiveQuotes(symbols), {
        headers: { "Cache-Control": "private, max-age=1" },
    });
}
