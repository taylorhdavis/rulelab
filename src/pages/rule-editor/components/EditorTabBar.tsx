import { FilePlusIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react"

import { Button } from "../../../components/ui/button"
import { cn } from "../../../lib/utils"

export type EditorTabSummary = {
  id: string
  name: string
  isDirty: boolean
}

type EditorTabBarProps = {
  activeTabId: string
  canOpenNewTab?: boolean
  fontSize: number
  tabs: EditorTabSummary[]
  onCloseTab: (id: string) => void
  onNewTab: () => void
  onSelectTab: (id: string) => void
  onZoomIn: () => void
  onZoomOut: () => void
}

export function EditorTabBar({
  activeTabId,
  canOpenNewTab = true,
  fontSize,
  tabs,
  onCloseTab,
  onNewTab,
  onSelectTab,
  onZoomIn,
  onZoomOut,
}: EditorTabBarProps) {
  return (
    <div className="relative -top-px mb-[-1px] flex items-center border-b border-sidebar-border bg-sidebar text-xs">
      <div
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
        role="tablist"
        aria-label="Open rule tabs"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              title={tab.name}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              className={cn(
                "relative flex h-9 min-w-32 max-w-56 cursor-pointer items-center gap-2 border-r border-sidebar-border px-3 text-left font-medium outline-none transition-colors focus-visible:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                isActive
                  ? "bg-transparent text-foreground after:absolute after:inset-x-3 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-primary"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
              )}
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onSelectTab(tab.id)
                }
              }}
            >
              <span className="min-w-0 flex-1 truncate" title={tab.name}>
                {tab.name}
              </span>
              {tab.isDirty ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-amber-500/80"
                  title="Unsaved changes"
                >
                  <span className="sr-only">Unsaved changes</span>
                </span>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="ml-1 size-5 shrink-0 rounded-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                aria-label={`Close ${tab.name}`}
                title={`Close ${tab.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  onCloseTab(tab.id)
                }}
                onKeyDown={(event) => {
                  event.stopPropagation()
                }}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
          )
        })}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="m-2 shrink-0"
          disabled={!canOpenNewTab}
          onClick={onNewTab}
          title={canOpenNewTab ? "New rule tab" : "Close a rule tab before opening another."}
          aria-label="New rule tab"
        >
          <FilePlusIcon />
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-l border-sidebar-border px-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onZoomOut}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <MinusIcon />
        </Button>
        <span className="w-8 text-center font-mono text-[10px] text-muted-foreground">
          {fontSize}px
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onZoomIn}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  )
}
