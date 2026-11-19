import {
  AlertTriangleIcon,
  BracesIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DatabaseIcon,
  GitBranchIcon,
  InfoIcon,
  ListChecksIcon,
  ListTreeIcon,
  ShieldCheckIcon,
  TimerIcon,
  XCircleIcon,
} from "lucide-react"
import { memo, useMemo, useState } from "react"
import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react"

import {
  getYaralRuleMetadata,
} from "../../../domain/yaral"
import {
  getYaralFunctionSignatures,
  YARAL_AGGREGATE_FUNCTION_NAMES,
} from "../../../domain/yaral/functions"
import {
  EDITOR_PANEL_CLASS,
  EDITOR_SECTION_CLASS,
  EditorPanelHeader,
  EditorSectionHeader,
} from "../../../components/editor-layout"
import type {
  YaralDataTableReference,
  YaralRuleMetadata,
  YaralValidationResult,
} from "../../../domain/yaral"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../components/ui/collapsible"
import { Button } from "../../../components/ui/button"
import { EmptyState } from "../../../components/ui/empty-state"
import { ScrollArea } from "../../../components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import { useIsMobile } from "../../../hooks/use-mobile"
import { cn } from "../../../lib/utils"
import {
  INSPECTOR_COLLAPSED_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
} from "../constants"

const YARAL_KNOWN_FUNCTION_NAMES = new Set(
  getYaralFunctionSignatures().map(({ name }) => name.toLowerCase())
)
const INSPECTOR_TEXT_PREVIEW_LIMIT = 49
const INSPECTOR_COMPACT_TEXT_LIMIT = 45
const INSPECTOR_SHORT_TEXT_LIMIT = 35

type RuleInspectorProps = {
  dataTables: DataTableSummary[]
  hasRule: boolean
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onWidthChange: (width: number) => void
  ruleText: string
  treatWarningsAsErrors: boolean
  validation: YaralValidationResult
  width: number
}

type DataTableSummary = {
  description: string | null
  id: string
  name: string
  rows: unknown
}

type RuleFunctionUse = {
  count: number
  kind: string
  name: string
}

function getDataTableRows(table: DataTableSummary | undefined) {
  return Array.isArray(table?.rows) ? table.rows : []
}

function getDataTableColumns(rows: unknown[]) {
  const columns = new Set<string>()

  for (const row of rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      Object.keys(row).forEach((key) => columns.add(key))
    } else {
      columns.add("value")
    }
  }

  return [...columns].sort((left, right) => left.localeCompare(right))
}

function getRuleFacts(ruleText: string) {
  const metadata = getYaralRuleMetadata(ruleText)
  return {
    author: metadata.author ?? "Not set",
    description: metadata.description ?? "No description",
    fields: metadata.fields,
    severity: metadata.severity ?? "Not set",
  }
}

