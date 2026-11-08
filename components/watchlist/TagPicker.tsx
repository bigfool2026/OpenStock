"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Tags } from "lucide-react";
import { toast } from "sonner";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { setWatchlistTags } from "@/lib/actions/watchlist.actions";
import { WATCHLIST_TAGS, sortTags } from "@/lib/watchlist-tags";
import { cn } from "@/lib/utils";

// Per-row category editor. Writes the whole set each time, so unchecking is just a smaller set.
export default function TagPicker({ symbol, tags }: { symbol: string; tags: string[] }) {
    const router = useRouter();
    const [current, setCurrent] = useState<string[]>(sortTags(tags));
    const [saving, setSaving] = useState(false);

    const toggle = async (tag: string, on: boolean) => {
        const previous = current;
        const next = sortTags(on ? [...current, tag] : current.filter((t) => t !== tag));
        setCurrent(next); // optimistic
        setSaving(true);
        try {
            const result = await setWatchlistTags(symbol, next);
            if (result && "error" in result) {
                setCurrent(previous);
                toast.error(result.error);
                return;
            }
            router.refresh(); // the page groups by tag, so the row moves panels
        } catch {
            setCurrent(previous);
            toast.error("Couldn’t update categories");
        } finally {
            setSaving(false);
        }
    };

    const label = current.length
        ? `${symbol} categories: ${current.join(", ")}`
        : `Add ${symbol} to a category`;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    disabled={saving}
                    className={cn("icon-btn", current.length && "is-on")}
                    title={label}
                    aria-label={label}
                >
                    <Tags />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Categories</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {WATCHLIST_TAGS.map((tag) => (
                    <DropdownMenuCheckboxItem
                        key={tag}
                        checked={current.includes(tag)}
                        onCheckedChange={(on) => toggle(tag, !!on)}
                        onSelect={(e) => e.preventDefault()} // keep it open for multi-select
                    >
                        {tag}
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
