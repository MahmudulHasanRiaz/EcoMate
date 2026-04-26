'use client';

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
import type { Category } from "@/types";

interface CategoryComboboxProps {
    categories: Category[];
    value: string;
    onChange: (value: string) => void;
}

export function CategoryCombobox({
    categories,
    value,
    onChange,
}: CategoryComboboxProps) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");

    const selectedCategory = React.useMemo(() =>
        categories.find((cat) => cat.id === value), [categories, value]);

    const buttonLabel = value === "all" ? "All Categories" : (selectedCategory?.name || "Select category...");

    const allOptions = React.useMemo(() => {
        const options: { id: string, name: string, level: number }[] = [
            { id: "all", name: "All Categories", level: 0 }
        ];

        const mainCategories = categories.filter(c => !c.parentId);
        mainCategories.forEach(cat => {
            options.push({ id: cat.id, name: cat.name, level: 0 });
            const subs = categories.filter(c => c.parentId === cat.id);
            subs.forEach(s => {
                options.push({ id: s.id, name: s.name, level: 1 });
            });
        });

        return options;
    }, [categories]);

    const filteredOptions = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allOptions;
        return allOptions.filter(opt => opt.name.toLowerCase().includes(q));
    }, [allOptions, query]);

    return (
        <Popover open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) setQuery("");
        }}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    className="w-[200px] justify-between shadow-sm bg-background/50"
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
                        placeholder="Search category..."
                        className="h-9"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && filteredOptions.length > 0) {
                                onChange(filteredOptions[0].id);
                                setOpen(false);
                            }
                        }}
                    />
                </div>
                <div className="max-h-[300px] overflow-y-auto p-1">
                    {filteredOptions.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">No results found.</div>
                    ) : (
                        filteredOptions.map((opt) => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                    onChange(opt.id);
                                    setOpen(false);
                                }}
                                className={cn(
                                    "w-full text-left rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                                    opt.level === 1 && "pl-8",
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
