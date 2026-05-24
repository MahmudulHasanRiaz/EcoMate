"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import "react-day-picker/style.css"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        month_caption: "flex justify-center pt-1 relative items-center h-7",
        caption_label: "text-sm font-medium text-foreground",
        nav: "space-x-1 flex items-center absolute w-full justify-between left-0 px-4 pointer-events-none z-10",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 pointer-events-auto"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 pointer-events-auto"
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex justify-between",
        weekday: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem] text-center",
        week: "flex w-full mt-2 justify-between",

        day: "h-9 w-9 p-0 relative flex items-center justify-center isolate text-center text-sm focus-within:relative focus-within:z-20",

        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal rounded-md transition-none hover:bg-accent hover:text-accent-foreground data-[selected]:bg-transparent data-[selected]:text-foreground"
        ),

        range_start: "day-range-start rounded-l-md bg-accent [&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:rounded-md",
        range_end: "day-range-end rounded-r-md bg-accent [&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:rounded-md",
        range_middle: "bg-accent text-accent-foreground rounded-none data-[outside]:bg-transparent [&>button]:bg-transparent [&>button]:text-accent-foreground [&>button]:rounded-none",

        today: "bg-accent/50 text-accent-foreground font-bold [&>button]:font-bold",
        outside: "day-outside text-muted-foreground opacity-50 data-[selected]:bg-transparent data-[selected]:text-muted-foreground/40",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === 'left') {
            return <ChevronLeft className="h-4 w-4" />
          }
          return <ChevronRight className="h-4 w-4" />
        },
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
