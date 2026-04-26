"use client"

import * as React from "react"
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react"
import { addDays, format, subDays, startOfDay, endOfDay, isSameDay } from "date-fns"
import { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useIsMobile } from "@/hooks/use-mobile"

interface DateRangePickerProps {
    date: DateRange | undefined;
    onDateChange: (date: DateRange | undefined) => void;
    className?: string;
    placeholder?: string;
    presetMode?: "past" | "future";
}

type Preset = "today" | "yesterday" | "last7" | "last30" | "last365" | "custom" | "all-time";

const pastPresets: { value: Preset; label: string }[] = [
    { value: "all-time", label: "All time" },
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "last7", label: "Last 7 days" },
    { value: "last30", label: "Last 30 days" },
    { value: "last365", label: "Last 365 days" },
    { value: "custom", label: "Custom Range" },
];

const futurePresets: { value: Preset; label: string }[] = [
    { value: "all-time", label: "All time" },
    { value: "today", label: "Today" },
    { value: "last7", label: "Next 7 days" },
    { value: "last30", label: "Next 30 days" },
    { value: "last365", label: "Next 365 days" },
    { value: "custom", label: "Custom Range" },
];

export function DateRangePicker({
  date,
  onDateChange,
  className,
  placeholder = "Pick a date",
  presetMode = "past",
}: DateRangePickerProps) {
  const isMobile = useIsMobile();
  const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);
  const presets = presetMode === "future" ? futurePresets : pastPresets;

  // Match the current actual date purely mathematically against presets
  const getActivePreset = (): Preset | null => {
      if (!date?.from && !date?.to) return "all-time";
      if (!date.from || !date.to) return "custom";

      const now = new Date();
      
      if (isSameDay(date.from, startOfDay(now)) && isSameDay(date.to, endOfDay(now))) return "today";
      
      const yesterday = subDays(now, 1);
      if (isSameDay(date.from, startOfDay(yesterday)) && isSameDay(date.to, endOfDay(yesterday))) return "yesterday";

      if (presetMode === "past") {
         if (isSameDay(date.from, subDays(startOfDay(now), 6)) && isSameDay(date.to, endOfDay(now))) return "last7";
         if (isSameDay(date.from, subDays(startOfDay(now), 29)) && isSameDay(date.to, endOfDay(now))) return "last30";
         if (isSameDay(date.from, subDays(startOfDay(now), 364)) && isSameDay(date.to, endOfDay(now))) return "last365";
      } else {
         if (isSameDay(date.from, startOfDay(now)) && isSameDay(date.to, endOfDay(addDays(now, 6)))) return "last7";
         if (isSameDay(date.from, startOfDay(now)) && isSameDay(date.to, endOfDay(addDays(now, 29)))) return "last30";
         if (isSameDay(date.from, startOfDay(now)) && isSameDay(date.to, endOfDay(addDays(now, 364)))) return "last365";
      }

      return "custom";
  };

  const activePreset = getActivePreset();

  const handlePresetClick = (presetValue: Preset) => {
    if (presetValue === "custom") return;

    if (presetValue === "all-time") {
        onDateChange(undefined);
        setIsPopoverOpen(false);
        return;
    }

    const now = new Date();
    let newRange: DateRange | undefined;

    switch (presetValue) {
        case 'today':
            newRange = { from: startOfDay(now), to: endOfDay(now) };
            break;
        case 'yesterday':
            const yesterday = subDays(now, 1);
            newRange = { from: startOfDay(yesterday), to: endOfDay(yesterday) };
            break;
        case 'last7':
            newRange = presetMode === "future" 
                ? { from: startOfDay(now), to: endOfDay(addDays(now, 6)) }
                : { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
            break;
        case 'last30':
            newRange = presetMode === "future" 
                ? { from: startOfDay(now), to: endOfDay(addDays(now, 29)) }
                : { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
            break;
        case 'last365':
            newRange = presetMode === "future" 
                ? { from: startOfDay(now), to: endOfDay(addDays(now, 364)) }
                : { from: startOfDay(subDays(now, 364)), to: endOfDay(now) };
            break;
    }
    
    if (newRange) {
        onDateChange(newRange);
        setIsPopoverOpen(false); // Close modal when a quick preset is clicked
    }
  };

  const displayValue = () => {
    if (activePreset && activePreset !== "custom" && activePreset !== "all-time") {
        const found = presets.find(p => p.value === activePreset);
        if (found) return found.label;
    }
    if (activePreset === "all-time") return "All time";

    if (date?.from) {
      if (date.to) {
        return `${format(date.from, "LLL dd")} - ${format(date.to, "LLL dd, y")}`;
      }
      return format(date.from, "LLL dd, y");
    }
    return placeholder;
  };

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal bg-background hover:bg-muted/50",
              !date && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1 truncate">{displayValue()}</span>
            <ChevronDown className="ml-2 h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 flex flex-col sm:flex-row shadow-xl rounded-xl" align="end" avoidCollisions={true}>
          
          {/* Presets Sidebar (Desktop) or Topbar (Mobile) */}
          <div className="flex sm:flex-col gap-1.5 p-3 border-b sm:border-b-0 sm:border-r bg-muted/10 sm:min-w-[150px] overflow-x-auto max-w-[100vw]">
             {presets.map((preset) => (
                <Button
                    key={preset.value}
                    variant={activePreset === preset.value ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                        "sm:justify-start justify-center shrink-0 h-9 text-xs sm:text-sm font-medium transition-colors",
                        activePreset === preset.value ? "bg-primary/10 text-primary hover:bg-primary/20" : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => handlePresetClick(preset.value)}
                >
                    {preset.label}
                </Button>
             ))}
          </div>

          {/* Calendar Range Picker */}
          <div className="p-3 flex flex-col">
            <Calendar
                initialFocus
                mode="range"
                defaultMonth={date?.from}
                selected={date}
                onSelect={(range) => {
                    let adjusted = range;
                    if (range?.to) adjusted = { ...range, to: endOfDay(range.to) };
                    onDateChange(adjusted);
                }}
                numberOfMonths={isMobile ? 1 : 2}
                className="rounded-md"
            />
            <div className="flex justify-between items-center mt-2 pt-2 border-t border-border/50 px-2">
                <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Selected Range</span>
                <Button variant="ghost" size="sm" onClick={() => { onDateChange(undefined); setIsPopoverOpen(false); }} className="text-muted-foreground hover:text-destructive h-8 text-xs font-semibold">
                   Clear Selection
                </Button>
            </div>
          </div>

        </PopoverContent>
      </Popover>
    </div>
  )
}