function getRuleFunctionUses(validation: YaralValidationResult) {
  return validation.functionUses
    .filter((functionUse) => YARAL_KNOWN_FUNCTION_NAMES.has(functionUse.name.toLowerCase()))
    .map(({ count, name }) => ({
      count,
      kind: getFunctionKind(name),
      name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function getFunctionKind(name: string) {
  const normalizedName = name.toLowerCase()
  if (YARAL_AGGREGATE_FUNCTION_NAMES.has(normalizedName)) {
    return normalizedName.startsWith("window.") ? "window" : "aggregate"
  }
  return "helper"
}

function formatMitreMetadata(fields: Record<string, string>) {
  const values = [fields.tactic, fields.technique].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  )
  return values.length > 0 ? values.join(" / ") : "Not set"
}

function formatRuleType(ruleType: YaralValidationResult["ruleType"]) {
  if (ruleType === "single_event") {
    return "Single event"
  }
  if (ruleType === "multi_event") {
    return "Multi event"
  }
  return "Unknown"
}

function formatWindowType(windowType: YaralValidationResult["summary"]["matchWindowType"]) {
  if (windowType === "hop") {
    return "Hop"
  }
  if (windowType === "sliding") {
    return "Sliding"
  }
  if (windowType === "tumbling") {
    return "Tumbling"
  }
  return "None"
}

function getMatchWindowDetail(match: YaralValidationResult["match"]) {
  if (!match?.window) {
    return "No window"
  }
  return `${formatWindowType(match.windowType)} ${match.window}`
}

function getMatchWindowDescription(
  match: YaralValidationResult["match"],
  ruleType: YaralValidationResult["ruleType"]
) {
  if (!match?.window) {
    return "No match window is defined."
  }
  if (match.windowType === "tumbling") {
    return ruleType === "multi_event"
      ? `Correlates event variables in fixed ${match.window} buckets when they share the listed match variables.`
      : `Groups matching events into fixed ${match.window} buckets by the listed match variables.`
  }
  if (match.windowType === "sliding") {
    const pivot = match.pivot ?? "the pivot event"
    const direction = match.direction ? ` ${match.direction} ${pivot}` : ""
    return ruleType === "multi_event"
      ? `Correlates event variables in a sliding ${match.window} window${direction} when they share the listed match variables.`
      : `Groups matching events in a sliding ${match.window} window${direction} by the listed match variables.`
  }
  return ruleType === "multi_event"
    ? `Correlates event variables within a rolling ${match.window} window when they share the listed match variables.`
    : `Groups matching events within a rolling ${match.window} window by the listed match variables.`
}

function getMatchVariableDetail(match: YaralValidationResult["match"]) {
  const count = match?.variables.length ?? 0
  return `${count} variable${count === 1 ? "" : "s"}`
}

function getSectionRequirement(
  sectionName: string,
  ruleType: YaralValidationResult["ruleType"]
) {
  if (sectionName === "match") {
    return ruleType === "multi_event" ? "required" : "optional"
  }
  if (sectionName === "options" || sectionName === "outcome") {
    return "optional"
  }
  return null
}

function formatDataTableRowPreview(row: unknown) {
  if (row && typeof row === "object") {
    return JSON.stringify(row)
  }
  return String(row)
}

function compactInspectorText(value: string, limit = INSPECTOR_COMPACT_TEXT_LIMIT) {
  const normalizedValue = value.trim()
  if (normalizedValue.length <= limit) {
    return normalizedValue
  }
  return `${normalizedValue.slice(0, Math.max(0, limit - 3)).trimEnd()}...`
}

function InspectorCompactText({
  className,
  limit = INSPECTOR_COMPACT_TEXT_LIMIT,
  value,
}: {
  className?: string
  limit?: number
  value: string
}) {
  const normalizedValue = value.trim()
  const text = compactInspectorText(normalizedValue, limit)
  const isCompact = normalizedValue.length > limit
  const content = (
    <span className={cn("min-w-0 truncate", className)}>
      {text}
    </span>
  )

  if (!isCompact) {
    return content
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        sideOffset={8}
        className="max-w-[min(24rem,calc(100vw-2rem))] whitespace-normal break-all font-mono text-[11px] leading-5"
      >
        {normalizedValue}
      </TooltipContent>
    </Tooltip>
  )
}

function getDataTableColumnValues(rows: unknown[], column: string | null) {
  const values = rows.flatMap((row) => extractDataTableColumnValues(row, column))
  return values.map(formatDataTableRowPreview)
}

function extractDataTableColumnValues(row: unknown, column: string | null): unknown[] {
  if (!column) {
    return [row]
  }
  if (!row || typeof row !== "object") {
    return column === "value" ? [row] : []
  }
  if (Array.isArray(row)) {
    return row.flatMap((item) => extractDataTableColumnValues(item, column))
  }
  const value = (row as Record<string, unknown>)[column]
  return value === undefined ? [] : [value]
}

function groupDataTableReferences(references: YaralDataTableReference[]) {
  const groups = new Map<string, YaralDataTableReference[]>()
  for (const reference of references) {
    const key = reference.name.toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), reference])
  }
  return [...groups.values()].map((items) => ({
    name: items[0]?.name ?? "",
    references: items.sort((left, right) => {
      const leftColumn = left.column ?? ""
      const rightColumn = right.column ?? ""
      return leftColumn.localeCompare(rightColumn) || left.token.localeCompare(right.token)
    }),
  }))
}

function getMembershipBadgeClass(membership: YaralDataTableReference["membership"]) {
  if (membership === "not in") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700"
  }
  if (membership === "in") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
  }
  return "bg-sidebar-accent/70 text-foreground/65"
}

function formatMembershipLabel(membership: YaralDataTableReference["membership"]) {
  return membership === "reference" ? "reference" : membership
}

