import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "../../lib/utils"

function TextLink({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "a"

  return (
    <Comp
      data-slot="text-link"
      className={cn(
        "font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
      {...props}
    />
  )
}

export { TextLink }
