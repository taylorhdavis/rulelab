import type { ComponentProps } from "react"

import { cn } from "../lib/utils"

type AppLogoProps = ComponentProps<"span"> & {
  showText?: boolean
  textClassName?: string
}

export function RuleLabMark({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm ring-1 ring-border/70",
        className
      )}
      {...props}
    >
      <svg
        aria-hidden="true"
        className="size-[1.35rem]"
        fill="none"
        viewBox="0 0 32 32"
      >
        <path
          d="M9.5 24.5V7.5H19C23 7.5 25.5 9.8 25.5 13.2C25.5 16.7 23 18.8 19 18.8H13.8"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.5"
        />
        <path
          d="M18.3 18.9L25 24.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.5"
        />
        <circle cx="24.5" cy="7.5" r="2.5" className="fill-emerald-500" />
      </svg>
      <span className="sr-only">RuleLab</span>
    </span>
  )
}

export function AppLogo({
  className,
  showText = false,
  textClassName,
  ...props
}: AppLogoProps) {
  const mark = (
    <RuleLabMark
      aria-hidden={showText ? "true" : undefined}
      className={showText ? undefined : className}
      {...(!showText ? props : undefined)}
    />
  )

  if (!showText) {
    return mark
  }

  return (
    <span className={cn("inline-flex items-center gap-2", className)} {...props}>
      {mark}
      <span className={cn("font-semibold text-foreground", textClassName)}>
        RuleLab
      </span>
    </span>
  )
}
