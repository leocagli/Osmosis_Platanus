import * as React from "react"

import { cn } from "@/lib/utils"

function PageBackground({
  className,
  children,
}: React.ComponentProps<"div">) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0", className)}>
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(circle at top, rgba(255,107,0,0.12), transparent 34%), radial-gradient(circle at 82% 18%, rgba(255,215,0,0.10), transparent 20%), linear-gradient(180deg, rgba(255,255,255,0.03), transparent 28%)",
        }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,107,0,0.75),transparent)]" />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #262626 1px, transparent 1px), linear-gradient(to bottom, #262626 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      {children}
    </div>
  )
}

export { PageBackground }
