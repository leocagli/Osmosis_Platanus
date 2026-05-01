import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.06em] whitespace-nowrap border border-transparent transition-all duration-100 outline-none select-none cursor-pointer disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[2px_2px_0_#000] hover:translate-x-px hover:translate-y-px hover:shadow-none active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        outline:
          "bg-transparent text-foreground border border-[#3a3a3a] shadow-[2px_2px_0_#000] hover:translate-x-px hover:translate-y-px hover:shadow-none",
        secondary:
          "bg-secondary text-foreground border border-border shadow-[2px_2px_0_#000] hover:translate-x-px hover:translate-y-px hover:shadow-none",
        ghost:
          "bg-transparent text-fg2 border border-border hover:text-primary",
        destructive:
          "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
        gold:
          "bg-gold text-black shadow-[2px_2px_0_#000] hover:translate-x-px hover:translate-y-px hover:shadow-none active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        panel:
          "bg-surface text-foreground border-border shadow-[2px_2px_0_#000] hover:border-[#3a3a3a] hover:text-primary",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "px-5 py-3",
        sm: "px-3.5 py-2 text-[11px]",
        lg: "px-7 py-3.5 text-sm",
        xl: "px-8 py-4 text-sm",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
