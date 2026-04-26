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
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Supplier, Vendor } from "@/types";

type PartnerType = 'supplier' | 'vendor';

interface PartnerAsyncSelectProps {
    type: PartnerType;
    value?: string;
    onSelect: (id: string, partner: Supplier | Vendor) => void;
    initialOptions?: (Supplier | Vendor)[];
    placeholder?: string;
    disabled?: boolean;
    additionalParams?: Record<string, string>;
}

export function PartnerAsyncSelect({
    type,
    value,
    onSelect,
    initialOptions = [],
    placeholder,
    disabled,
    additionalParams
}: PartnerAsyncSelectProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [options, setOptions] = useState<(Supplier | Vendor)[]>(initialOptions);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);

    // Track selected partner object to display name correctly even if not in current options
    const [selectedPartner, setSelectedPartner] = useState<(Supplier | Vendor) | undefined>(
        initialOptions.find(o => o.id === value)
    );

    // Sync internal options if initialOptions changes
    useEffect(() => {
        if (initialOptions.length > 0) {
            setOptions(prev => {
                const ids = new Set(prev.map(p => p.id));
                const newOpts = initialOptions.filter(p => !ids.has(p.id));
                return [...prev, ...newOpts];
            });
        }
    }, [initialOptions]);

    // Keep selectedPartner in sync with value
    useEffect(() => {
        if (value && !selectedPartner) {
            const inOpts = options.find(o => o.id === value);
            if (inOpts) setSelectedPartner(inOpts);
        } else if (!value) {
            setSelectedPartner(undefined);
        }
    }, [value, options, selectedPartner]);

    // Fetch partners function
    const fetchPartners = async (isLoadMore = false, cursor?: string | null) => {
        const targetCursor = isLoadMore ? cursor : undefined;
        if (isLoadMore) setLoadingMore(true);
        else setLoading(true);

        try {
            const endpoint = type === 'supplier' ? '/api/partners/suppliers' : '/api/partners/vendors';
            const params = new URLSearchParams({
                search: query,
                pageSize: '20',
                ...additionalParams
            });
            if (targetCursor) params.set('cursor', targetCursor);

            const res = await fetch(`${endpoint}?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                const items: (Supplier | Vendor)[] = data.items || [];
                const newNextCursor = data.nextCursor;
                const newHasMore = !!data.hasMore;

                setOptions(prev => {
                    if (!isLoadMore) {
                        // If searching/resetting, just take new items (plus maybe keep selected if we want, 
                        // but usually search results replace list. We handle display via selectedPartner)
                        return items;
                    }
                    // Append and dedupe
                    const ids = new Set(prev.map(p => p.id));
                    const newOpts = items.filter(p => !ids.has(p.id));
                    return [...prev, ...newOpts];
                });

                setNextCursor(newNextCursor);
                setHasMore(newHasMore);
            }
        } catch (error) {
            console.error("Failed to search partners", error);
        } finally {
            if (isLoadMore) setLoadingMore(false);
            else setLoading(false);
        }
    };

    // Debounced search / initial load on open
    useEffect(() => {
        // We only fetch when open or query changes.
        // If it's closed, we don't spam API unless query was just cleared?
        // Actually, popover content unmounts/remounts usually? Radix UI popover keeps content in DOM?
        // Standard Command/Combobox behavior: fetch on open or query change.
        if (!open) return;

        const timer = setTimeout(() => {
            fetchPartners(false, undefined);
        }, 500);

        return () => clearTimeout(timer);
    }, [query, open, type]);

    const handleLoadMore = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!nextCursor || loadingMore) return;
        fetchPartners(true, nextCursor);
    };

    const displayValue = selectedPartner ? selectedPartner.name : (placeholder || `Select ${type}...`);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between"
                    disabled={disabled}
                >
                    <span className="truncate">{displayValue}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={`Search ${type}...`}
                        value={query}
                        onValueChange={setQuery}
                    />
                    <CommandList>
                        {loading && (
                            <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Searching...
                            </div>
                        )}
                        {!loading && options.length === 0 && (
                            <CommandEmpty>No {type} found.</CommandEmpty>
                        )}
                        {options.map((partner) => (
                            <CommandItem
                                key={partner.id}
                                value={partner.name}
                                onSelect={() => {
                                    setSelectedPartner(partner);
                                    onSelect(partner.id, partner);
                                    setOpen(false);
                                    setQuery("");
                                }}
                            >
                                <Check
                                    className={cn(
                                        "mr-2 h-4 w-4",
                                        value === partner.id ? "opacity-100" : "opacity-0"
                                    )}
                                />
                                <div className="flex flex-col">
                                    <span>{partner.name}</span>
                                    {partner.phone && (
                                        <span className="text-xs text-muted-foreground">{partner.phone}</span>
                                    )}
                                </div>
                            </CommandItem>
                        ))}
                        {hasMore && !loading && (
                            <div className="p-2 border-t text-center">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full h-8 text-xs"
                                    onClick={handleLoadMore}
                                    disabled={loadingMore}
                                >
                                    {loadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : "Load More"}
                                </Button>
                            </div>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
