import { HardDriveIcon } from "lucide-react"

type StatusBarProps = {
  cursorColumn: number
  cursorLine: number
  sourceContext: {
    label: string
    segments?: Array<{ label: string; title: string }>
    sourceType: "local"
    title: string
  }
}

export function StatusBar({
  cursorColumn,
  cursorLine,
  sourceContext,
}: StatusBarProps) {
  const SourceIcon = HardDriveIcon
  const sourceLabel = "Local source"
  const sourceSegments = sourceContext.segments?.length
    ? sourceContext.segments
    : [{ label: sourceContext.label, title: sourceContext.title }]

  return (
    <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-2 py-1 font-mono text-[11px] font-medium text-foreground/75 subpixel-antialiased sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <span
          className="flex min-w-0 max-w-[min(40rem,48vw)] items-center gap-1.5 overflow-hidden text-foreground/70"
          title={sourceContext.title}
        >
          <SourceIcon aria-label={sourceLabel} className="size-3.5 shrink-0" />
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            {sourceSegments.map((segment, index) => (
              <span key={`${segment.label}-${index}`} className="contents">
                {index > 0 ? <span className="shrink-0 text-muted-foreground/75">·</span> : null}
                <span
                  className="min-w-0 max-w-[12rem] truncate first:max-w-[10rem]"
                  title={segment.title}
                >
                  {segment.label}
                </span>
              </span>
            ))}
          </span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3 sm:gap-4">
        <span>
          Ln {cursorLine}, Col {cursorColumn}
        </span>
        <span>UTF-8</span>
        <span>LF</span>
      </div>
    </div>
  )
}
