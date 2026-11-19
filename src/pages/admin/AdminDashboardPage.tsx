import { lazy, Suspense } from "react"
import { useAuth } from "wasp/client/auth"

import { AuthGate } from "../../components/AuthGate"
import { Card, CardContent } from "../../components/ui/card"
import { LoadingIndicator } from "../../components/ui/loading-indicator"

const AdminDashboardContent = lazy(() =>
  import("./AdminDashboardContent").then((module) => ({ default: module.AdminDashboardContent }))
)

export function AdminDashboardPage() {
  return (
    <AuthGate>
      <AdminDashboardAccess />
    </AuthGate>
  )
}

function AdminDashboardAccess() {
  const { data: user } = useAuth()

  if (!user?.isAdmin) {
    return (
      <main className="flex h-svh items-center justify-center bg-background p-6">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="p-6">
            <h1 className="text-lg font-semibold">Page not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The page you requested could not be found or you may not have access.
            </p>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-svh items-center justify-center bg-background">
          <LoadingIndicator label="Loading admin dashboard" />
        </div>
      }
    >
      <AdminDashboardContent />
    </Suspense>
  )
}
