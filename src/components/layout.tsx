import type { ComponentProps, ReactNode } from "react"

import { cn } from "../lib/utils"
import { Button } from "./ui/button"
import { Card, CardContent } from "./ui/card"
import { Skeleton } from "./ui/skeleton"

type PageContainerProps = ComponentProps<"main"> & {
  size?: "default" | "wide" | "narrow"
}

const pageContainerSizes = {
  default: "max-w-6xl",
  narrow: "max-w-4xl",
  wide: "max-w-7xl",
}

export function PageContainer({
  children,
  className,
  size = "default",
  ...props
}: PageContainerProps) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8",
        pageContainerSizes[size],
        className
      )}
      {...props}
    >
      {children}
    </main>
  )
}

type PageHeaderProps = ComponentProps<"header"> & {
  actions?: ReactNode
  badge?: ReactNode
  description?: ReactNode
  title: ReactNode
}

export function PageHeader({
  actions,
  badge,
  className,
  description,
  title,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
      {...props}
    >
      <div className="min-w-0 space-y-2">
        {badge ? <div className="flex flex-wrap gap-2">{badge}</div> : null}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          {description ? (
            <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  )
}

type SectionProps = ComponentProps<"section"> & {
  actions?: ReactNode
  description?: ReactNode
  title?: ReactNode
}

export function Section({
  actions,
  children,
  className,
  description,
  title,
  ...props
}: SectionProps) {
  return (
    <section className={cn("space-y-3", className)} {...props}>
      {title || description || actions ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            {title ? <h2 className="text-base font-semibold tracking-tight">{title}</h2> : null}
            {description ? (
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function CardGrid({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-3", className)}
      {...props}
    />
  )
}

type EmptyStateProps = ComponentProps<"div"> & {
  action?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  title: ReactNode
}

export function EmptyState({
  action,
  className,
  description,
  icon,
  title,
  ...props
}: EmptyStateProps) {
  return (
    <Card className={cn("border-dashed", className)} {...props}>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        {icon ? <div className="text-muted-foreground">{icon}</div> : null}
        <div className="space-y-1">
          <p className="font-medium">{title}</p>
          {description ? (
            <p className="max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
      </CardContent>
    </Card>
  )
}

type ErrorStateProps = ComponentProps<"div"> & {
  message: ReactNode
  onRetry?: () => void
  title?: ReactNode
}

export function ErrorState({
  className,
  message,
  onRetry,
  title = "Something went wrong",
  ...props
}: ErrorStateProps) {
  return (
    <Card className={cn("border-destructive/40 bg-destructive/10", className)} {...props}>
      <CardContent className="flex flex-col gap-3 py-5 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-destructive/80">{message}</p>
        </div>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function PageSkeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("grid gap-4", className)} {...props}>
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    </div>
  )
}
