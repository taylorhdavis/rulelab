import { Outlet } from "react-router"
import { useLayoutEffect } from "react"
import { Toaster } from "sonner"

import { TooltipProvider } from "../components/ui/tooltip"

import "./styles.css"

const PRELOAD_RECOVERY_KEY_PREFIX = "rulelab:preload-recovery:"
const PRELOAD_RECOVERY_VERSION = "2026-06-21-cache-revalidate"
let preloadErrorRecoveryInstalled = false

installPreloadErrorRecovery()

export function Root() {
  useLayoutEffect(() => {
    document.documentElement.classList.add("dark")
    document.documentElement.style.background = "#111111"
    document.documentElement.style.colorScheme = "dark"
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-svh min-h-0 flex-col overflow-hidden">
        <Outlet />
      </div>
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          classNames: {
            toast:
              "w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md shadow-foreground/5",
            title: "min-w-0 break-words text-xs font-medium leading-4 text-popover-foreground",
            description: "min-w-0 break-words text-[11px] leading-4 text-muted-foreground [overflow-wrap:anywhere]",
            actionButton: "h-7 rounded-md bg-primary px-2 text-xs text-primary-foreground",
            cancelButton: "h-7 rounded-md bg-accent px-2 text-xs text-muted-foreground",
            closeButton: "size-5 border-border bg-accent text-popover-foreground",
            error: "border-destructive/45 bg-popover text-popover-foreground",
            info: "border-border bg-popover text-popover-foreground",
            loading: "border-border bg-popover text-popover-foreground",
            success: "border-emerald-500/45 bg-popover text-popover-foreground",
            warning: "border-amber-500/45 bg-popover text-popover-foreground",
          },
        }}
      />
    </TooltipProvider>
  )
}

function installPreloadErrorRecovery() {
  if (typeof window === "undefined" || preloadErrorRecoveryInstalled) {
    return
  }

  preloadErrorRecoveryInstalled = true
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault()

    const recoveryKey = getPreloadRecoveryKey()
    if (hasRecoveredFromPreloadError(recoveryKey)) {
      return
    }

    markPreloadErrorRecovered(recoveryKey)
    window.location.reload()
  })
}

function getPreloadRecoveryKey() {
  if (typeof document === "undefined") {
    return `${PRELOAD_RECOVERY_KEY_PREFIX}unknown`
  }

  const clientEntryScript = Array.from(document.scripts).find((script) =>
    script.src.includes("/assets/client-entry-")
  )
  return `${PRELOAD_RECOVERY_KEY_PREFIX}${PRELOAD_RECOVERY_VERSION}:${clientEntryScript?.src ?? "unknown"}`
}

function hasRecoveredFromPreloadError(key: string) {
  try {
    return window.sessionStorage.getItem(key) === "1"
  } catch {
    return false
  }
}

function markPreloadErrorRecovered(key: string) {
  try {
    window.sessionStorage.setItem(key, "1")
  } catch {
    // If storage is unavailable, still reload once for the common stale-chunk case.
  }
}