function InspectorDisclosure({
  children,
  defaultOpen = false,
  detail,
  title,
}: {
  children: ReactNode
  defaultOpen?: boolean
  detail?: ReactNode
  title: string
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="rounded-md border border-sidebar-border bg-sidebar-accent/55"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full min-w-0 justify-between gap-3 overflow-hidden rounded-md px-3 py-2.5 text-left hover:bg-sidebar-accent"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {isOpen ? (
              <ChevronDownIcon className="size-3.5 shrink-0 text-foreground/60" />
            ) : (
              <ChevronRightIcon className="size-3.5 shrink-0 text-foreground/60" />
            )}
            <InspectorCompactText
              className="font-mono text-[12px] font-semibold text-foreground"
              value={title}
            />
          </span>
          {detail ? (
            <span
              className="min-w-0 max-w-[45%] shrink truncate font-mono text-[11px] text-foreground/70"
            >
              {typeof detail === "string" ? (
                <InspectorCompactText
                  className="font-mono text-[11px] text-foreground/70"
                  limit={INSPECTOR_SHORT_TEXT_LIMIT}
                  value={detail}
                />
              ) : detail}
            </span>
          ) : null}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 border-t border-sidebar-border bg-sidebar/35 px-3 py-2.5">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SourceList({
  emptyLabel = "No source fields",
  sources,
}: {
  emptyLabel?: string
  sources: string[]
}) {
  return (
    <div className="min-w-0 space-y-1 overflow-hidden">
      {sources.length > 0 ? (
        sources.map((source) => (
          <div
            key={source}
          >
            <InspectorCompactText
              className="block font-mono text-[12px] text-foreground/75"
              value={source}
            />
          </div>
        ))
      ) : (
        <p className="font-mono text-[12px] text-foreground/60">
          {emptyLabel}
        </p>
      )}
    </div>
  )
}

function FieldList({
  fields,
  prefix,
}: {
  fields: string[]
  prefix: string
}) {
  return (
    <div className="min-w-0 space-y-1 overflow-hidden">
      {fields.length > 0 ? (
        fields.map((field) => (
          <div key={field}>
            <InspectorCompactText
              className="block font-mono text-[12px] text-foreground/75"
              value={`${prefix}.${field}`}
            />
          </div>
        ))
      ) : (
        <p className="text-[12px] text-foreground/60">
          No fields recorded yet.
        </p>
      )}
    </div>
  )
}

function InspectorInlineText({
  className,
  limit = INSPECTOR_TEXT_PREVIEW_LIMIT,
  value,
}: {
  className?: string
  limit?: number
  value: string | null | undefined
}) {
  const normalizedValue = value?.trim() ?? ""
  const text = normalizedValue ? compactInspectorText(normalizedValue, limit) : "Not set"

  return (
    <InspectorCompactText
      className={cn("block max-w-full", className)}
      limit={limit}
      value={normalizedValue || text}
    />
  )
}

function DataTableInspectorSection({
  dataTableReferences,
  dataTablesByName,
  savedDataTables,
}: {
  dataTableReferences: YaralDataTableReference[]
  dataTablesByName: Map<string, DataTableSummary>
  savedDataTables: DataTableSummary[]
}) {
  const referenceGroups = groupDataTableReferences(dataTableReferences)

  return (
    <section className={EDITOR_SECTION_CLASS}>
      <EditorSectionHeader
        icon={<DatabaseIcon className="size-4" />}
        title="Data Tables"
        meta={`${dataTableReferences.length} reference${
          dataTableReferences.length === 1 ? "" : "s"
        }`}
      />

      {referenceGroups.length > 0 ? (
        <div className="min-w-0 space-y-2 overflow-hidden">
          {referenceGroups.map((group) => {
            const table = dataTablesByName.get(group.name.toLowerCase())
            const rows = getDataTableRows(table)
            const columns = getDataTableColumns(rows)

            return (
              <InspectorDisclosure
                key={group.name}
                defaultOpen={!table || group.references.some((reference) => reference.column && !columns.includes(reference.column))}
                title={group.name}
                detail={
                  table
                    ? `${group.references.length} ref${group.references.length === 1 ? "" : "s"} · ${rows.length} row${rows.length === 1 ? "" : "s"}`
                    : "missing"
                }
              >
                {table ? (
                  <>
                    {table.description ? (
                      <p className="min-w-0 text-[12px] leading-5 text-foreground/65">
                        <InspectorInlineText value={table.description} />
                      </p>
                    ) : null}
                    <div className="min-w-0 space-y-2 overflow-hidden">
                      {group.references.map((reference) => {
                        const hasColumn = !reference.column || columns.includes(reference.column)
                        const values = getDataTableColumnValues(rows, reference.column)
                        return (
                          <InspectorDisclosure
                            key={reference.token}
                            defaultOpen={!hasColumn}
                            title={reference.column ?? "all values"}
                            detail={
                              <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                                <span
                                  className={`rounded border px-1.5 py-0.5 ${getMembershipBadgeClass(reference.membership)}`}
                                >
                                  {formatMembershipLabel(reference.membership)}
                                </span>
                                <span className="min-w-0 truncate">{values.length} value{values.length === 1 ? "" : "s"}</span>
                              </span>
                            }
                          >
                            {!hasColumn ? (
                              <span className="inline-flex w-fit rounded border bg-destructive/10 px-1.5 py-0.5 font-mono text-[11px] text-destructive">
                                missing column
                              </span>
                            ) : null}
                            {values.length > 0 ? (
                              <ScrollArea className="max-h-40 pr-3">
                                <div className="min-w-0 space-y-1 overflow-hidden">
                                  {values.map((value, index) => (
                                    <p
                                      key={`${reference.token}:${index}`}
                                      className="min-w-0 truncate rounded border bg-sidebar-accent/60 px-2 py-1 font-mono text-[11px] text-foreground/70"
                                    >
                                      <InspectorCompactText
                                        className="block font-mono text-[11px] text-foreground/70"
                                        value={value}
                                      />
                                    </p>
                                  ))}
                                </div>
                              </ScrollArea>
                            ) : (
                              <p className="text-[12px] text-foreground/60">
                                {hasColumn
                                  ? "This column has no values yet."
                                  : "This table does not contain that column."}
                              </p>
                            )}
                          </InspectorDisclosure>
                        )
                      })}
                    </div>
                  </>
                ) : (
                  <p className="text-[12px] leading-5 text-destructive">
                    No saved data table named {group.name}. The rule can reference it, but local tests will not match it until the table exists.
                  </p>
                )}
              </InspectorDisclosure>
            )
          })}
        </div>
      ) : (
        <p className="text-[12px] leading-5 text-foreground/60">
          No data tables referenced by this rule.
        </p>
      )}
    </section>
  )
}

