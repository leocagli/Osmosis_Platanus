import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] leading-none",
  {
    variants: {
      variant: {
        default:  "border-border text-foreground",
        live:     "border-live text-live",
        primary:  "border-primary text-primary",
        filled:   "border-primary bg-primary text-primary-foreground",
        panel:    "border-border bg-surface text-foreground shadow-[2px_2px_0_#000]",
        blue:     "border-[#3a5a7a] bg-[#0f1a2a] text-[#7ec8ff]",
        muted:    "border-border text-fg2",
        danger:   "border-danger text-danger",
        gold:     "border-gold text-gold",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  dot,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { dot?: string }) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <span className="text-[8px]">{dot}</span>}
      {children}
    </span>
  )
}

export { Badge, badgeVariants }
