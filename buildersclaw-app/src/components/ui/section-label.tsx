import * as React from "react"

import { cn } from "@/lib/utils"

function SectionLabel({
  children,
  className,
}: React.ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-primary",
        className
      )}
    >
      <span className="mr-1.5">&gt;</span>
      {children}
    </p>
  )
}

export { SectionLabel }
