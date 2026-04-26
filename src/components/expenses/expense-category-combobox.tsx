'use client';

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ExpenseCategory } from "@/types";

interface ExpenseCategoryComboboxProps {
    categories: ExpenseCategory[];
    value: string;
    onChange: (value: string) => void;
}

export function ExpenseCategoryCombobox({ categories, value, onChange }: ExpenseCategoryComboboxProps) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");

    const selected = React.useMemo(
        () => categories.find((c) => c.id === value),
        [categories, value]
    );

    const options = React.useMemo(() => {
        return [{ id: "all", name: "All Categories" }, ...categories.map(c => ({ id: c.id, name: c.name }))];
    }, [categories]);

    const filtered = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return options;
        return options.filter(opt => opt.name.toLowerCase().includes(q));
    }, [options, query]);

    const label = value === "all" ? "All Categories" : (selected?.name || "Filter by category");

    return (
        <Popover open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) setQuery(""); }}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full sm:w-[200px] justify-between">
                    <span className="truncate">{label}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0 shadow-md z-[9999]" align="start">
                <div className="p-2 border-b">
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search category..."
                        className="h-9"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && filtered.length > 0) {
                                onChange(filtered[0].id);
                                setOpen(false);
                            }
                        }}
                    />
                </div>
                <div className="max-h-[300px] overflow-y-auto p-1">
                    {filtered.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">No results found.</div>
                    ) : (
                        filtered.map((opt) => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => { onChange(opt.id); setOpen(false); }}
                                className={cn(
                                    "w-full text-left rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                                    value === opt.id && "bg-accent text-accent-foreground"
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
