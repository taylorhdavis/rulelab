import * as React from "react"

import { cn } from "../../lib/utils"

function CodeBlock({ className, ...props }: React.ComponentProps<"pre">) {
  return (
    <pre
      data-slot="code-block"
      className={cn(
        "overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5 text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { CodeBlock }
