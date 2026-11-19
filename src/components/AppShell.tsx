import type { ReactNode } from "react"
import { BugIcon } from "lucide-react"
import { Link } from "react-router"
import { useAuth } from "wasp/client/auth"
import { getPublicAppSettings, useQuery } from "wasp/client/operations"

import { AppSidebar } from "./app-sidebar"
import { Button } from "./ui/button"
import { Card, CardContent } from "./ui/card"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "./ui/sidebar"
import { cn } from "../lib/utils"

type AppShellProps = {
  actions?: ReactNode | ((context: AppShellActionContext) => ReactNode)
  breadcrumb: string
  children: ReactNode
  className?: string
  compactHeader?: boolean
  section: string
  title: string
}

type AppShellActionContext = {
  bugReportHref: string | null
  supportEmail: string | null
}

export function AppShell({
  actions,
  breadcrumb,
  children,
  className,
  compactHeader = false,
  section,
  title,
}: AppShellProps) {
  const { data: user } = useAuth()
  const { data: settings } = useQuery(getPublicAppSettings)
  const supportEmail = settings?.supportEmail || null
  const bugReportHref = supportEmail ? getBugReportMailto(supportEmail) : null
  const customActions = typeof actions === "function"
  const renderedActions = customActions
    ? actions({ bugReportHref, supportEmail })
    : actions

  return (
    <SidebarProvider open={false} onOpenChange={() => {}}>
      <AppSidebar />
      <SidebarInset className="min-h-0 overflow-hidden">
        <header
          className={cn(
            "flex shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear",
            compactHeader
              ? "h-10"
              : "h-16 group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
          )}
        >
          <div
            className={cn(
              "flex min-w-0 items-center gap-2 px-4",
              compactHeader ? "translate-y-1" : undefined
            )}
          >
            <SidebarTrigger className="md:hidden" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink asChild>
                    <Link to="/editor">{section}</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>{breadcrumb || title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          {renderedActions || (!customActions && supportEmail) ? (
            <div
              className={cn(
                "flex shrink-0 items-center gap-2 px-4",
                compactHeader ? "translate-y-1" : undefined
              )}
            >
              {renderedActions}
              {!customActions && bugReportHref ? (
                <Button asChild size="sm" variant="ghost" className="hidden gap-1.5 sm:inline-flex">
                  <a href={bugReportHref}>
                    <BugIcon className="size-4" />
                    Report a bug
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
        </header>
        <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
          {settings?.appAccessEnabled === false && !user?.isAdmin ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <Card className="w-full max-w-md text-center">
                <CardContent className="p-6">
                  <h1 className="text-lg font-semibold">RuleLab is unavailable</h1>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {settings.maintenanceMessage}
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {settings.statusPageUrl ? (
                      <Button asChild variant="outline">
                        <a href={settings.statusPageUrl} target="_blank" rel="noreferrer">
                          Status page
                        </a>
                      </Button>
                    ) : null}
                    {settings.supportEmail ? (
                      <Button asChild>
                        <a href={`mailto:${settings.supportEmail}`}>Contact support</a>
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function getBugReportMailto(email: string) {
  const subject = "RuleLab bug report"
  const body = [
    "What happened?",
    "",
    "",
    "What did you expect to happen?",
    "",
    "",
    `Page: ${typeof window === "undefined" ? "" : window.location.href}`,
  ].join("\n")

  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
