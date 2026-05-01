import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full border-2 border-[rgba(89,65,57,0.2)] bg-black/30 px-[14px] py-3 font-mono text-[13px] text-foreground outline-none transition-colors placeholder:text-fg2/60 focus:border-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
