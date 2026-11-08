"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation";
import { CommandDialog, CommandEmpty, CommandInput, CommandList } from "@/components/ui/command"
import { ArrowUpRight, Check, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { addToWatchlist } from "@/lib/actions/watchlist.actions";
import { useDebounce } from "@/hooks/useDebounce";

const OPEN_SEARCH_EVENT = 'open-search';

// Any button can open the one palette mounted in the app shell. This one takes no arguments on purpose: the
// shell passes it straight to onClick, so a parameter would receive the click event.
export const openSearch = () => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));

// The same palette in "add" mode: picking a result puts it on the watchlist (in `tag`, when given) instead of
// opening its page.
export const openSearchToAdd = (tag?: string) =>
    window.dispatchEvent(new CustomEvent<{ tag?: string }>(OPEN_SEARCH_EVENT, { detail: { tag } }));

// `add` turns the palette into a way to add symbols to the watchlist; `tag` files them under a category.
export const SearchButton = ({ children, className, add, tag }: { children: React.ReactNode; className?: string; add?: boolean; tag?: string }) => (
    <button type="button" onClick={() => (add ? openSearchToAdd(tag) : openSearch())} className={className}>{children}</button>
);

export default function SearchCommand({ initialStocks }: { initialStocks: StockWithWatchlistStatus[] }) {
    const router = useRouter();
    const [open, setOpen] = useState(false)
    // null = the usual palette (results open their page); set = results are added to the watchlist instead
    const [addMode, setAddMode] = useState<{ tag?: string } | null>(null);
    const [added, setAdded] = useState<string[]>([]); // symbols added in this visit, so each one can show a tick
    const [adding, setAdding] = useState<string | null>(null);

    // However the dialog closes (Esc, the X, a click outside, Cmd+K), add mode doesn't outlive it
    useEffect(() => {
        if (!open) { setAddMode(null); setAdded([]); }
    }, [open]);
    const [searchTerm, setSearchTerm] = useState("")
    const [loading, setLoading] = useState(false)
    const [stocks, setStocks] = useState<StockWithWatchlistStatus[]>(initialStocks);
    // The palette starts closed, so render it only after hydration (avoids Radix id mismatches)
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const isSearchMode = !!searchTerm.trim();
    const displayStocks = isSearchMode ? stocks : stocks?.slice(0, 10);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault()
                setOpen(v => !v)
            }
        }
        const onOpen = (e: Event) => {
            // Only openSearchToAdd sends a detail; a plain open (or anything else on this event) leaves add mode off
            const detail = (e as CustomEvent<{ tag?: string } | undefined>).detail;
            setAddMode(detail && typeof detail === 'object' && 'tag' in detail ? { tag: typeof detail.tag === 'string' ? detail.tag : undefined } : null);
            setAdded([]);
            setOpen(true);
        }
        window.addEventListener("keydown", onKeyDown)
        window.addEventListener(OPEN_SEARCH_EVENT, onOpen)
        return () => {
            window.removeEventListener("keydown", onKeyDown)
            window.removeEventListener(OPEN_SEARCH_EVENT, onOpen)
        }
    }, [])

    const handleSearch = async () => {
        if(!isSearchMode) return setStocks(initialStocks);

        setLoading(true)
        try {
            const results = await searchStocks(searchTerm.trim());
            setStocks(results);
        } catch {
            setStocks([])
        } finally {
            setLoading(false)
        }
    }

    const debouncedSearch = useDebounce(handleSearch, 300);

    useEffect(() => {
        debouncedSearch();
    }, [debouncedSearch, searchTerm]);

    const handleSelectStock = () => {
        setOpen(false);
        setSearchTerm("");
        setStocks(initialStocks);
    }

    // Add mode keeps the palette open so several symbols can go in one after another, each getting a tick
    const handleAdd = async (stock: StockWithWatchlistStatus) => {
        setAdding(stock.symbol);
        try {
            const result = await addToWatchlist(stock.symbol, stock.name, addMode?.tag ? [addMode.tag] : undefined);
            if (result && 'error' in result) {
                toast.error(result.error);
                return;
            }
            setAdded((current) => [...current, stock.symbol]);
            toast.success(`${stock.symbol} added${addMode?.tag ? ` to ${addMode.tag}` : ' to your watchlist'}`);
            router.refresh(); // the watchlist page and the sidebar list both read from the server
        } catch {
            toast.error(`Couldn’t add ${stock.symbol}`);
        } finally {
            setAdding(null);
        }
    }

    if (!mounted) return null;

    return (
        <CommandDialog open={open} onOpenChange={setOpen} className="search-dialog">
            <div className="search-field">
                <CommandInput value={searchTerm} onValueChange={setSearchTerm} placeholder="Search by company or symbol" className="search-input" />
                {loading && <Loader2 className="search-loader" />}
            </div>
            {addMode && (
                <p className="px-4 pt-2.5 text-[12.5px] text-faint">
                    Adding to <span className="font-semibold text-foreground">{addMode.tag ?? 'your watchlist'}</span>. Pick as many as you like, then close.
                </p>
            )}
            <CommandList className="search-list">
                {loading ? (
                    <CommandEmpty className="search-list-empty">Searching</CommandEmpty>
                ) : displayStocks?.length === 0 ? (
                    <div className="search-list-indicator">
                        {isSearchMode ? `Nothing matches “${searchTerm.trim()}”` : 'No stocks available'}
                    </div>
                ) : (
                    <ul>
                        <li className="search-count">
                            {isSearchMode ? 'Results' : 'Popular'}
                            <span className="num"> · {displayStocks?.length || 0}</span>
                        </li>
                        {displayStocks?.map((stock) => (
                            <li key={stock.symbol} className="search-item">
                                {addMode ? (
                                    <button
                                        type="button"
                                        onClick={() => handleAdd(stock)}
                                        disabled={adding === stock.symbol || added.includes(stock.symbol)}
                                        className="search-item-link group w-full text-left"
                                    >
                                        <span className="mono w-20 shrink-0 text-[13px] font-semibold text-brand-ink truncate">{stock.symbol}</span>
                                        <span className="search-item-name flex-1">{stock.name}</span>
                                        <span className="hidden sm:block text-xs text-faint truncate max-w-40">{[stock.exchange, stock.type].filter(Boolean).join(' · ')}</span>
                                        {added.includes(stock.symbol) ? (
                                            <Check className="size-4 text-brand-ink" aria-label="Added" />
                                        ) : adding === stock.symbol ? (
                                            <Loader2 className="size-4 animate-spin text-faint" />
                                        ) : (
                                            <Plus className="size-4 text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                                        )}
                                    </button>
                                ) : (
                                <Link
                                    href={`/stocks/${stock.symbol}`}
                                    onClick={handleSelectStock}
                                    className="search-item-link group"
                                >
                                    <span className="mono w-20 shrink-0 text-[13px] font-semibold text-brand-ink truncate">{stock.symbol}</span>
                                    <span className="search-item-name flex-1">{stock.name}</span>
                                    <span className="hidden sm:block text-xs text-faint truncate max-w-40">{[stock.exchange, stock.type].filter(Boolean).join(' · ')}</span>
                                    <ArrowUpRight className="size-4 text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                                </Link>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </CommandList>
        </CommandDialog>
    )
}
