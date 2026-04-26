"use client";

import React, { useMemo, useState } from "react";
import { Check, ChevronRight, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CategoryWithCount } from "@/services/categories";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

/* ------------------------------------------------------------------ */
/*  Props: supports both single-select (legacy) and multi-select      */
/* ------------------------------------------------------------------ */

interface CategoryTreeSelectProps {
    categories: CategoryWithCount[];
    /** Multi-select mode: array of selected IDs */
    value?: string | string[];
    /** Callback — emits string[] in multi mode, string in single mode */
    onSelect: (value: string | string[]) => void;
    placeholder?: string;
    /** Enable multi-select (default: false for backward compat) */
    multiple?: boolean;
}

type TreeNode = CategoryWithCount & {
    children: TreeNode[];
    level: number;
};

// Recursive function to build the tree
function buildTree(categories: CategoryWithCount[], parentId: string | null = null, level = 0): TreeNode[] {
    return categories
        .filter((c) => c.parentId === parentId)
        .map((c) => ({
            ...c,
            level,
            children: buildTree(categories, c.id, level + 1),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// Flat list search helper
function filterTree(nodes: TreeNode[], term: string): TreeNode[] {
    const lowerTerm = term.toLowerCase();
    return nodes.reduce((acc: TreeNode[], node) => {
        const matchesRequest = node.name.toLowerCase().includes(lowerTerm);
        const filteredChildren = filterTree(node.children, term);

        if (matchesRequest || filteredChildren.length > 0) {
            acc.push({
                ...node,
                children: filteredChildren
            });
        }
        return acc;
    }, []);
}

export function CategoryTreeSelect({
    categories,
    value,
    onSelect,
    placeholder = "Select category...",
    multiple = false,
}: CategoryTreeSelectProps) {
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    const treeData = useMemo(() => buildTree(categories), [categories]);

    const displayNodes = useMemo(() => {
        if (!searchTerm) return treeData;
        return filterTree(treeData, searchTerm);
    }, [treeData, searchTerm]);

    // Normalize value to array for internal use
    const selectedIds: string[] = useMemo(() => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        return value ? [value] : [];
    }, [value]);

    const findCategory = (id: string) => categories.find(c => c.id === id);

    const toggleId = (id: string) => {
        if (multiple) {
            const next = selectedIds.includes(id)
                ? selectedIds.filter(s => s !== id)
                : [...selectedIds, id];
            onSelect(next);
        } else {
            // Single-select: toggle or set
            if (selectedIds.includes(id)) {
                onSelect('');
                setOpen(false);
            } else {
                onSelect(id);
                setOpen(false);
            }
        }
    };

    const clearAll = () => {
        if (multiple) {
            onSelect([]);
        } else {
            onSelect('');
        }
    };

    // ---- Trigger label ----
    const triggerLabel = useMemo(() => {
        if (selectedIds.length === 0) return null;
        if (!multiple) {
            const cat = findCategory(selectedIds[0]);
            return cat ? cat.name : null;
        }
        // Multi: show badges
        return selectedIds
            .map(id => findCategory(id))
            .filter(Boolean)
            .map(cat => cat!.name);
    }, [selectedIds, categories, multiple]);

    // Recursive component for rendering nodes
    const renderNode = (node: TreeNode) => {
        const isSelected = selectedIds.includes(node.id);
        const hasChildren = node.children && node.children.length > 0;

        // Leaf node
        if (!hasChildren) {
            return (
                <div
                    key={node.id}
                    className={cn(
                        "flex items-center gap-2 py-2 px-2 text-sm rounded-sm hover:bg-accent cursor-pointer transition-colors",
                        isSelected && "bg-primary/10 text-primary font-medium"
                    )}
                    style={{ paddingLeft: `${(node.level * 12) + 8}px` }}
                    onClick={() => toggleId(node.id)}
                >
                    <div className={cn(
                        "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                        isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"
                    )}>
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <span className="flex-1 truncate">{node.name}</span>
                </div>
            );
        }

        // Parent node (Accordion)
        return (
            <AccordionItem value={node.id} key={node.id} className="border-b-0">
                <div className="flex items-center hover:bg-muted/50 rounded-sm pr-2">
                    <AccordionTrigger className="py-2 hover:no-underline px-2 flex-1 justify-start gap-2 text-sm [&>svg]:hidden">
                        <div
                            className="flex-1 text-left flex items-center gap-2"
                            style={{ paddingLeft: `${(node.level * 12)}px` }}
                        >
                            <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200" />
                            <span className={cn("truncate", isSelected && "font-bold text-primary")}>
                                {node.name}
                            </span>
                        </div>
                    </AccordionTrigger>
                    <div
                        className={cn(
                            "h-5 w-5 rounded border flex items-center justify-center shrink-0 cursor-pointer transition-colors",
                            isSelected ? "bg-primary border-primary" : "border-muted-foreground/40 hover:border-primary"
                        )}
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleId(node.id);
                        }}
                    >
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                </div>
                <AccordionContent className="pl-0 pb-0">
                    <div className="flex flex-col border-l ml-4 border-dashed">
                        {node.children.map(child => renderNode(child))}
                    </div>
                </AccordionContent>
            </AccordionItem>
        );
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between font-normal h-auto min-h-10"
                >
                    <div className="flex-1 flex flex-wrap gap-1 items-center text-left">
                        {!triggerLabel || (Array.isArray(triggerLabel) && triggerLabel.length === 0) ? (
                            <span className="text-muted-foreground">{placeholder}</span>
                        ) : multiple && Array.isArray(triggerLabel) ? (
                            triggerLabel.map((name, i) => (
                                <Badge key={selectedIds[i]} variant="secondary" className="text-xs font-normal gap-1">
                                    {name}
                                    <X
                                        className="h-3 w-3 cursor-pointer hover:text-destructive"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleId(selectedIds[i]);
                                        }}
                                    />
                                </Badge>
                            ))
                        ) : (
                            <span>{typeof triggerLabel === 'string' ? triggerLabel : triggerLabel?.[0]}</span>
                        )}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0" align="start">
                <div className="flex items-center border-b px-3">
                    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                    <input
                        className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder="Search categories..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <ScrollArea className="h-[300px]">
                    <div className="p-2">
                        {displayNodes.length === 0 ? (
                            <div className="py-6 text-center text-sm text-muted-foreground">No category found.</div>
                        ) : (
                            <Accordion type="multiple" className="w-full space-y-1">
                                {displayNodes.map(node => renderNode(node))}
                            </Accordion>
                        )}
                    </div>
                </ScrollArea>
                <div className="p-2 border-t bg-muted/20 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                        {selectedIds.length > 0
                            ? `${selectedIds.length} selected`
                            : `${categories.length} categories available`}
                    </span>
                    {selectedIds.length > 0 && (
                        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={clearAll}>
                            Clear all
                        </Button>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
