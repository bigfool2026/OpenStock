// Bulk-add tickers to a user's watchlist.
//   node scripts/add-watchlist.mjs AAPL MSFT NVDA
//   node scripts/add-watchlist.mjs "AAPL, MSFT, NVDA"
//   node scripts/add-watchlist.mjs --tag SEMI NVDA AMD MU
//   node scripts/add-watchlist.mjs --untag MAGS TSLA
//   node scripts/add-watchlist.mjs --remove SNDK DRAM
//   node scripts/add-watchlist.mjs --list
//   node scripts/add-watchlist.mjs --user you@example.com AAPL MSFT
import 'dotenv/config';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';

const MAX_WATCHLIST = 50;
const argv = process.argv.slice(2);
const TAGS = ['MAGS', 'SEMI', 'SaaS', 'Bonds', 'Commodity', 'Crypto', 'Index']; // keep equal to lib/watchlist-tags.ts (a test checks)
const matchTag = (v) => TAGS.find((t) => t.toLowerCase() === String(v).trim().toLowerCase());

let email = null, tag = null, untag = null, listOnly = false, removeOnly = false;
const rest = [];
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--user') { email = argv[++i]; continue; }
    if (argv[i] === '--list') { listOnly = true; continue; }
    if (argv[i] === '--remove') { removeOnly = true; continue; }
    if (argv[i] === '--tag' || argv[i] === '--untag') {
        const flag = argv[i], raw = argv[++i], hit = matchTag(raw);
        if (!hit) { console.error(`Unknown category "${raw}". Use one of: ${TAGS.join(', ')}`); process.exit(1); }
        if (flag === '--tag') tag = hit; else untag = hit;
        continue;
    }
    rest.push(argv[i]);
}
const symbols = [...new Set(
    rest.join(' ').split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean)
)];
if (!symbols.length && !listOnly) {
    console.error('Usage: node scripts/add-watchlist.mjs [--tag SEMI] AAPL MSFT NVDA');
    process.exit(1);
}

const names = new Map(
    JSON.parse(readFileSync(new URL('../data/us-tickers.json', import.meta.url)))
        .tickers.map(t => [t.symbol, t.name])
);

await mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false, family: 4 });
const db = mongoose.connection.db;

const user = email
    ? await db.collection('user').findOne({ email })
    : await db.collection('user').findOne({});
if (!user) { console.error('No user found. Sign up in the app first.'); process.exit(1); }
const userId = String(user._id);
console.log(`User: ${user.email}  (${userId})\n`);

if (listOnly) {
    const all = await db.collection('watchlists').find({ userId }).sort({ symbol: 1 }).toArray();
    for (const t of [...TAGS, '(untagged)']) {
        const inTag = all.filter(d => t === '(untagged)' ? !d.tags?.length : (d.tags || []).includes(t));
        if (inTag.length) console.log(`${t.padEnd(12)} ${inTag.map(d => d.symbol).join(' ')}`);
    }
    console.log(`\n${all.length}/${MAX_WATCHLIST} symbols.`);
    await mongoose.connection.close();
    process.exit(0);
}

if (removeOnly) {
    // Same as unstarring in the app: the symbol leaves the watchlist; alerts are a separate collection and stay
    const r = await db.collection('watchlists').deleteMany({ userId, symbol: { $in: symbols } });
    const left = await db.collection('watchlists').countDocuments({ userId });
    console.log(`Removed ${r.deletedCount} of ${symbols.length} from the watchlist: ${symbols.join(' ')}  (${left}/${MAX_WATCHLIST} left)`);
    await mongoose.connection.close();
    process.exit(0);
}

if (untag) {
    const r = await db.collection('watchlists').updateMany(
        { userId, symbol: { $in: symbols } }, { $pull: { tags: untag } }
    );
    console.log(`Removed "${untag}" from ${r.modifiedCount} symbol(s): ${symbols.join(' ')}`);
    await mongoose.connection.close();
    process.exit(0);
}

const existing = new Set(
    (await db.collection('watchlists').find({ userId }).project({ symbol: 1 }).toArray())
        .map(d => d.symbol)
);
const room = MAX_WATCHLIST - existing.size;

const toAdd = symbols.filter(s => !existing.has(s));
const alreadyThere = symbols.filter(s => existing.has(s));

// --tag applies to symbols already on the list as well as new ones
if (tag && alreadyThere.length) {
    await db.collection('watchlists').updateMany(
        { userId, symbol: { $in: alreadyThere } }, { $addToSet: { tags: tag } }
    );
}
const skipped = tag ? [] : alreadyThere;
const overflow = toAdd.slice(room);
const batch = toAdd.slice(0, Math.max(room, 0));

// Fill in names missing from us-tickers.json (ETFs, ADRs) via Finnhub
const key = (process.env.FINNHUB_API_KEYS || process.env.FINNHUB_API_KEY || '').split(',')[0].trim();
if (key) {
    for (const s of batch) {
        if (names.has(s)) continue;
        try {
            const r = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${s}&token=${key}`);
            const j = await r.json();
            if (j?.name) { names.set(s, j.name); continue; }
            // profile2 is empty for ETFs on the free tier — fall back to search
            const r2 = await fetch(`https://finnhub.io/api/v1/search?q=${s}&exchange=US&token=${key}`);
            const j2 = await r2.json();
            const hit = (j2?.result || []).find(x => x.symbol === s);
            if (hit?.description) names.set(s, hit.description);
        } catch { /* keep the symbol as the name */ }
    }
}

if (batch.length) {
    await db.collection('watchlists').bulkWrite(batch.map(symbol => ({
        updateOne: {
            filter: { userId, symbol },
            update: {
                $set: { userId, symbol, company: names.get(symbol) || symbol },
                $setOnInsert: { addedAt: new Date() },
                ...(tag ? { $addToSet: { tags: tag } } : {}),
            },
            upsert: true,
        },
    })));
}

const suffix = tag ? `  [${tag}]` : '';
for (const s of batch) console.log(`  + ${s.padEnd(7)} ${names.get(s) || '(name not in us-tickers.json)'}${suffix}`);
if (tag) for (const s of alreadyThere) console.log(`  ~ ${s.padEnd(7)} tagged ${tag}`);
for (const s of skipped) console.log(`  = ${s.padEnd(7)} already in watchlist`);
for (const s of overflow) console.log(`  ! ${s.padEnd(7)} skipped — watchlist full (${MAX_WATCHLIST})`);

const total = await db.collection('watchlists').countDocuments({ userId });
console.log(`\nAdded ${batch.length}, total now ${total}/${MAX_WATCHLIST}. Refresh the page to see them.`);
await mongoose.connection.close();
