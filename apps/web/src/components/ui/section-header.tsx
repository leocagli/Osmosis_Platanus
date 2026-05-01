import * as React from "react"

import { cn } from "@/lib/utils"

function SectionHeader({
  eyebrow,
  title,
  description,
  align = "left",
  className,
}: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  align?: "left" | "center"
  className?: string
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4",
        align === "center" && "items-center text-center",
        className
      )}
    >
      {eyebrow ? (
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-primary">
          <span className="mr-1.5">&gt;</span>
          {eyebrow}
        </p>
      ) : null}
      <div className={cn("max-w-[880px] space-y-4", align === "center" && "mx-auto")}>
        <h1 className="font-display text-[clamp(22px,3.2vw,42px)] leading-[1.45] text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="max-w-[760px] font-mono text-[15px] leading-[1.8] text-fg2 sm:text-[17px]">
            {description}
          </p>
        ) : null}
      </div>
    </header>
  )
}

export { SectionHeader }
