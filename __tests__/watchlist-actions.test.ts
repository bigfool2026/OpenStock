import { beforeEach, describe, expect, it, vi } from 'vitest';

// The category a symbol is filed under is decided here, in the update the server action sends, so these tests pin
// that update rather than going through the UI.

const requireUserId = vi.fn();
vi.mock('@/lib/better-auth/auth', () => ({ requireUserId: () => requireUserId() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/database/mongoose', () => ({ connectToDatabase: vi.fn().mockResolvedValue({}) }));

const findOneAndUpdate = vi.fn();
const exists = vi.fn();
const countDocuments = vi.fn();
vi.mock('@/database/models/watchlist.model', () => ({
    Watchlist: {
        findOneAndUpdate: (...args: unknown[]) => findOneAndUpdate(...args),
        exists: (...args: unknown[]) => exists(...args),
        countDocuments: (...args: unknown[]) => countDocuments(...args),
    },
}));

import { addToWatchlist, setWatchlistTags } from '@/lib/actions/watchlist.actions';

describe('addToWatchlist', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requireUserId.mockResolvedValue('user-1');
        exists.mockResolvedValue(null);
        countDocuments.mockResolvedValue(3);
        findOneAndUpdate.mockImplementation(async (_filter: unknown, update: { $set: object }) => ({ ...update.$set }));
    });

    it('files the symbol under the category it was added from', async () => {
        await addToWatchlist('nvda', 'NVIDIA', ['SEMI']);
        const [filter, update] = findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({ userId: 'user-1', symbol: 'NVDA' });
        expect(update.$addToSet).toEqual({ tags: { $each: ['SEMI'] } });
        expect(update.$set).toMatchObject({ userId: 'user-1', symbol: 'NVDA', company: 'NVIDIA' });
    });

    it('adds to a category without dropping the ones the symbol is already in ($addToSet, not $set)', async () => {
        await addToWatchlist('NVDA', 'NVIDIA', ['SEMI']);
        const update = findOneAndUpdate.mock.calls[0][1];
        expect(update.$set).not.toHaveProperty('tags');
    });

    it('accepts a category in any case and ignores ones that are not in the catalogue', async () => {
        await addToWatchlist('AMD', 'AMD', ['semi', 'MAGS', 'not-a-category']);
        expect(findOneAndUpdate.mock.calls[0][1].$addToSet).toEqual({ tags: { $each: ['MAGS', 'SEMI'] } }); // catalogue order
    });

    it('with no category, adds the symbol and touches no tags (it lands in Ungrouped)', async () => {
        await addToWatchlist('SPY', 'SPDR S&P 500');
        const update = findOneAndUpdate.mock.calls[0][1];
        expect(update).not.toHaveProperty('$addToSet');
        expect(update.$set).not.toHaveProperty('tags');
    });

    it('keeps the original added-at time when a symbol is added again', async () => {
        await addToWatchlist('AAPL', 'Apple', ['MAGS']);
        const update = findOneAndUpdate.mock.calls[0][1];
        expect(update.$setOnInsert).toHaveProperty('addedAt');
        expect(update.$set).not.toHaveProperty('addedAt');
    });

    it('refuses a new symbol once the list is full, but still lets an existing one gain a category', async () => {
        countDocuments.mockResolvedValue(50);
        await expect(addToWatchlist('NEW', 'New Co', ['SEMI'])).resolves.toMatchObject({ error: expect.stringContaining('full') });
        expect(findOneAndUpdate).not.toHaveBeenCalled();

        exists.mockResolvedValue({ _id: 'x' });
        await addToWatchlist('AAPL', 'Apple', ['MAGS']);
        expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('rejects a malformed symbol and is scoped to the session user', async () => {
        await expect(addToWatchlist('bad symbol!', 'x', ['SEMI'])).rejects.toThrow('Invalid symbol');
        expect(findOneAndUpdate).not.toHaveBeenCalled();
        requireUserId.mockRejectedValue(new Error('Unauthorized'));
        await expect(addToWatchlist('AAPL', 'Apple', ['MAGS'])).rejects.toThrow('Unauthorized');
    });
});

describe('setWatchlistTags', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requireUserId.mockResolvedValue('user-1');
    });

    it('replaces the whole set, cleaned and in catalogue order', async () => {
        findOneAndUpdate.mockResolvedValue({ tags: ['MAGS', 'SEMI'] });
        await setWatchlistTags('nvda', ['semi', 'mags', 'bogus']);
        const [filter, update] = findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({ userId: 'user-1', symbol: 'NVDA' });
        expect(update).toEqual({ $set: { tags: ['MAGS', 'SEMI'] } });
    });

    it('can clear every category', async () => {
        findOneAndUpdate.mockResolvedValue({ tags: [] });
        await setWatchlistTags('NVDA', []);
        expect(findOneAndUpdate.mock.calls[0][1]).toEqual({ $set: { tags: [] } });
    });

    it('does not create a symbol that is not on the list', async () => {
        findOneAndUpdate.mockResolvedValue(null);
        await expect(setWatchlistTags('ZZZ', ['SEMI'])).resolves.toMatchObject({ error: expect.stringContaining('not on your watchlist') });
        expect(findOneAndUpdate.mock.calls[0][2]).not.toHaveProperty('upsert');
    });
});
