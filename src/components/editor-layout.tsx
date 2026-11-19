import type { ComponentProps, ReactNode } from "react"

import { cn } from "../lib/utils"

export const EDITOR_PANEL_CLASS =
  "min-h-0 border-sidebar-border bg-sidebar text-sidebar-foreground"

export const EDITOR_SECTION_CLASS = "min-w-0 space-y-3 overflow-hidden p-4"

type EditorPanelHeaderProps = Omit<ComponentProps<"div">, "title"> & {
  actions?: ReactNode
  description?: ReactNode
  eyebrow?: ReactNode
  title: ReactNode
}

export function EditorPanelHeader({
  actions,
  className,
  description,
  eyebrow,
  title,
  ...props
}: EditorPanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex h-10 shrink-0 items-center justify-between gap-3 border-b border-sidebar-border px-4",
        className
      )}
      {...props}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-[10px] font-medium uppercase tracking-normal text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <h3 className="truncate text-xs font-semibold uppercase tracking-normal text-foreground/80">
          {title}
        </h3>
        {description ? (
          <div className="mt-0.5 text-sm font-normal normal-case tracking-normal text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  )
}

type EditorSectionHeaderProps = Omit<ComponentProps<"div">, "title"> & {
  actions?: ReactNode
  icon?: ReactNode
  meta?: ReactNode
  title: ReactNode
}

export function EditorSectionHeader({
  actions,
  className,
  icon,
  meta,
  title,
  ...props
}: EditorSectionHeaderProps) {
  return (
    <div
      className={cn("flex items-center justify-between gap-3", className)}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
        {icon ? <span className="shrink-0 text-foreground/60">{icon}</span> : null}
        <span className="truncate">{title}</span>
      </div>
      {actions ?? meta ? (
        <div className="flex min-w-0 shrink items-center justify-end gap-2">
          {meta ? <span className="min-w-0 truncate font-mono text-[12px] text-foreground/70">{meta}</span> : null}
          {actions}
        </div>
      ) : null}
    </div>
  )
}
