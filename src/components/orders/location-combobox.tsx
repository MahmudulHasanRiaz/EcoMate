'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type LocationOption = {
    id: string | number;
    name: string;
};

interface LocationComboboxProps {
    value?: string;
    options: LocationOption[];
    onChange: (value: string) => void;
    onSearchChange?: (query: string) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    disabled?: boolean;
    loading?: boolean;
    emptyText?: string;
    maxVisible?: number;
    className?: string;
}

export function LocationCombobox({
    value,
    options,
    onChange,
    onSearchChange,
    placeholder = 'Select option',
    searchPlaceholder = 'Search...',
    disabled = false,
    loading = false,
    emptyText = 'No options found.',
    maxVisible = 140,
    className,
}: LocationComboboxProps) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const deferredQuery = React.useDeferredValue(query.trim().toLowerCase());

    React.useEffect(() => {
        if (!onSearchChange) return;
        onSearchChange(query.trim());
    }, [query, onSearchChange]);

    const cappedLimit = React.useMemo(
        () => Math.max(40, Math.min(maxVisible, 300)),
        [maxVisible]
    );

    const selectedOption = React.useMemo(
        () => options.find((opt) => String(opt.id) === String(value)),
        [options, value]
    );

    const { visibleOptions, totalMatches, isTruncated } = React.useMemo(() => {
        const matching = deferredQuery
            ? options.filter((opt) => (opt.name || '').toLowerCase().includes(deferredQuery))
            : options;

        const visible = matching.slice(0, cappedLimit);
        const hasSelectedVisible = visible.some((opt) => String(opt.id) === String(value));

        if (selectedOption && !hasSelectedVisible) {
            return {
                visibleOptions: [selectedOption, ...visible.slice(0, Math.max(cappedLimit - 1, 0))],
                totalMatches: matching.length,
                isTruncated: matching.length > cappedLimit,
            };
        }

        return {
            visibleOptions: visible,
            totalMatches: matching.length,
            isTruncated: matching.length > cappedLimit,
        };
    }, [deferredQuery, options, cappedLimit, value, selectedOption]);

    const buttonLabel = selectedOption?.name || placeholder;

    return (
        <Popover
            open={open}
            onOpenChange={(isOpen) => {
                setOpen(isOpen);
                if (!isOpen) {
                    setQuery('');
                    onSearchChange?.('');
                }
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn('w-full justify-between font-normal', className)}
                >
                    <span className="truncate">{buttonLabel}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[320px] max-w-[90vw] p-0"
                align="start"
                avoidCollisions={false}
                portalled={false}
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <div className="border-b px-3 py-2">
                    <Input
                        placeholder={searchPlaceholder}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="h-8 border-0 p-0 focus-visible:ring-0"
                        autoFocus
                    />
                </div>
                <div className="max-h-[280px] overflow-y-auto p-1">
                    {loading ? (
                        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading...
                        </div>
                    ) : (
                        <>
                            {visibleOptions.length === 0 ? (
                                <div className="py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
                            ) : (
                                visibleOptions.map((opt) => (
                                    <button
                                        key={String(opt.id)}
                                        type="button"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        onClick={() => {
                                            onChange(String(opt.id));
                                            setOpen(false);
                                        }}
                                        className={cn(
                                            'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground',
                                            String(value) === String(opt.id) && 'bg-accent text-accent-foreground'
                                        )}
                                    >
                                        <Check
                                            className={cn(
                                                'h-4 w-4',
                                                String(value) === String(opt.id) ? 'opacity-100' : 'opacity-0'
                                            )}
                                        />
                                        <span className="truncate">{opt.name}</span>
                                    </button>
                                ))
                            )}
                            {isTruncated ? (
                                <div className="px-3 py-2 text-xs text-muted-foreground border-t">
                                    Showing first {visibleOptions.length} of {totalMatches}. Type to narrow results.
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}
