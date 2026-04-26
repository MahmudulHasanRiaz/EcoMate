'use client';

import React, { useState, useEffect, useMemo } from "react";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
    Command,
    CommandList,
    CommandEmpty,
    CommandItem,
} from "@/components/ui/command";
import { Check, Loader2, ScanBarcode } from "lucide-react";
import { cn } from "@/lib/utils";
import type { InventoryItem } from "@/types";

interface LotSelectionComboboxProps {
    itemId: string;
    part: string;
    productId?: string;
    variantId?: string | null;
    localInventoryLots: InventoryItem[];
    onSelect: (lot: InventoryItem) => void;
    formatLotLabel: (lot: InventoryItem) => string;
}

const LotSelectionCombobox = ({
    itemId,
    part,
    productId,
    variantId,
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
        if (!query) return localInventoryLots.slice(0, 50);
        const lower = query.toLowerCase();
        return localInventoryLots.filter(lot =>
            lot.lotNumber.toLowerCase().includes(lower) ||
            lot.productName.toLowerCase().includes(lower) ||
            lot.locationName.toLowerCase().includes(lower)
        ).slice(0, 50);
    }, [query, localInventoryLots]);

    // Server search effect (Debounced)
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (!query || query.length < 3) {
                setServerMatches([]);
                return;
            }

            setIsSearching(true);
            try {
                const params = new URLSearchParams();
                params.set('search', query);
                params.set('pageSize', '20');
                if (productId) params.set('productId', productId);
                if (variantId) params.set('variantId', variantId);

                const res = await fetch(`/api/inventory/lots?${params.toString()}`, { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    const items: InventoryItem[] = data.items || data.data?.items || (Array.isArray(data) ? data : []);
                    setServerMatches(items);
                }
            } catch (e) {
                console.error("Server search error", e);
            } finally {
                setIsSearching(false);
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [query, productId, variantId]);

    // Combine matches
    const combinedMatches = useMemo(() => {
        const localIds = new Set(localMatches.map(l => l.id));
        const uniqueServer = serverMatches.filter(l => !localIds.has(l.id));
        return [...localMatches, ...uniqueServer];
    }, [localMatches, serverMatches]);

    const handleSelect = (lot: InventoryItem) => {
        onSelect(lot);
        setOpen(false);
        setQuery("");
    };

    const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            // FAST SCANNING LOGIC:
            // Do not rely on 'combinedMatches' state which updates after render.
            // Use the current input value immediately.
            const rawValue = e.currentTarget.value.trim();
            if (!rawValue) return;

            const lower = rawValue.toLowerCase();

            // 1. Immediate Local Check (Synchronous)
            const exactLocal = localInventoryLots.find(l => l.lotNumber.toLowerCase() === lower);
            if (exactLocal) {
                handleSelect(exactLocal);
                return;
            }

            // 2. Immediate Server Check (Bypass debounce)
            if (rawValue.length > 2) {
                setIsSearching(true);
                try {
                    const params = new URLSearchParams();
                    params.set('search', rawValue);
                    params.set('pageSize', '5');
                    if (productId) params.set('productId', productId);
                    if (variantId) params.set('variantId', variantId);

                    const res = await fetch(`/api/inventory/lots?${params.toString()}`, { cache: 'no-store' });
                    if (res.ok) {
                        const data = await res.json();
                        const items: InventoryItem[] = data.items || data.data?.items || (Array.isArray(data) ? data : []);

                        // Check for exact match in results
                        const exactMatch = items.find(l => l.lotNumber.toLowerCase() === lower);
                        if (exactMatch) {
                            handleSelect(exactMatch);
                            return;
                        }

                        // If only one result, select it? 
                        if (items.length === 1 && items[0].lotNumber.toLowerCase().includes(lower)) {
                            handleSelect(items[0]);
                            return;
                        }

                        // Just show results
                        setServerMatches(items);
                        setOpen(true);
                    }
                } catch (e) {
                    console.error("Immediate search error", e);
                } finally {
                    setIsSearching(false);
                }
            }
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverAnchor>
                <div className="relative group">
                    <Input
                        placeholder="Scan or select lot..."
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setOpen(true);
                        }}
                        onFocus={() => setOpen(true)}
                        onKeyDown={handleKeyDown}
                        className={cn(
                            "w-full pr-8",
                            // Visual cue
                            open && "ring-2 ring-ring ring-offset-2"
                        )}
                        autoComplete="off"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        {isSearching ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                            <ScanBarcode className="h-4 w-4 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
                        )}
                    </div>
                </div>
            </PopoverAnchor>
            <PopoverContent
                className="w-[300px] p-0"
                align="start"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <Command shouldFilter={false}>
                    <CommandList>
                        {!isSearching && combinedMatches.length === 0 && (
                            <CommandEmpty>No lot found.</CommandEmpty>
                        )}
                        {combinedMatches.map((lot) => (
                            <CommandItem
                                key={lot.id}
                                value={`${lot.lotNumber}__${lot.id}`} // Unique value to prevent cmdk confusion
                                onSelect={() => handleSelect(lot)}
                                onMouseDown={(e) => {
                                    // Prevent input blur which triggers popover close before select fires
                                    e.preventDefault();
                                    e.stopPropagation();
                                }}
                                className="cursor-pointer"
                            >
                                <Check
                                    className={cn(
                                        "mr-2 h-4 w-4",
                                        "opacity-0"
                                    )}
                                />
                                <div className="flex flex-col">
                                    <span className="font-medium">{lot.lotNumber}</span>
                                    <span className="text-xs text-muted-foreground break-all">
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
