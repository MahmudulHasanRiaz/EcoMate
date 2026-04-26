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
import type { StaffMember } from "@/types";

interface StaffComboboxProps {
    staffMembers: StaffMember[];
    value: string;
    onChange: (value: string) => void;
    mode?: 'filter' | 'assign';
    disabled?: boolean;
    selectedLabel?: string;
}

export function StaffCombobox({
    staffMembers,
    value,
    onChange,
    mode = 'filter',
    disabled = false,
    selectedLabel,
}: StaffComboboxProps) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const [isPending, startTransition] = React.useTransition();

    const selectedStaff = React.useMemo(() =>
        staffMembers.find((s) => s.id === value), [staffMembers, value]);

    const buttonLabel = value === "all" ? "All Staff" :
        value === "me" ? "Assigned to Me" :
            value === "unassigned" ? "Unassigned" :
                (selectedStaff?.name || selectedLabel || "Assign staff...");

    const mainOptions = React.useMemo(() => {
        const opts = [];
        if (mode === 'filter') {
            opts.push({ id: "all", name: "All Staff" });
        }
        opts.push({ id: "me", name: "Assigned to Me" });
        opts.push({ id: "unassigned", name: "Unassigned" });
        return opts;
    }, [mode]);

    const filteredMainOptions = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return mainOptions;
        return mainOptions.filter(opt => opt.name.toLowerCase().includes(q));
    }, [mainOptions, query]);

    const filteredStaffOptions = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return staffMembers;
        return staffMembers.filter(opt => opt.name.toLowerCase().includes(q));
    }, [staffMembers, query]);

    const handleSelect = (id: string) => {
        onChange(id);
        setOpen(false);
    };

    const hasMain = filteredMainOptions.length > 0;
    const hasStaff = filteredStaffOptions.length > 0;

    return (
        <Popover open={open} onOpenChange={(isOpen) => {
            setOpen(isOpen);
            if (!isOpen) setQuery("");
        }}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between shadow-sm bg-background/50 font-normal h-9 text-sm border border-input rounded-md px-3"
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
                        placeholder="Search staff..."
                        className="h-9"
                        autoFocus
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                if (filteredMainOptions.length > 0) handleSelect(filteredMainOptions[0].id);
                                else if (filteredStaffOptions.length > 0) handleSelect(filteredStaffOptions[0].id);
                            }
                        }}
                    />
                </div>
                <div className="max-h-[300px] overflow-y-auto p-1 custom-scrollbar">
                    {!hasMain && !hasStaff && (
                        <div className="py-6 text-center text-sm text-muted-foreground">No staff found.</div>
                    )}

                    {hasMain && (
                        <div className="mb-1">
                            {filteredMainOptions.map((opt) => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleSelect(opt.id);
                                    }}
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
                            ))}
                        </div>
                    )}

                    {hasMain && hasStaff && <div className="h-px bg-border my-1 mx-1" />}

                    {hasStaff && (
                        <div>
                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Staff Members</div>
                            {filteredStaffOptions.map((opt) => (
                                <button
                                    key={opt.id}
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleSelect(opt.id);
                                    }}
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
                            ))}
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
