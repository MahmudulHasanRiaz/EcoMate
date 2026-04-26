'use client';

import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandItem,
    CommandGroup
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InventoryItem } from "@/types";

interface LotSelectionComboboxProps {
    itemId: string;
    part: string;
    localInventoryLots: InventoryItem[];
    onSelect: (inventoryItemId: string) => void;
    formatLotLabel: (lot: InventoryItem) => string;
}

const LotSelectionCombobox = ({
    itemId,
    part,
    localInventoryLots,
    onSelect,
    formatLotLabel
}: LotSelectionComboboxProps) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [serverMatches, setServerMatches] = useState<InventoryItem[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Filter local lots
    const localMatches = useMemo(() => {
        if (!query) return localInventoryLots.slice(0, 50); // Show recent 50 if empty
        const lower = query.toLowerCase();
        return localInventoryLots.filter(lot =>
            lot.lotNumber.toLowerCase().includes(lower) ||
            lot.productName.toLowerCase().includes(lower) ||
            lot.locationName.toLowerCase().includes(lower)
        ).slice(0, 50);
    }, [query, localInventoryLots]);

    // Server search effect (Debounced)
    useEffect(() => {
        if (!query) {
            setServerMatches([]);
            return;
        }

        const timer = setTimeout(async () => {
            // Only search server if local matches are few or user explicitly wants to find something not there
            // But per requirement "Find from WHOLE inventory", we should probably search if query is specific enough.
            // Minimizing api calls: search only if query length > 2
            if (query.length < 3) return;

            setIsSearching(true);
            try {
                const res = await fetch(`/api/inventory/lots?search=${encodeURIComponent(query)}&pageSize=20`, { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    const items: InventoryItem[] = data.items || data.data?.items || (Array.isArray(data) ? data : []);
                    // Filter out items already in local to avoid duplicates visually if we merge
                    setServerMatches(items);
                }
            } catch (e) {
                console.error("Server search error", e);
            } finally {
                setIsSearching(false);
            }
        }, 500); // 500ms debounce

        return () => clearTimeout(timer);
    }, [query]);

    // Combine matches: Local first, then Server (unique)
    const combinedMatches = useMemo(() => {
        const localIds = new Set(localMatches.map(l => l.id));
        const uniqueServer = serverMatches.filter(l => !localIds.has(l.id));
        return [...localMatches, ...uniqueServer];
    }, [localMatches, serverMatches]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between">
                    {query ? query : "Select or scan lot..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Scan lot number..."
                        value={query}
                        onValueChange={setQuery}
                    />
                    <CommandList>
                        {isSearching && <div className="py-6 text-center text-sm text-muted-foreground">Searching server...</div>}
                        {!isSearching && combinedMatches.length === 0 && (
                            <CommandEmpty>No lot found.</CommandEmpty>
                        )}
                        {combinedMatches.map((lot) => (
                            <CommandItem
                                key={lot.id}
                                value={lot.lotNumber}
                                onSelect={() => {
                                    onSelect(lot.id);
                                    setOpen(false);
                                    setQuery("");
                                }}
                            >
                                <Check
                                    className={cn(
                                        "mr-2 h-4 w-4",
                                        "opacity-0" // We don't track selected state visually here as it adds to list below
                                    )}
                                />
                                <div className="flex flex-col">
                                    <span>{lot.lotNumber}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {formatLotLabel(lot)}
                                    </span>
                                </div>
                            </CommandItem>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
};

export default LotSelectionCombobox;
