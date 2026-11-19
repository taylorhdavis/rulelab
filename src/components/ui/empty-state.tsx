import * as React from "react"

import { cn } from "../../lib/utils"

function EmptyState({
  action,
  className,
  description,
  icon,
  title,
  ...props
}: React.ComponentProps<"div"> & {
  action?: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  title: React.ReactNode
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center",
        className
      )}
      {...props}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-md text-xs leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
