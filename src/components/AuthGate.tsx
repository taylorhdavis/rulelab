import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router"
import { useAuth } from "wasp/client/auth"

import { PUBLIC_INTERNAL_ERROR_MESSAGE } from "../lib/public-errors"
import { Card, CardContent } from "./ui/card"
import { LoadingIndicator } from "./ui/loading-indicator"

export function AuthGate({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { data: user, error, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <LoadingIndicator label="Loading" />
      </div>
    )
  }

  if (error) {
    return (
      <main className="flex h-svh items-center justify-center bg-background p-6">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="p-6">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="mt-2 text-sm text-muted-foreground">{PUBLIC_INTERNAL_ERROR_MESSAGE}</p>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }

  return children
}
