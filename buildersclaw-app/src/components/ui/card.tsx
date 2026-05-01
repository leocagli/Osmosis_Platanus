import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const cardVariants = cva("flex flex-col gap-4 border p-6 text-card-foreground", {
  variants: {
    variant: {
      default: "bg-card border-border",
      terminal:
        "bg-card border-border shadow-[4px_4px_0_#000] relative overflow-hidden before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(255,107,0,0.75),transparent)]",
      inset:
        "bg-[linear-gradient(180deg,rgba(17,17,17,0.98),rgba(17,17,17,0.88))] border-[#2f2f2f] shadow-[0_18px_48px_rgba(0,0,0,0.32)]",
    },
    padding: {
      default: "p-6",
      compact: "p-4",
      roomy: "p-7",
      none: "p-0",
    },
  },
  defaultVariants: {
    variant: "default",
    padding: "default",
  },
})

function Card({
  className,
  variant,
  padding,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      className={cn(cardVariants({ variant, padding }), className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1", className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-mono text-sm font-bold text-foreground", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("font-mono text-xs text-fg2 leading-relaxed", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn("", className)} {...props} />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center gap-4 pt-3 border-t border-dashed border-border font-mono text-xs text-fg2",
        className
      )}
      {...props}
    />
  )
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, cardVariants }
