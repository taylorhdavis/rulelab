import { cn } from "../../lib/utils"

type LoadingIndicatorProps = {
  className?: string
  label?: string
  markClassName?: string
}

function LoadingIndicator({ className, label, markClassName }: LoadingIndicatorProps) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-muted-foreground", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "loading-orbit relative inline-flex size-4 shrink-0 rounded-full border border-primary/65 bg-primary/15 text-primary shadow-[0_0_14px_color-mix(in_oklab,var(--primary)_35%,transparent)]",
          markClassName
        )}
      >
        <span className="absolute left-1/2 top-0 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current shadow-[0_0_14px_currentColor]" />
      </span>
      {label ? <span>{label}</span> : null}
    </span>
  )
}

function LoadingShimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "loading-shimmer block h-1.5 rounded-full bg-muted",
        className
      )}
    />
  )
}

export { LoadingIndicator, LoadingShimmer }
