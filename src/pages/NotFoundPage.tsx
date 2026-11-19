import { Link } from "react-router"

import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Button } from "../components/ui/button"

export function NotFoundPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>404 Not Found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>The page you requested does not exist.</p>
          <p>Check the URL and try again.</p>
          <div className="pt-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/">Back to home</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
