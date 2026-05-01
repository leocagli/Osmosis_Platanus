import * as React from "react"

import { cn } from "@/lib/utils"

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "w-full cursor-pointer border-2 border-[rgba(89,65,57,0.2)] bg-black/30 px-[14px] py-3 font-mono text-[13px] text-foreground outline-none transition-colors focus:border-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Select }
