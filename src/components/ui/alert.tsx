import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../lib/utils"

const alertVariants = cva(
  "relative grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-lg border px-3 py-2 text-sm",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        destructive: "border-destructive/35 bg-destructive/10 text-destructive",
        success: "border-emerald-500/35 bg-emerald-500/10 text-emerald-700",
        warning: "border-amber-500/35 bg-amber-500/10 text-amber-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("font-medium leading-5", className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-current/85 leading-5", className)}
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle }
