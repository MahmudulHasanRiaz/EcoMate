import * as React from "react"

import { cn } from "@/lib/utils"

type InputProps = React.ComponentProps<"input"> & {
  allowNegative?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, allowNegative = false, onKeyDown, onWheel, min, ...props }, ref) => {
    const isNumber = type === "number"
    const resolvedMin = isNumber && !allowNegative ? (min ?? 0) : min

    const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
      if (isNumber && !allowNegative) {
        if (["e", "E", "+", "-"].includes(event.key)) {
          event.preventDefault()
          return
        }
      }
      onKeyDown?.(event)
    }

    const handleWheel: React.WheelEventHandler<HTMLInputElement> = (event) => {
      if (isNumber) {
        ;(event.target as HTMLElement).blur()
        event.preventDefault()
      }
      onWheel?.(event)
    }

    return (
      <input
        type={type}
        min={resolvedMin}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        inputMode={isNumber ? "decimal" : props.inputMode}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
