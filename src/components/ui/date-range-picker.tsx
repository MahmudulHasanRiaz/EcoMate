"use client"

import * as React from "react"
import { addDays, format, subDays, startOfDay, endOfDay, isSameDay } from "date-fns"
import { CalendarIcon, ChevronDown } from "lucide-react"
import { type DateRange } from "react-day-picker"

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

const dateFormat = "dd MMM";
const dateFormatFull = "dd MMM, yyyy";

export function DateRangePicker({
  date,
  onDateChange,
  className,
  placeholder = "Pick a date",
  presetMode = "past",
}: DateRangePickerProps) {
  const isMobile = useIsMobile();
  const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);
  const [showCalendar, setShowCalendar] = React.useState(false);

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
  const presets = presetMode === "future" ? futurePresets : pastPresets;

  React.useEffect(() => {
    if (!isPopoverOpen) setShowCalendar(false);
  }, [isPopoverOpen]);

  const handlePresetClick = (presetValue: Preset) => {
    if (presetValue === "custom") {
      setShowCalendar(true);
      return;
    }

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
        setIsPopoverOpen(false);
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
        const sameYear = date.from.getFullYear() === date.to.getFullYear();
        if (sameYear) {
          return `${format(date.from, dateFormat)} - ${format(date.to, dateFormatFull)}`;
        }
        return `${format(date.from, dateFormatFull)} - ${format(date.to, dateFormatFull)}`;
      }
      return format(date.from, dateFormatFull);
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
              date ? "justify-start text-left font-normal" : "justify-start text-left font-normal text-muted-foreground",
              "w-full bg-background hover:bg-muted/50"
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1 truncate text-xs sm:text-sm">{displayValue()}</span>
            <ChevronDown className="ml-2 h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={cn("w-auto p-0", !showCalendar && "shadow-xl rounded-xl")}
          align={showCalendar ? "start" : "end"}
          sideOffset={showCalendar ? 8 : 4}
        >
          {!showCalendar ? (
            <div className="flex flex-col gap-1 p-2">
              {presets.map((preset) => {
                const isCustom = preset.value === "custom";
                const isActive = activePreset === preset.value;
                return (
                  <Button
                    key={preset.value}
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "justify-start h-9 text-sm font-medium transition-colors",
                      isActive && "bg-primary/10 text-primary hover:bg-primary/20",
                      !isActive && "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => handlePresetClick(preset.value)}
                  >
                    {preset.label}
                    {isActive && !isCustom && (
                      <span className="ml-auto text-[10px] opacity-50">&#10003;</span>
                    )}
                  </Button>
                );
              })}
            </div>
          ) : (
            <Calendar
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={(range) => {
                if (!range) {
                  onDateChange(undefined);
                  return;
                }
                onDateChange({
                  from: range.from ? startOfDay(range.from) : undefined,
                  to: range.to ? endOfDay(range.to) : undefined,
                });
              }}
              numberOfMonths={isMobile ? 1 : 2}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
