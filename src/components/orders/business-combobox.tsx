'use strict';

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import type { Business, StaffMember } from "@/types";

interface BusinessComboboxProps {
    businesses: { id: string; name: string }[];
    value: string;
    onChange: (value: string) => void;
    loggedInStaff?: StaffMember | null;
}

export function BusinessCombobox({
    businesses,
    value,
    onChange,
    loggedInStaff,
}: BusinessComboboxProps) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");

    // Filter businesses based on access rights
    const accessibleBusinesses = React.useMemo(() => {
        if (!loggedInStaff) return businesses;
        if (loggedInStaff.role === 'Admin') return businesses;

        // If specific access list exists, use it
        if (loggedInStaff.accessibleBusinessIds && loggedInStaff.accessibleBusinessIds.length > 0) {
            return businesses.filter(b => loggedInStaff.accessibleBusinessIds?.includes(b.id));
        }

        // If no explicit list, assume restricted (or allow all if that's the default policy? 
        // Based on "ensure only shows businesses user has access to", restricted is safer)
        return [];
    }, [businesses, loggedInStaff]);

    const selectedBusiness = React.useMemo(() =>
        accessibleBusinesses.find((b) => b.id === value), [accessibleBusinesses, value]);

    const buttonLabel = value === "all" ? "All Businesses" :
        (selectedBusiness?.name || "Select business...");

    const filteredOptions = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        // Always include "All Businesses" in the search results if it matches or if queries is empty
        const allOption = { id: "all", name: "All Businesses" };

        const matchingBusinesses = accessibleBusinesses.filter(b => b.name.toLowerCase().includes(q));

        if (!q) return [allOption, ...accessibleBusinesses];

        const opts = [];
        if (allOption.name.toLowerCase().includes(q)) opts.push(allOption);
        return [...opts, ...matchingBusinesses];
    }, [accessibleBusinesses, query]);

    const handleSelect = (id: string) => {
        onChange(id);
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) setQuery("");
        }}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    className="w-full sm:w-auto sm:min-w-[200px] justify-between shadow-sm bg-background/50 font-normal"
                >
                    <span className="truncate">{buttonLabel}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0 shadow-md z-[9999]" align="start">
                <div className="p-2 border-b">
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search business..."
                        className="h-9"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && filteredOptions.length > 0) {
                                handleSelect(filteredOptions[0].id);
                            }
                        }}
                    />
                </div>
                <div className="max-h-[300px] overflow-y-auto p-1 custom-scrollbar">
                    {filteredOptions.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">No business found.</div>
                    ) : (
                        filteredOptions.map((opt) => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => handleSelect(opt.id)}
                                className={cn(
                                    "w-full text-left rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                                    value === opt.id && "bg-accent text-accent-foreground font-medium"
                                )}
                            >
                                <span className="inline-flex items-center gap-2">
                                    <Check className={cn("h-4 w-4", value === opt.id ? "opacity-100" : "opacity-0")} />
                                    <span className="truncate">{opt.name}</span>
                                </span>
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
