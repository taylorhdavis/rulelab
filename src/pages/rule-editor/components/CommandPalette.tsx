import { useEffect, useMemo, useState } from "react"
import { Command as CommandIcon, SearchIcon } from "lucide-react"

import { useIsMobile } from "../../../hooks/use-mobile"
import { Badge } from "../../../components/ui/badge"
import { Button } from "../../../components/ui/button"
import { Input } from "../../../components/ui/input"

export type EditorCommand = {
  disabled?: boolean
  group: string
  id: string
  keywords?: string[]
  label: string
  onSelect: () => void
  shortcut?: string
}

type CommandPaletteProps = {
  commands: EditorCommand[]
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({
  commands,
  isOpen,
  onOpenChange,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("")
  const isMobile = useIsMobile()

  useEffect(() => {
    if (isOpen) {
      setQuery("")
    }
  }, [isOpen])

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return commands
    }
    return commands.filter((command) =>
      [command.label, command.group, ...(command.keywords ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    )
  }, [commands, query])

  const commandGroups = useMemo(() => {
    const groups = new Map<string, EditorCommand[]>()
    for (const command of filteredCommands) {
      groups.set(command.group, [...(groups.get(command.group) ?? []), command])
    }
    return [...groups.entries()]
  }, [filteredCommands])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-50 bg-background/70 backdrop-blur-sm ${
        isMobile ? "flex items-start justify-center px-3 pt-4" : "flex items-start justify-center px-4 pt-10"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onOpenChange(false)
        }
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-lg border bg-popover shadow-xl">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <SearchIcon className="size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            placeholder="Search commands"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                onOpenChange(false)
              }
            }}
          />
          <Badge variant="outline" className="font-mono text-[10px]">
            Esc
          </Badge>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {commandGroups.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No commands found.
            </div>
          ) : (
            commandGroups.map(([group, groupCommands]) => (
              <div key={group} className="pb-2">
                <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </div>
                <div className="space-y-1">
                  {groupCommands.map((command) => (
                    <Button
                      key={command.id}
                      type="button"
                      variant="ghost"
                      disabled={command.disabled}
                      className="h-9 w-full justify-between rounded-md px-2 text-left text-sm"
                      onClick={() => {
                        command.onSelect()
                        onOpenChange(false)
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <CommandIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{command.label}</span>
                      </span>
                      {command.shortcut ? (
                        <span className="shrink-0 rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {command.shortcut}
                        </span>
                      ) : null}
                    </Button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