function FunctionInspectorSection({
  functionUses,
}: {
  functionUses: RuleFunctionUse[]
}) {
  return (
    <section className={EDITOR_SECTION_CLASS}>
      <EditorSectionHeader
        icon={<ListChecksIcon className="size-4" />}
        title="Functions"
        meta={`${functionUses.length} function${functionUses.length === 1 ? "" : "s"}`}
      />

      {functionUses.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-1.5 overflow-hidden">
          {functionUses.map((functionUse) => (
            <span
              key={functionUse.name}
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded border bg-sidebar-accent/70 px-1.5 py-1 font-mono text-[11px] text-foreground/80"
              title={`${functionUse.name} (${functionUse.kind})`}
            >
              <InspectorCompactText
                className="font-mono text-[11px] text-foreground/80"
                value={functionUse.name}
              />
              <span className="shrink-0 rounded bg-background/70 px-1 text-[10px] text-foreground/55">
                {functionUse.kind}
              </span>
              {functionUse.count > 1 ? (
                <span className="shrink-0 text-foreground/55">x{functionUse.count}</span>
              ) : null}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[12px] leading-5 text-foreground/60">
          No catalogue functions used by this rule.
        </p>
      )}
    </section>
  )
}

export const RuleInspector = memo(function RuleInspector({
  dataTables,
  hasRule,
  isOpen,
  onOpenChange,
  onWidthChange,
  ruleText,
  treatWarningsAsErrors,
  validation,
  width,
}: RuleInspectorProps) {
  const isMobile = useIsMobile()
  const [isResizing, setIsResizing] = useState(false)
  const facts = useMemo(() => getRuleFacts(ruleText), [ruleText])
  const functionUses = useMemo(() => getRuleFunctionUses(validation), [validation])
  const dataTableReferences = validation.dataTableReferences
  const savedDataTables = dataTables
  const dataTablesByName = useMemo(
    () => new Map(savedDataTables.map((table) => [table.name.toLowerCase(), table])),
    [savedDataTables]
  )
  const diagnostics = useMemo(() => validation.diagnostics.slice(0, 8), [validation.diagnostics])
  const { errorCount, warningCount } = useMemo(
    () =>
      validation.diagnostics.reduce(
        (counts, diagnostic) => {
          if (diagnostic.severity === "error") {
            counts.errorCount += 1
          } else if (diagnostic.severity === "warning") {
            counts.warningCount += 1
          }
          return counts
        },
        { errorCount: 0, warningCount: 0 }
      ),
    [validation.diagnostics]
  )
  const eventCount = validation.eventVariables.length
  const joinCount = useMemo(
    () =>
      validation.placeholderVariables.filter((placeholder) => placeholder.isJoin)
        .length,
    [validation.placeholderVariables]
  )
  const content = hasRule ? (
    <RuleInspectorContent
      dataTableReferences={dataTableReferences}
      dataTablesByName={dataTablesByName}
      diagnostics={diagnostics}
      errorCount={errorCount}
      eventCount={eventCount}
      facts={facts}
      functionUses={functionUses}
      joinCount={joinCount}
      savedDataTables={savedDataTables}
      treatWarningsAsErrors={treatWarningsAsErrors}
      validation={validation}
      warningCount={warningCount}
    />
  ) : (
    <NoRuleInspectorState />
  )

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="min-h-0 min-w-0 max-w-full gap-0 overflow-hidden bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetHeader className="border-b border-sidebar-border px-4 py-3">
            <SheetTitle>Rule Inspector</SheetTitle>
            <SheetDescription>
              Rule summary, diagnostics, variables, functions, and data tables.
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="min-h-0 min-w-0 max-w-full flex-1 overflow-hidden [&_[data-slot=scroll-area-viewport]]:overflow-x-hidden">
            {content}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    )
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isOpen) {
      return
    }
    event.preventDefault()
    setIsResizing(true)

    const startWidth = width
    const startX = event.clientX
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    function handlePointerMove(event: PointerEvent) {
      const nextWidth = startWidth + startX - event.clientX
      const clampedWidth = Math.min(
        INSPECTOR_MAX_WIDTH,
        Math.max(INSPECTOR_MIN_WIDTH, nextWidth)
      )

      onWidthChange(clampedWidth)
    }

    function handlePointerUp() {
      setIsResizing(false)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
  }

  if (!isOpen) {
    return (
      <aside
        className={`relative hidden min-w-0 shrink-0 overflow-hidden border-l xl:flex xl:flex-col xl:items-center ${EDITOR_PANEL_CLASS}`}
        style={{ width: `${INSPECTOR_COLLAPSED_WIDTH}px` }}
      >
        <div className="flex h-10 shrink-0 items-center justify-center border-b">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Expand rule inspector"
            onClick={() => onOpenChange(true)}
          >
            <ChevronLeftIcon />
            <span className="sr-only">Expand rule inspector</span>
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center px-1">
          <span className="rotate-180 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground [writing-mode:vertical-rl]">
            Inspector
          </span>
        </div>
      </aside>
    )
  }

  return (
    <aside
      className={`relative hidden min-w-0 shrink-0 overflow-hidden border-l xl:flex xl:flex-col ${EDITOR_PANEL_CLASS}`}
      style={{ width: `${width}px` }}
    >
      <div
        className="group absolute inset-y-0 left-0 z-10 flex w-3 -translate-x-1.5 touch-none cursor-col-resize items-center justify-center"
        onPointerDown={handleResizeStart}
        role="separator"
        aria-label="Resize rule inspector"
        aria-orientation="vertical"
        aria-valuemax={INSPECTOR_MAX_WIDTH}
        aria-valuemin={INSPECTOR_MIN_WIDTH}
        aria-valuenow={width}
      >
        <span
          className={`h-14 w-1 rounded-full bg-border transition-[background-color,opacity] group-hover:bg-muted-foreground/40 ${
            isResizing ? "opacity-100" : "opacity-60"
          }`}
        />
      </div>

      <EditorPanelHeader
        title="Rule Inspector"
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Collapse rule inspector"
            onClick={() => onOpenChange(false)}
          >
            <ChevronRightIcon />
            <span className="sr-only">Collapse rule inspector</span>
          </Button>
        }
      />

      <ScrollArea className="min-h-0 min-w-0 max-w-full flex-1 overflow-hidden [&_[data-slot=scroll-area-viewport]]:overflow-x-hidden">
        {content}
      </ScrollArea>
    </aside>
  )
})

