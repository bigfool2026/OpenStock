'use server';

import { connectToDatabase } from '@/database/mongoose';
import { Watchlist } from '@/database/models/watchlist.model';
import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/lib/better-auth/auth';
import { normalizeTag, sortTags, type WatchlistTag } from '@/lib/watchlist-tags';

// Tickers as Finnhub writes them (AAPL, BRK.B, RELIANCE.NS, M&M.NS, 0700.HK, BINANCE:BTCUSDT). Server actions take
// untrusted input, and every symbol here becomes Finnhub calls on /watchlist and in the news digest.
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9.&:-]{0,24}$/;
const MAX_WATCHLIST = 50;

// -- CRUD Operations --

// Drops anything not in the catalog, so a stale client can't invent groups.
const cleanTags = (tags?: string[]) => sortTags(
    (Array.isArray(tags) ? tags : [])
        .map(normalizeTag)
        .filter((t): t is WatchlistTag => t !== null)
);

export async function addToWatchlist(symbol: string, company: string, tags?: string[]) {
    const userId = await requireUserId();
    const ticker = String(symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(ticker)) throw new Error('Invalid symbol');
    const name = String(company ?? '').trim().slice(0, 120);
    try {
        await connectToDatabase();

        if (!(await Watchlist.exists({ userId, symbol: ticker })) && (await Watchlist.countDocuments({ userId })) >= MAX_WATCHLIST) {
            return { error: `Your watchlist is full (${MAX_WATCHLIST} stocks). Remove one to add another.` };
        }

        // Upsert to avoid duplicates/errors if it already exists. $addToSet so adding a
        // symbol from inside a group doesn't drop the groups it is already in.
        const newItem = await Watchlist.findOneAndUpdate(
            { userId, symbol: ticker },
            {
                $set: { userId, symbol: ticker, company: name },
                $setOnInsert: { addedAt: new Date() },
                ...(cleanTags(tags).length ? { $addToSet: { tags: { $each: cleanTags(tags) } } } : {}),
            },
            { upsert: true, new: true }
        );

        revalidatePath('/', 'layout'); // sidebar lists the watchlist on every page
        return JSON.parse(JSON.stringify(newItem));
    } catch (error) {
        console.error('Error adding to watchlist:', error);
        throw new Error('Failed to add to watchlist');
    }
}

export async function removeFromWatchlist(symbol: string) {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        await Watchlist.findOneAndDelete({ userId, symbol: symbol.toUpperCase() });
        revalidatePath('/', 'layout'); // sidebar lists the watchlist on every page
        return { success: true };
    } catch (error) {
        console.error('Error removing from watchlist:', error);
        throw new Error('Failed to remove from watchlist');
    }
}

// Replaces a symbol's groups wholesale — the tag picker sends the full set it wants.
export async function setWatchlistTags(symbol: string, tags: string[]) {
    const userId = await requireUserId();
    const ticker = String(symbol ?? '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(ticker)) throw new Error('Invalid symbol');
    try {
        await connectToDatabase();
        const updated = await Watchlist.findOneAndUpdate(
            { userId, symbol: ticker },
            { $set: { tags: cleanTags(tags) } },
            { new: true }
        );
        if (!updated) return { error: `${ticker} is not on your watchlist.` };
        revalidatePath('/', 'layout');
        return { success: true, tags: updated.tags };
    } catch (error) {
        console.error('Error updating watchlist tags:', error);
        throw new Error('Failed to update categories');
    }
}

export async function getUserWatchlist() {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const watchlist = await Watchlist.find({ userId }).sort({ addedAt: -1 });
        return JSON.parse(JSON.stringify(watchlist));
    } catch (error) {
        console.error('Error fetching watchlist:', error);
        return [];
    }
}

// Check if a symbol is in the user's watchlist
export async function isStockInWatchlist(symbol: string) {
    const userId = await requireUserId();
    try {
        await connectToDatabase();
        const item = await Watchlist.findOne({ userId, symbol: symbol.toUpperCase() });
        return !!item;
    } catch (error) {
        console.error('Error checking watchlist status:', error);
        return false;
    }
}
