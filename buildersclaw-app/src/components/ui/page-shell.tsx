import * as React from "react"

import { cn } from "@/lib/utils"
import { PageBackground } from "@/components/ui/page-background"

function PageShell({
  className,
  contentClassName,
  children,
}: React.ComponentProps<"main"> & { contentClassName?: string }) {
  return (
    <main
      className={cn(
        "relative min-h-screen overflow-hidden bg-background pt-16",
        className
      )}
    >
      <PageBackground />
      <div className={cn("relative z-[1] mx-auto w-full max-w-[1180px] px-6 py-12 sm:px-8 sm:py-14", contentClassName)}>
        {children}
      </div>
    </main>
  )
}

export { PageShell }