function NoRuleInspectorState() {
  return (
    <div className="w-full min-w-0 max-w-full divide-y overflow-hidden">
      <section className={EDITOR_SECTION_CLASS}>
        <EditorSectionHeader
          icon={<InfoIcon className="size-4" />}
          title="Summary"
        />
        <EmptyState
          className="rounded-md bg-sidebar-accent/55 px-3 py-3"
          description="Open a saved rule or create a new tab to inspect sections, variables, diagnostics, and data-table references."
          title="No rule selected"
        />
      </section>

      <section className={EDITOR_SECTION_CLASS}>
        <EditorSectionHeader
          icon={<ListTreeIcon className="size-4" />}
          title="Structure"
        />
        <p className="text-[12px] text-foreground/60">
          No rule sections to inspect.
        </p>
      </section>
    </div>
  )
}

type RuleInspectorContentProps = {
  dataTableReferences: YaralDataTableReference[]
  dataTablesByName: Map<string, DataTableSummary>
  diagnostics: YaralValidationResult["diagnostics"]
  errorCount: number
  eventCount: number
  facts: Pick<YaralRuleMetadata, "author" | "description" | "fields" | "severity">
  functionUses: ReturnType<typeof getRuleFunctionUses>
  joinCount: number
  savedDataTables: DataTableSummary[]
  treatWarningsAsErrors: boolean
  validation: YaralValidationResult
  warningCount: number
}

const OutcomeVariablesSection = memo(function OutcomeVariablesSection({
  outcomeVariables,
}: {
  outcomeVariables: YaralValidationResult["outcomeVariables"]
}) {
  const outcomeCount = outcomeVariables.length

  return (
    <section className={cn(EDITOR_SECTION_CLASS, "min-w-0 overflow-hidden")}>
      <EditorSectionHeader
        icon={<ListChecksIcon className="size-4" />}
        title="Outcome Variables"
        meta={`${outcomeCount} outcome${outcomeCount === 1 ? "" : "s"}`}
      />
      <ScrollArea className="max-h-[360px] pr-3">
        <div className="min-w-0 space-y-1.5 overflow-hidden">
        {outcomeVariables.length > 0 ? (
          outcomeVariables.map((outcome) => (
            <InspectorDisclosure
              key={outcome.name}
              title={`$${outcome.name}`}
              detail={
                outcome.sources.length > 0
                  ? `${outcome.sources.length} source${outcome.sources.length === 1 ? "" : "s"}`
                  : "constant"
              }
            >
              <p className="text-[10px] font-semibold uppercase tracking-normal text-foreground/60">
                Referenced fields
              </p>
              <SourceList sources={outcome.sources} />
            </InspectorDisclosure>
          ))
        ) : (
          <p className="text-[12px] text-foreground/60">
            No outcome variables found yet.
          </p>
        )}
        </div>
      </ScrollArea>
    </section>
  )
})

const MatchWindowSection = memo(function MatchWindowSection({
  match,
  ruleType,
}: {
  match: YaralValidationResult["match"]
  ruleType: YaralValidationResult["ruleType"]
}) {
  return (
    <section className={cn(EDITOR_SECTION_CLASS, "min-w-0 overflow-hidden")}>
      <EditorSectionHeader
        icon={<TimerIcon className="size-4" />}
        title="Match Window"
        meta={getMatchWindowDetail(match)}
      />
      {match ? (
        <div className="min-w-0 space-y-3 overflow-hidden">
          <p className="text-[12px] leading-5 text-foreground/70">
            {getMatchWindowDescription(match, ruleType)}
          </p>
          <dl className="grid min-w-0 grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2 overflow-hidden text-[12px]">
            <dt className="text-foreground/55">Type</dt>
            <dd className="min-w-0 truncate font-mono text-foreground/85" title={formatWindowType(match.windowType)}>
              {formatWindowType(match.windowType)}
            </dd>
            <dt className="text-foreground/55">Window</dt>
            <dd className="min-w-0 truncate font-mono text-foreground/85" title={match.window ?? "None"}>
              {match.window ?? "None"}
            </dd>
            <dt className="text-foreground/55">Variables</dt>
            <dd className="flex min-w-0 flex-wrap gap-1 overflow-hidden">
              {match.variables.length > 0 ? (
                match.variables.map((variable) => (
                  <span
                    key={variable}
                    className="min-w-0 max-w-full rounded border bg-sidebar-accent/70 px-1.5 py-0.5"
                  >
                    <InspectorCompactText
                      className="font-mono text-[11px] text-foreground/80"
                      value={variable}
                    />
                  </span>
                ))
              ) : (
                <span className="font-mono text-foreground/60">None</span>
              )}
            </dd>
            {match.pivot ? (
              <>
                <dt className="text-foreground/55">Pivot</dt>
                <dd className="font-mono text-foreground/85">
                  <InspectorInlineText
                    className="font-mono"
                    value={match.direction ? `${match.direction} ${match.pivot}` : match.pivot}
                  />
                </dd>
              </>
            ) : null}
          </dl>
          <p className="text-[10px] leading-4 text-foreground/45">
            {getSectionRequirement("match", ruleType)}
            {" · "}
            {getMatchVariableDetail(match)}
          </p>
        </div>
      ) : (
        <p className="text-[12px] leading-5 text-foreground/60">
          No match window is defined for this rule.
        </p>
      )}
    </section>
  )
})

const RuleInspectorContent = memo(function RuleInspectorContent({
  dataTableReferences,
  dataTablesByName,
  diagnostics,
  errorCount,
  eventCount,
  facts,
  functionUses,
  joinCount,
  savedDataTables,
  treatWarningsAsErrors,
  validation,
  warningCount,
}: RuleInspectorContentProps) {
  return (
    <div className="w-full min-w-0 max-w-full divide-y overflow-hidden">
          <section className={cn(EDITOR_SECTION_CLASS, "min-w-0 overflow-hidden")}>
            <EditorSectionHeader
              icon={<InfoIcon className="size-4" />}
              title="Summary"
            />
            <dl className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 overflow-hidden text-[12px]">
              <dt className="text-foreground/60">Rule</dt>
              <dd className="min-w-0 font-mono text-foreground/90">
                <InspectorInlineText value={validation.ruleName ?? "Unnamed"} />
              </dd>
              <dt className="text-foreground/60">Description</dt>
              <dd className="min-w-0 max-w-full overflow-hidden text-foreground/75">
                <InspectorInlineText
                  className="max-w-[18ch]"
                  value={facts.description}
                />
              </dd>
              <dt className="text-foreground/60">Severity</dt>
              <dd className="min-w-0 font-mono text-foreground/90">
                <InspectorInlineText value={facts.severity} />
              </dd>
              <dt className="text-foreground/60">Author</dt>
              <dd className="min-w-0 font-mono text-foreground/90">
                <InspectorInlineText value={facts.author} />
              </dd>
              <dt className="text-foreground/60">MITRE</dt>
              <dd className="min-w-0 font-mono text-foreground/90">
                <InspectorInlineText value={formatMitreMetadata(facts.fields)} />
              </dd>
              <dt className="text-foreground/60">Type</dt>
              <dd className="min-w-0 font-mono text-foreground/90">
                <InspectorInlineText value={formatRuleType(validation.ruleType)} />
              </dd>
            </dl>
          </section>

          <section className={cn(EDITOR_SECTION_CLASS, "min-w-0 overflow-hidden")}>
            <EditorSectionHeader
              icon={<ListTreeIcon className="size-4" />}
              title="Structure"
            />
            <div className="min-w-0 space-y-2 overflow-hidden">
              {validation.sections.map((section) => (
                <div
                  key={section.name}
                  className="flex min-w-0 items-start justify-between gap-3 overflow-hidden text-[12px]"
                >
                  <div className="min-w-0 overflow-hidden">
                    <InspectorCompactText
                      className="block font-mono text-foreground/80"
                      limit={INSPECTOR_SHORT_TEXT_LIMIT}
                      value={`${section.name}:`}
                    />
                    {getSectionRequirement(section.name, validation.ruleType) ? (
                      <p className="mt-0.5 text-[10px] leading-3 text-foreground/45">
                        {getSectionRequirement(section.name, validation.ruleType)}
                      </p>
                    ) : null}
                  </div>
                  {section.present ? (
                    <CheckCircle2Icon className="size-4 text-emerald-500" />
                  ) : (
                    <span className="shrink-0 text-foreground/45">
                      {getSectionRequirement(section.name, validation.ruleType) === "optional"
                        ? "not used"
                        : "missing"}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className={cn(EDITOR_SECTION_CLASS, "min-w-0 overflow-hidden")}>
            <EditorSectionHeader
              icon={<ShieldCheckIcon className="size-4" />}
              title="Validation"
              meta={`${errorCount} error${errorCount === 1 ? "" : "s"} / ${warningCount} warning${
                warningCount === 1 ? "" : "s"
              }`}
            />
            <div className="min-w-0 space-y-1.5 overflow-hidden">
              {diagnostics.length === 0 ? (
                <div
                  className="flex min-w-0 items-start justify-between gap-3 overflow-hidden font-mono text-[12px]"
                >
                  <span className="min-w-0 truncate text-foreground/75">
                    No validation issues found.
                  </span>
                  <CheckCircle2Icon className="mt-px size-3.5 shrink-0 text-emerald-500" />
                </div>
              ) : (
                diagnostics.map((diagnostic, index) => (
                  <div
                    key={`${diagnostic.line}:${diagnostic.column}:${index}`}
                    className="flex min-w-0 items-start justify-between gap-3 overflow-hidden font-mono text-[12px]"
                  >
                    <span
                      className="min-w-0 truncate text-foreground/75"
                    >
                      <InspectorCompactText
                        className="font-mono text-[12px] text-foreground/75"
                        value={`Line ${diagnostic.line}, column ${diagnostic.column}: ${diagnostic.message}`}
                      />
                    </span>
                    {diagnostic.severity === "error" ||
                    (treatWarningsAsErrors &&
                      diagnostic.severity === "warning") ? (
                      <XCircleIcon className="mt-px size-3.5 shrink-0 text-destructive" />
                    ) : (
                      <AlertTriangleIcon className="mt-px size-3.5 shrink-0 text-amber-500" />
                    )}
                  </div>
                ))
              )}
              {validation.diagnostics.length > diagnostics.length ? (
                <p className="font-mono text-[11px] text-foreground/50">
                  Showing first {diagnostics.length} of{" "}
                  {validation.diagnostics.length} issues.
                </p>
              ) : null}
            </div>
          </section>

          <section className={cn(EDITOR_SECTION_CLASS, "min-w-0 overflow-hidden")}>
            <EditorSectionHeader
              icon={<BracesIcon className="size-4" />}
              title="Events"
              meta={`${eventCount} event${eventCount === 1 ? "" : "s"}`}
            />
            <div className="min-w-0 space-y-2 overflow-hidden">
              {validation.eventVariables.length > 0 ? (
                validation.eventVariables.map((eventVariable) => (
                  <InspectorDisclosure
                    key={eventVariable.name}
                    title={`$${eventVariable.name}`}
                    detail={`${eventVariable.filterCount} filter${
                      eventVariable.filterCount === 1 ? "" : "s"
                    }`}
                  >
                    <div className="min-w-0 space-y-1.5 overflow-hidden">
                      <p className="text-[10px] font-semibold uppercase tracking-normal text-foreground/60">
                        Event types
                      </p>
                      <div className="flex min-w-0 flex-wrap gap-1.5 overflow-hidden">
                        {eventVariable.eventTypes.length > 0 ? (
                          eventVariable.eventTypes.map((eventType) => (
                            <span
                              key={eventType}
                              className="min-w-0 max-w-full rounded border bg-sidebar-accent/70 px-1.5 py-0.5"
                            >
                              <InspectorCompactText
                                className="font-mono text-[11px] text-foreground/75"
                                value={eventType}
                              />
                            </span>
                          ))
                        ) : (
                          <span className="font-mono text-[11px] text-foreground/55">
                            no event_type
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 space-y-1.5 overflow-hidden">
                      <p className="text-[10px] font-semibold uppercase tracking-normal text-foreground/60">
                        Log types
                      </p>
                      <div className="flex min-w-0 flex-wrap gap-1.5 overflow-hidden">
                        {eventVariable.logTypes.length > 0 ? (
                          eventVariable.logTypes.map((logType) => (
                            <span
                              key={logType}
                              className="min-w-0 max-w-full rounded border bg-sidebar-accent/70 px-1.5 py-0.5"
                            >
                              <InspectorCompactText
                                className="font-mono text-[11px] text-foreground/75"
                                value={logType}
                              />
                            </span>
                          ))
                        ) : (
                          <span className="font-mono text-[11px] text-foreground/55">
                            no log_type
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 space-y-1.5 overflow-hidden">
                      <p className="text-[10px] font-semibold uppercase tracking-normal text-foreground/60">
                        Referenced fields
                      </p>
                      <FieldList fields={eventVariable.fields} prefix={`$${eventVariable.name}`} />
                    </div>
                  </InspectorDisclosure>
                ))
              ) : (
                <p className="text-[12px] text-foreground/60">
                  No event variables found yet.
                </p>
              )}
            </div>
          </section>

          <MatchWindowSection match={validation.match} ruleType={validation.ruleType} />

          <OutcomeVariablesSection outcomeVariables={validation.outcomeVariables} />

          <section className={cn(EDITOR_SECTION_CLASS, "min-w-0 overflow-hidden")}>
            <EditorSectionHeader
              icon={<GitBranchIcon className="size-4" />}
              title="Placeholder Variables"
              meta={`${validation.placeholderVariables.length} placeholder${
                validation.placeholderVariables.length === 1 ? "" : "s"
              } / ${joinCount} join${joinCount === 1 ? "" : "s"}`}
            />
            <div className="min-w-0 space-y-1.5 overflow-hidden">
              {validation.placeholderVariables.length > 0 ? (
                validation.placeholderVariables.slice(0, 8).map((placeholder) => (
                  <InspectorDisclosure
                    key={placeholder.name}
                    title={`$${placeholder.name}`}
                    detail={placeholder.isJoin ? "join" : placeholder.eventVariables.map((eventVariable) => `$${eventVariable}`).join(", ")}
                  >
                    <div className="min-w-0 space-y-1 overflow-hidden">
                      <p className="text-[10px] font-semibold uppercase tracking-normal text-foreground/60">
                        Event variables
                      </p>
                      <p
                        className="min-w-0 truncate font-mono text-[12px] text-foreground/75"
                      >
                        {placeholder.eventVariables.length > 0
                          ? (
                            <InspectorCompactText
                              className="font-mono text-[12px] text-foreground/75"
                              value={placeholder.eventVariables.map((eventVariable) => `$${eventVariable}`).join(", ")}
                            />
                          )
                          : "None recorded"}
                      </p>
                    </div>
                    <p className="text-[10px] font-semibold uppercase tracking-normal text-foreground/60">
                      Source expressions
                    </p>
                    <SourceList sources={placeholder.sources} />
                  </InspectorDisclosure>
                ))
              ) : (
                <p className="text-[12px] text-foreground/60">
                  No placeholder variables found yet.
                </p>
              )}
            </div>
          </section>

          <FunctionInspectorSection functionUses={functionUses} />

          <DataTableInspectorSection
            dataTableReferences={dataTableReferences}
            dataTablesByName={dataTablesByName}
            savedDataTables={savedDataTables}
          />

    </div>
  )
})
