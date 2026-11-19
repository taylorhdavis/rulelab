import * as React from "react"

import { cn } from "../../lib/utils"
import { Label } from "./label"

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("grid gap-6", className)}
      {...props}
    />
  )
}

function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field"
      className={cn("grid gap-2", className)}
      {...props}
    />
  )
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(className)}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-error"
      className={cn("text-sm font-medium text-destructive", className)}
      {...props}
    />
  )
}

function FieldSeparator({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-separator"
      className={cn("relative flex items-center justify-center text-xs text-muted-foreground", className)}
      {...props}
    >
      <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
      <span className="relative bg-background px-2">{children}</span>
    </div>
  )
}

export { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator }
