import {
  AlertTriangleIcon,
  BracesIcon,
  CalendarIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleXIcon,
  CopyIcon,
  DownloadIcon,
  EraserIcon,
  FlaskConicalIcon,
  ImportIcon,
  InfoIcon,
  ListChecksIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react"
import { toast } from "sonner"
import {
  deleteUdmEventSet,
  getUdmEventSets,
  saveUdmEventSet,
  useQuery,
} from "wasp/client/operations"

import { useIsMobile } from "../../../hooks/use-mobile"
import { getPublicErrorMessage } from "../../../lib/public-errors"
import type {
  YaralEvaluationDataTable,
  YaralEvaluationMatch,
  YaralEvaluationResult,
} from "../../../domain/yaral"
import {
  createCustomFixtureEvents,
  createUdmTimestamp,
  generateRuleDerivedTestEvents,
  MAX_FIXTURE_BUILDER_EVENTS,
} from "../../../domain/yaral/fixtures/rule-derived-fixture"
import {
  getUdmFieldLiteralKind,
  UDM_FIELD_PATHS,
} from "../../../domain/udm/fields"
import { getUdmFieldAllowedValues } from "../../../domain/udm/field-values"
import { UDM_EVENT_TYPES } from "../../../domain/udm/event-types"
import type {
  RuleDerivedGeneration,
  UdmTimestamp,
} from "../../../domain/yaral/fixtures/rule-derived-fixture"
import {
  captureExpectedResults,
  compareExpectedResult,
  getMatchedEventCounts,
  parseFixtureExpectedResults,
  summarizeExpectedResults,
} from "../../../domain/yaral/testing/expected-results"
import type {
  FixtureExpectedResults,
  RuleExpectedResult,
} from "../../../domain/yaral/testing/expected-results"
import {
  getJsonPathValue as getNestedValue,
  isJsonRecord as isRecord,
  parseJsonTimestampMs as parseTimestampMs,
  sortJsonValue as sortJson,
  validateJsonValueSafety,
  validateUdmEvents,
} from "../../../domain/yaral/testing/input-validation"
import type { RuleTestRunResult } from "../../../domain/yaral/testing/run-rule-test"
import { Badge } from "../../../components/ui/badge"
import { Button } from "../../../components/ui/button"
import { Calendar } from "../../../components/ui/calendar"
import { Checkbox } from "../../../components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../components/ui/collapsible"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../../../components/ui/command"
import { ConfirmDialog } from "../../../components/ui/confirm-dialog"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../../components/ui/dialog"
import { EmptyState } from "../../../components/ui/empty-state"
import { Input } from "../../../components/ui/input"
import { Label } from "../../../components/ui/label"
import { LoadingIndicator, LoadingShimmer } from "../../../components/ui/loading-indicator"
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover"
import { ScrollArea } from "../../../components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../components/ui/tabs"
import { Textarea } from "../../../components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import {
  INSPECTOR_COLLAPSED_WIDTH,
  OUTPUT_PANEL_MAX_HEIGHT,
  OUTPUT_PANEL_MIN_HEIGHT,
} from "../constants"

const OUTPUT_PANEL_EMPTY_HEIGHT = 210
const OUTPUT_PANEL_MATCH_HEIGHT = 210
const SAVED_OBJECT_DESCRIPTION_MAX_LENGTH = 2_000
const SAVED_OBJECT_NAME_MAX_LENGTH = 128
const TEST_CASE_FOLDER_MAX_LENGTH = 64

type OutputPanelProps = {
  activeSavedRuleId: string | null
  dataTables: YaralEvaluationDataTable[]
  hasRule: boolean
  height: number
  isTestConfigOpen: boolean
  isRunningTest: boolean
  isOpen: boolean
  onCancelRunTest: () => void
  onHeightChange: (height: number) => void
  onOpenChange: (open: boolean) => void
  onRestoreHistoryResult?: (result: RuleTestRunResult) => void
  onTestConfigOpenChange: (open: boolean) => void
  onClearResult: () => void
  getRuleText: () => string
  onRunTest: (sampleEvents: unknown[], dataTables?: YaralEvaluationDataTable[]) => void
  result: RuleTestRunResult | null
  ruleText: string
  testHistory?: TestRunHistoryRecord[]
}

type TestRunHistoryRecord = {
  eventCount: number
  fixtureCount: number
  id: string
  matched: boolean
  matchCount: number
  result: RuleTestRunResult
  ruleName: string
  ranAt: string
}

const MAX_RENDERED_MATCHES = 20
const MAX_RENDERED_OUTCOMES = 20
const QUICK_TIMELINE_EVENT_LIMIT = 100

type SampleFixture = {
  description: string | null
  expectedResults: FixtureExpectedResults | null
  id: string
  name: string
  savedRuleId: string | null
  text: string
  updatedAt?: Date | string
}

type UdmEventSetSummary = {
  createdAt?: Date | string
  description: string | null
  events: unknown
  expectedResults: unknown
  id: string
  name: string
  savedRuleId: string | null
  updatedAt?: Date | string
}

type ParsedSampleEvents =
  | { events: unknown[]; error: null }
  | { events: null; error: string }

type RuleDerivedGenerationSummary = {
  constraintCount: number
  dataTableCount: number
  eventCount: number
  eventVariableCount: number
  failureReason: string | null
  ruleName: string | null
}

type CustomFixtureEventOptions = {
  eventType?: string
  fields?: CustomEventFieldInput[]
  startTime?: number
}

type CustomEventFieldInput = {
  id: string
  path: string
  value: string
}

const UNSAVED_FIXTURE_ID = "unsaved"
const FIELD_PICKER_RESULT_LIMIT = 120
const CUSTOM_EVENT_FIELD_PATHS = UDM_FIELD_PATHS
  .filter((path) => {
    if (
      path === "metadata.event_type" ||
      path === "metadata.event_timestamp" ||
      path.startsWith("metadata.event_timestamp.")
    ) {
      return false
    }
    return getUdmFieldLiteralKind(path) !== null || getUdmFieldAllowedValues(path).length > 0
  })
  .sort((left, right) => left.localeCompare(right))

function createWorkingFixture() {
  const userLoginEvent = {
    metadata: {
      event_timestamp: { nanos: 0, seconds: 1767258000 },
      event_type: "USER_LOGIN",
      product_name: "Windows Security",
      vendor_name: "Microsoft",
    },
    principal: {
      hostname: "WORKSTATION-1",
      ip: ["10.0.5.20"],
      user: {
        userid: "alice@example.com",
      },
    },
    security_result: {
      action: "ALLOW",
      summary: "Starter login event",
    },
  }

  return {
    description: "Positive test case for the starter user login rule.",
    name: "User login test case",
    text: JSON.stringify([userLoginEvent], null, 2),
  }
}

function createRuleFixtureDraftName() {
  return `Generated draft ${new Date().toISOString().slice(11, 19).replace(/:/g, "")}`
}

function getFixtureSortGroup(savedRuleId: string | null, activeSavedRuleId: string | null) {
  if (savedRuleId && savedRuleId === activeSavedRuleId) {
    return 0
  }
  if (!savedRuleId) {
    return 1
  }
  return 2
}

function getFixtureSaveRuleId(
  fixtures: SampleFixture[],
  selectedFixtureId: string,
  activeSavedRuleId: string | null
) {
  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId)
  if (selectedFixtureId === UNSAVED_FIXTURE_ID || !selectedFixture?.savedRuleId) {
    return activeSavedRuleId
  }
  return selectedFixture.savedRuleId
}

function getMostRecentFixtureId(fixtures: SampleFixture[]) {
  return [...fixtures].sort(
    (left, right) =>
      getFixtureTimestamp(right) - getFixtureTimestamp(left) ||
      right.name.localeCompare(left.name)
  )[0]?.id ?? UNSAVED_FIXTURE_ID
}

function getFixtureTimestamp(fixture: SampleFixture) {
  if (!fixture.updatedAt) {
    return 0
  }
  const timestamp = new Date(fixture.updatedAt).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function buildRuleDerivedFixtureDescription(generated: RuleDerivedGeneration) {
  return `Generated draft from ${generated.ruleName ?? "active rule"}. Review and save as a static test case before using it for regression coverage. ${generated.events.length} event${generated.events.length === 1 ? "" : "s"}, ${generated.constraints.length} constraint${generated.constraints.length === 1 ? "" : "s"}.`
}

function toDateTimeLocalInput(timestampMs: number) {
  const localTimestampMs = timestampMs - new Date(timestampMs).getTimezoneOffset() * 60_000
  return new Date(localTimestampMs).toISOString().slice(0, 16)
}

function parseDateTimeLocalInput(value: string) {
  const timestampMs = new Date(value).getTime()
  return Number.isFinite(timestampMs) ? timestampMs : null
}

function getDateTimeLocalDatePart(value: string) {
  return value.split("T")[0] ?? ""
}

function getDateTimeLocalTimePart(value: string) {
  return (value.split("T")[1] ?? "").slice(0, 8)
}

function mergeDateTimeLocalParts(date: string, time: string) {
  if (!date || !time) {
    return ""
  }
  return `${date}T${time}`
}

function addMinutesToDateTimeLocal(value: string, minutes: number) {
  const timestampMs = parseDateTimeLocalInput(value)
  if (timestampMs === null) {
    return value
  }
  return toDateTimeLocalInput(timestampMs + minutes * 60_000)
}

function getNextFixtureEventDateTime(events: unknown[] | null) {
  const lastTimestampMs = [...(events ?? [])]
    .map(getEventTimestampMs)
    .filter((timestamp): timestamp is number => Number.isFinite(timestamp))
    .sort((left, right) => right - left)[0]

  return toDateTimeLocalInput(
    lastTimestampMs === undefined ? Date.UTC(2026, 0, 1, 9, 0, 0) : lastTimestampMs + 60_000
  )
}

function getDefaultCustomEventFieldPath() {
  return CUSTOM_EVENT_FIELD_PATHS.includes("principal.hostname")
    ? "principal.hostname"
    : CUSTOM_EVENT_FIELD_PATHS[0] ?? "metadata.product_name"
}

function getEventFieldAllowedValues(path: string) {
  return path === "metadata.event_type" ? UDM_EVENT_TYPES : getUdmFieldAllowedValues(path)
}

function getDefaultFieldValue(path: string) {
  const allowedValues = getEventFieldAllowedValues(path)
  if (allowedValues.length > 0) {
    return allowedValues[0] ?? ""
  }
  const kind = getUdmFieldLiteralKind(path)
  if (kind === "boolean") {
    return "false"
  }
  return ""
}

function createDefaultCustomEventField(id = "field-0"): CustomEventFieldInput {
  const path = getDefaultCustomEventFieldPath()
  return { id, path, value: getDefaultFieldValue(path) }
}

function hasValidEventType(eventType: string) {
  return UDM_EVENT_TYPES.includes(eventType as (typeof UDM_EVENT_TYPES)[number])
}

function hasValidFieldValue(path: string, value: string) {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    return true
  }
  const allowedValues = getEventFieldAllowedValues(path)
  if (allowedValues.length > 0) {
    return allowedValues.includes(trimmedValue)
  }
  const kind = getUdmFieldLiteralKind(path)
  if (kind === "boolean") {
    return trimmedValue === "true" || trimmedValue === "false"
  }
  if (kind === "number") {
    return Number.isFinite(Number(trimmedValue))
  }
  return true
}

function coerceFieldValue(path: string, value: string): string | number | boolean {
  const trimmedValue = value.trim()
  const kind = getUdmFieldLiteralKind(path)
  if (kind === "boolean") {
    return trimmedValue === "true"
  }
  if (kind === "number") {
    return Number(trimmedValue)
  }
  return trimmedValue
}

function applyCustomEventOverrides(
  event: unknown,
  options: CustomFixtureEventOptions
) {
  const startTime = options.startTime
  let nextEvent = event
  if (Number.isFinite(startTime)) {
    nextEvent = setEventTimestamp(nextEvent, startTime as number)
  }

  if (!isRecord(nextEvent)) {
    return nextEvent
  }

  const next: Record<string, unknown> = { ...nextEvent }
  const metadata: Record<string, unknown> = isRecord(next.metadata) ? { ...next.metadata } : {}
  const eventType = options.eventType?.trim()
  if (eventType) {
    metadata.event_type = eventType
  }
  next.metadata = metadata

  for (const field of options.fields ?? []) {
    const value = field.value.trim()
    if (!field.path || !value) {
      continue
    }
    setNestedEventValue(next, field.path, coerceFieldValue(field.path, value))
  }

  return next
}

function setNestedEventValue(
  event: Record<string, unknown>,
  path: string,
  value: string | number | boolean
) {
  const parts = path.split(".").map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) {
    return
  }
  let cursor = event
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part]
    if (isRecord(existing)) {
      const next = { ...existing }
      cursor[part] = next
      cursor = next
    } else {
      const next: Record<string, unknown> = {}
      cursor[part] = next
      cursor = next
    }
  }
  cursor[parts[parts.length - 1]] = value
}

function setEventTimestamp(event: unknown, timestampMs: number) {
  if (!isRecord(event)) {
    return event
  }
  const next: Record<string, unknown> = { ...event }
  const metadata: Record<string, unknown> = isRecord(next.metadata) ? { ...next.metadata } : {}
  metadata.event_timestamp = createUdmTimestamp(timestampMs)
  next.metadata = metadata
  return next
}

function setEventFieldValue(event: unknown, path: string, value: unknown) {
  if (!isRecord(event)) {
    return event
  }
  const parts = parseEventFieldPath(path)
  if (parts.length === 0) {
    return event
  }
  const next = JSON.parse(JSON.stringify(event)) as Record<string, unknown>
  let cursor: unknown = next
  for (const part of parts.slice(0, -1)) {
    if (typeof part === "number") {
      if (!Array.isArray(cursor)) {
        return next
      }
      cursor = cursor[part]
      continue
    }
    if (!isRecord(cursor)) {
      return next
    }
    const existing = cursor[part]
    if (!isRecord(existing) && !Array.isArray(existing)) {
      cursor[part] = {}
    }
    cursor = cursor[part]
  }
  const last = parts[parts.length - 1]
  if (typeof last === "number") {
    if (Array.isArray(cursor)) {
      cursor[last] = value
    }
    return next
  }
  if (isRecord(cursor)) {
    cursor[last] = value
  }
  return next
}

function parseEventFieldPath(path: string) {
  const parts: Array<string | number> = []
  for (const segment of path.split(".").filter(Boolean)) {
    const match = /^([^\[]+)((?:\[\d+\])*)$/.exec(segment)
    if (!match) {
      return []
    }
    parts.push(match[1])
    for (const indexMatch of match[2].matchAll(/\[(\d+)\]/g)) {
      parts.push(Number(indexMatch[1]))
    }
  }
  return parts
}

function summarizeRuleDerivedGeneration(generated: RuleDerivedGeneration): RuleDerivedGenerationSummary {
  return {
    constraintCount: generated.constraints.length,
    dataTableCount: generated.dataTables.length,
    eventCount: generated.events.length,
    eventVariableCount: generated.eventVariableCount,
    failureReason: getRuleDerivedGenerationFailureReason(generated),
    ruleName: generated.ruleName,
  }
}

function getRuleDerivedGenerationFailureReason(generated: RuleDerivedGeneration) {
  if (generated.events.length > 0) {
    return null
  }
  if (generated.eventVariableCount === 0) {
    return "No event variables were found in this rule. Add an events section before generating a test case."
  }
  return "The rule has event variables, but no test events could be created from the detected constraints."
}

function isRuleDerivedFixtureDraft(name: string, description: string) {
  return (
    name.startsWith("Generated draft") ||
    description.startsWith("Generated draft from active rule.") ||
    description.startsWith("Generated from active rule.") ||
    description.startsWith("Rule-derived")
  )
}

export function OutputPanel({
  activeSavedRuleId,
  dataTables,
  hasRule,
  height,
  isTestConfigOpen,
  isRunningTest,
  isOpen,
  getRuleText,
  onCancelRunTest,
  onClearResult,
  onHeightChange,
  onOpenChange,
  onRestoreHistoryResult,
  onTestConfigOpenChange,
  onRunTest,
  result,
  ruleText,
  testHistory = [],
}: OutputPanelProps) {
  const workingFixture = useMemo(() => createWorkingFixture(), [])
  const isMobile = useIsMobile()
  const [isResizing, setIsResizing] = useState(false)
  const [hasUserResizedPanel, setHasUserResizedPanel] = useState(false)
  const hasExplicitNewFixtureRef = useRef(false)
  const [sampleEventsText, setSampleEventsText] = useState(workingFixture.text)
  const [fixtureName, setFixtureName] = useState(workingFixture.name)
  const [fixtureDescription, setFixtureDescription] = useState(workingFixture.description)
  const [fixtureFolder, setFixtureFolder] = useState("")
  const [selectedFixtureId, setSelectedFixtureId] = useState(UNSAVED_FIXTURE_ID)
  const [parseError, setParseError] = useState<string | null>(null)
  const [expectedResults, setExpectedResults] = useState<FixtureExpectedResults | null>(null)
  const [generationSummary, setGenerationSummary] = useState<RuleDerivedGenerationSummary | null>(null)
  const [isSavingFixture, setIsSavingFixture] = useState(false)
  const [testPanelTab, setTestPanelTab] = useState("results")
  const [isExpandedResultsOpen, setIsExpandedResultsOpen] = useState(false)
  const [resultFilter, setResultFilter] = useState("")
  const [isDeleteFixtureConfirmOpen, setIsDeleteFixtureConfirmOpen] = useState(false)
  const [hiddenOutcomeNames, setHiddenOutcomeNames] = useState<Set<string>>(() => new Set())
  const { data: dbFixtures = [], refetch: refetchFixtures } = useQuery(getUdmEventSets)
  const fixtures = useMemo(
    () =>
      (dbFixtures as UdmEventSetSummary[])
        .map((fixture) => ({
          description: fixture.description,
          expectedResults: parseFixtureExpectedResults(fixture.expectedResults),
          id: fixture.id,
          name: fixture.name,
          savedRuleId: fixture.savedRuleId ?? null,
          text: JSON.stringify(fixture.events, null, 2),
          updatedAt: fixture.updatedAt,
        }))
        .sort((left, right) =>
          getFixtureSortGroup(left.savedRuleId, activeSavedRuleId) -
            getFixtureSortGroup(right.savedRuleId, activeSavedRuleId) ||
          left.name.localeCompare(right.name)
        ),
    [activeSavedRuleId, dbFixtures]
  )
  const parsedSample = useMemo(() => parseSampleEvents(sampleEventsText), [sampleEventsText])
  const sampleStats = useMemo(
    () => (parsedSample.events ? summarizeSampleEvents(parsedSample.events) : null),
    [parsedSample]
  )
  const outcomeNames = useMemo(() => collectOutcomeNames(result), [result])
  const hasMatchedResult = result?.rules.some((rule) => rule.result.matched) ?? false
  const compactPanelHeight = hasMatchedResult ? OUTPUT_PANEL_MATCH_HEIGHT : OUTPUT_PANEL_EMPTY_HEIGHT
  const panelDisplayHeight = hasUserResizedPanel ? height : Math.min(height, compactPanelHeight)
  const panelFrameStyle = {
    height: isMobile
      ? `clamp(10rem, 26svh, ${panelDisplayHeight}px)`
      : `${panelDisplayHeight}px`,
  }

  useEffect(() => {
    if (fixtures.length === 0) {
      if (selectedFixtureId !== UNSAVED_FIXTURE_ID) {
        resetWorkingFixture()
      }
      return
    }

    if (selectedFixtureId !== UNSAVED_FIXTURE_ID) {
      if (!fixtures.some((fixture) => fixture.id === selectedFixtureId)) {
        handleLoadFixture(getMostRecentFixtureId(fixtures))
      }
      return
    }

    const isEmptyUnsavedPlaceholder =
      !hasExplicitNewFixtureRef.current &&
      fixtureName === workingFixture.name &&
      fixtureDescription === workingFixture.description &&
      fixtureFolder === "" &&
      sampleEventsText === workingFixture.text

    if (isEmptyUnsavedPlaceholder) {
      handleLoadFixture(getMostRecentFixtureId(fixtures))
    }
  }, [fixtures, fixtureDescription, fixtureFolder, fixtureName, sampleEventsText, selectedFixtureId, workingFixture])

  useEffect(() => {
    setHiddenOutcomeNames((previous) => {
      if (previous.size === 0) {
        return previous
      }
      const knownOutcomes = new Set(outcomeNames)
      const next = new Set([...previous].filter((name) => knownOutcomes.has(name)))
      return next.size === previous.size ? previous : next
    })
  }, [outcomeNames])

  function resetWorkingFixture(message?: string) {
    hasExplicitNewFixtureRef.current = false
    setSelectedFixtureId(UNSAVED_FIXTURE_ID)
    setFixtureName(workingFixture.name)
    setFixtureDescription(workingFixture.description)
    setFixtureFolder("")
    setSampleEventsText(workingFixture.text)
    setExpectedResults(null)
    setParseError(null)
    if (message) {
      toast.success(message)
    }
    setGenerationSummary(null)
    onClearResult()
  }

  function startNewFixture() {
    hasExplicitNewFixtureRef.current = true
    setSelectedFixtureId(UNSAVED_FIXTURE_ID)
    setFixtureName(workingFixture.name)
    setFixtureDescription(workingFixture.description)
    setFixtureFolder("")
    setSampleEventsText(workingFixture.text)
    setExpectedResults(null)
    setParseError(null)
    setGenerationSummary(null)
    onClearResult()
  }

  function handleRunTest() {
    if (isRunningTest) {
      return
    }
    if (!hasRule) {
      setParseError(null)
      toast.error("No rule loaded. Open or create a rule before running a test.")
      return
    }
    if (!parsedSample.events) {
      setParseError(parsedSample.error)
      onTestConfigOpenChange(true)
      return
    }
    if (parsedSample.events.length === 0) {
      setParseError(null)
      onTestConfigOpenChange(true)
      return
    }
    setParseError(null)
    setTestPanelTab("results")
    onRunTest(parsedSample.events, dataTables)
  }

  function handleAddCustomFixtureEvents(options: CustomFixtureEventOptions = {}) {
    const existingEvents = parsedSample.events ?? []
    const remainingEventSlots = Math.max(0, MAX_FIXTURE_BUILDER_EVENTS - existingEvents.length)
    if (remainingEventSlots === 0) {
      setParseError(null)
      toast.error(`Test case already has the maximum ${MAX_FIXTURE_BUILDER_EVENTS} events.`)
      return
    }
    const startTime =
      options.startTime ?? Date.UTC(2026, 0, 1, 9, 0, 0) + existingEvents.length * 60_000
    const events = createCustomFixtureEvents({
      count: 1,
      startIndex: existingEvents.length,
      startTime,
    }).map((event, index) =>
      applyCustomEventOverrides(event, {
        eventType: options.eventType,
        fields: options.fields,
        startTime: startTime + index * 60_000,
      })
    )
    const nextEvents = [...existingEvents, ...events]

    setSelectedFixtureId(UNSAVED_FIXTURE_ID)
    setFixtureName(existingEvents.length > 0 ? fixtureName : "Custom test case")
    setFixtureDescription(
      existingEvents.length > 0
        ? fixtureDescription
        : "Custom test case. Edit generated starter events as needed."
    )
    if (existingEvents.length === 0) {
      setFixtureFolder("")
    }
    setSampleEventsText(JSON.stringify(nextEvents, null, 2))
    setExpectedResults(null)
    setParseError(null)
    toast.success(`Added ${events.length} custom test event${events.length === 1 ? "" : "s"}.`)
    setGenerationSummary(null)
    onClearResult()
  }

  function handleGenerateRuleDerivedTestCase() {
    if (!hasRule) {
      setParseError(null)
      setGenerationSummary(null)
      toast.error("No rule loaded. Open or create a rule before generating a test case.")
      return
    }
    const activeRuleText = getRuleText() || ruleText
    const generated = generateRuleDerivedTestEvents(activeRuleText)
    const nextGenerationSummary = summarizeRuleDerivedGeneration(generated)

    if (!generated.events.length) {
      setParseError(null)
      setGenerationSummary(nextGenerationSummary)
      return
    }

    setSelectedFixtureId(UNSAVED_FIXTURE_ID)
    setFixtureName(createRuleFixtureDraftName())
    setFixtureDescription(buildRuleDerivedFixtureDescription(generated))
    setFixtureFolder("")
    setSampleEventsText(JSON.stringify(generated.events, null, 2))
    setExpectedResults(null)
    setParseError(null)
    setGenerationSummary(nextGenerationSummary)
    toast.success(
      generated.constraints.length > 0
        ? `Generated ${generated.events.length} events from ${generated.eventVariableCount} event variable${generated.eventVariableCount === 1 ? "" : "s"} and ${generated.constraints.length} field constraint${generated.constraints.length === 1 ? "" : "s"}. View the generated test case before saving.`
        : `Generated ${generated.events.length} events from ${generated.eventVariableCount} rule event variable${generated.eventVariableCount === 1 ? "" : "s"}. View the generated test case before saving.`
    )
    setTestPanelTab("results")
    onClearResult()
  }

function handleLoadFixture(id: string) {
    if (id === UNSAVED_FIXTURE_ID) {
      resetWorkingFixture()
      return
    }
    const fixture = fixtures.find((item) => item.id === id)
    if (!fixture) {
      return
    }
    const metadata = parseFixtureDescriptionMetadata(fixture.description ?? "")
    hasExplicitNewFixtureRef.current = false
    setSelectedFixtureId(id)
    setFixtureName(fixture.name)
    setFixtureDescription(stripFixtureFolderMetadata(fixture.description ?? ""))
    setFixtureFolder(metadata.folder ?? "")
    setSampleEventsText(normalizeSampleEventsText(fixture.text))
    setExpectedResults(fixture.expectedResults)
    setParseError(null)
    setGenerationSummary(null)
  }

  async function saveFixture(overrides: { description?: string; expectedResults?: FixtureExpectedResults | null } = {}) {
    if (parsedSample.error) {
      setParseError(parsedSample.error)
      return
    }
    const activeFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId)
    const normalizedFixtureName = fixtureName.trim() || "Sample test case"

    setIsSavingFixture(true)
    try {
      const savedFixtureName = activeFixture?.name ?? normalizedFixtureName
      const savedDescription = upsertFixtureFolderMetadata(
        overrides.description ?? fixtureDescription,
        fixtureFolder
      )
      const saved = await saveUdmEventSet({
        description: savedDescription,
        events: parsedSample.events,
        expectedResults: overrides.expectedResults ?? expectedResults,
        id: selectedFixtureId === UNSAVED_FIXTURE_ID ? null : selectedFixtureId,
        name: savedFixtureName,
        savedRuleId: getFixtureSaveRuleId(fixtures, selectedFixtureId, activeSavedRuleId),
      })
      setParseError(null)
      toast.success(`Saved ${saved.name}.`)
      setSelectedFixtureId(saved.id)
      setFixtureName(saved.name)
      setFixtureDescription(stripFixtureFolderMetadata(saved.description ?? ""))
      setFixtureFolder(parseFixtureDescriptionMetadata(saved.description ?? "").folder ?? "")
      setExpectedResults(parseFixtureExpectedResults(saved.expectedResults))
      setGenerationSummary(null)
      await refetchFixtures()
    } catch (error) {
      setParseError(getPublicErrorMessage(error, "Could not save test case."))
    } finally {
      setIsSavingFixture(false)
    }
  }

  async function handleSaveFixture() {
    await saveFixture()
  }

  async function handleDeleteFixture() {
    if (selectedFixtureId === UNSAVED_FIXTURE_ID) {
      return
    }
    try {
      const fixtureNameToDelete = fixtures.find((fixture) => fixture.id === selectedFixtureId)?.name ?? fixtureName
      await deleteUdmEventSet({ id: selectedFixtureId })
      await refetchFixtures()
      resetWorkingFixture("Deleted test case.")
      toast.success(`Deleted ${fixtureNameToDelete}.`)
    } catch (error) {
      setParseError(getPublicErrorMessage(error, "Could not delete test case."))
    }
  }

  function handleFormatJson() {
    if (parsedSample.error) {
      setParseError(parsedSample.error)
      return
    }
    setSampleEventsText(JSON.stringify(parsedSample.events, null, 2))
    setParseError(null)
  }

  function handleExportFixtureJson() {
    if (parsedSample.error) {
      setParseError(parsedSample.error)
      return
    }

    const blob = new Blob([JSON.stringify(parsedSample.events, null, 2)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${toFixtureFileName(fixtureName)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setParseError(null)
    toast.success("Exported test case JSON.")
  }

  function handleImportFixtureJson(text: string, fileName: string) {
    const parsed = parseSampleEvents(text)
    if (parsed.error) {
      setSelectedFixtureId(UNSAVED_FIXTURE_ID)
      setFixtureName(toFixtureName(fileName))
      setFixtureDescription("")
      setFixtureFolder("")
      setSampleEventsText(text)
      setExpectedResults(null)
      setParseError(parsed.error)
      setGenerationSummary(null)
      return
    }

    setSelectedFixtureId(UNSAVED_FIXTURE_ID)
    setFixtureName(toFixtureName(fileName))
    setFixtureDescription("")
    setFixtureFolder("")
    setSampleEventsText(JSON.stringify(parsed.events, null, 2))
    setExpectedResults(null)
    setParseError(null)
    toast.success("Imported test case JSON.")
    setGenerationSummary(null)
  }

  async function handleCaptureAndSaveExpectedResults() {
    if (!result) {
      return
    }
    const captured = captureExpectedResults(result)
    const description = upsertFixtureLastRunSummary(fixtureDescription, buildFixtureLastRunSummary(result))
    setExpectedResults(captured)
    setFixtureDescription(description)
    await saveFixture({ description, expectedResults: captured })
  }

  function handleClearExpectedResults() {
    setExpectedResults(null)
    toast.success("Cleared expected results.")
    setGenerationSummary(null)
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    onOpenChange(true)
    setIsResizing(true)
    setHasUserResizedPanel(true)

    const startHeight = height
    const startY = event.clientY
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = "row-resize"
    document.body.style.userSelect = "none"

    function handlePointerMove(event: PointerEvent) {
      const nextHeight = startHeight + startY - event.clientY
      const clampedHeight = Math.min(
        OUTPUT_PANEL_MAX_HEIGHT,
        Math.max(OUTPUT_PANEL_MIN_HEIGHT, nextHeight)
      )

      onHeightChange(clampedHeight)
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

  return (
    <>
      <ConfirmDialog
        confirmLabel="Delete Test Case"
        description={`Delete "${fixtureName}" from saved UDM test cases? This cannot be undone.`}
        isDestructive
        isOpen={isDeleteFixtureConfirmOpen}
        title="Delete test case?"
        onConfirm={() => void handleDeleteFixture()}
        onOpenChange={setIsDeleteFixtureConfirmOpen}
      />
      {isTestConfigOpen ? (
        <Dialog open={isTestConfigOpen} onOpenChange={onTestConfigOpenChange}>
            <DialogContent
              showCloseButton={false}
              className={`fixed z-50 flex min-h-0 flex-col border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl outline-none ${
                isMobile
                  ? "inset-0 left-0 top-0 max-h-none w-auto translate-x-0 translate-y-0 overflow-hidden rounded-none p-0"
                  : "inset-2 left-2 top-2 max-h-none w-auto translate-x-0 translate-y-0 overflow-hidden rounded-lg p-0"
              }`}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-sidebar-border bg-sidebar px-4 py-3">
                <div className="min-w-0">
                  <DialogTitle className="text-sm font-semibold">
                    Test Case Editor
                  </DialogTitle>
                  <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                    Build or load the test case used by the next test run.
                  </DialogDescription>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <DialogClose asChild>
                    <Button type="button" variant="ghost" size="icon-sm" title="Close test case editor">
                      <XIcon />
                      <span className="sr-only">Close test case editor</span>
                    </Button>
                  </DialogClose>
                </div>
              </div>
              <div
                data-testid="test-case-editor-content"
                className="min-h-0 flex-1 overflow-hidden overscroll-contain"
              >
                <RuleFixtureBuilder
                  activeSavedRuleId={activeSavedRuleId}
                  expectedResults={expectedResults}
                  fixtureDescription={fixtureDescription}
                  fixtureFolder={fixtureFolder}
                  fixtureName={fixtureName}
                  generationSummary={generationSummary}
                  fixtures={fixtures}
                  hasRule={hasRule}
                  isSavingFixture={isSavingFixture}
                  parseError={parseError}
                  sampleEvents={parsedSample.events}
                  sampleEventsText={sampleEventsText}
                  sampleStats={sampleStats}
                  selectedFixtureId={selectedFixtureId}
                  onAddCustomEvents={handleAddCustomFixtureEvents}
                  onClearExpectedResults={handleClearExpectedResults}
                  onDeleteFixture={() => {
                    setIsDeleteFixtureConfirmOpen(true)
                  }}
                  onExportFixtureJson={handleExportFixtureJson}
                  onFixtureDescriptionChange={setFixtureDescription}
                  onFixtureFolderChange={setFixtureFolder}
                  onFixtureNameChange={setFixtureName}
                  onFormatJson={handleFormatJson}
                  onGenerateFromRule={handleGenerateRuleDerivedTestCase}
                  onImportFixtureJson={handleImportFixtureJson}
                  onLoadFixture={handleLoadFixture}
                  onNewFixture={startNewFixture}
                  onSampleEventsTextChange={setSampleEventsText}
                  onSaveFixture={() => void handleSaveFixture()}
                />
              </div>
            </DialogContent>
        </Dialog>
      ) : null}
      {isExpandedResultsOpen ? (
        <Dialog
          open={isExpandedResultsOpen}
          onOpenChange={setIsExpandedResultsOpen}
        >
            <DialogContent
              showCloseButton={false}
              className={`fixed z-50 flex max-h-none w-auto translate-x-0 translate-y-0 flex-col overflow-hidden border border-sidebar-border bg-sidebar p-0 text-sidebar-foreground shadow-xl outline-none ${
                isMobile
                  ? "inset-0 left-0 top-0 rounded-none"
                  : "inset-3 left-3 top-3 rounded-lg lg:inset-8 lg:left-8 lg:top-8"
              }`}
            >
              <DialogTitle className="sr-only">Test Results</DialogTitle>
              <DialogDescription className="sr-only">
                Expanded view of the current local test result.
              </DialogDescription>
              <div
                data-testid="expanded-test-results-layout"
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <QuickTestSummary
                  expectedResults={expectedResults}
                  hasRule={hasRule}
                  headerActions={
                    <DialogClose asChild>
                      <Button type="button" variant="ghost" size="icon-xs" title="Close expanded test results">
                        <XIcon />
                        <span className="sr-only">Close expanded test results</span>
                      </Button>
                    </DialogClose>
                  }
                  hiddenOutcomeNames={hiddenOutcomeNames}
                  isRunning={isRunningTest}
                  outcomeNames={outcomeNames}
                  parseError={parseError}
                  result={result}
                  sampleEvents={parsedSample.events}
                  sampleStats={sampleStats}
                  onCaptureAndSaveExpectedResults={() => void handleCaptureAndSaveExpectedResults()}
                  onClearResult={onClearResult}
                  onHideAllOutcomes={() => setHiddenOutcomeNames(new Set(outcomeNames))}
                  onOpenFixtureEditor={() => onTestConfigOpenChange(true)}
                  onOutcomeVisibilityChange={(name, visible) => {
                    setHiddenOutcomeNames((previous) => {
                      const next = new Set(previous)
                      if (visible) {
                        next.delete(name)
                      } else {
                        next.add(name)
                      }
                      return next
                    })
                  }}
                  onShowAllOutcomes={() => setHiddenOutcomeNames(new Set())}
                />
              </div>
            </DialogContent>
        </Dialog>
      ) : null}

      {!isOpen ? (
        <div
          className="relative flex shrink-0 items-center border-t border-sidebar-border bg-sidebar px-2"
          style={{ height: `${INSPECTOR_COLLAPSED_WIDTH}px` }}
        >
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
            Test Results
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            title="Expand test results"
            onClick={() => onOpenChange(true)}
          >
            <ChevronUpIcon />
            <span className="sr-only">Expand test results</span>
          </Button>
        </div>
      ) : (
      <Collapsible
        open={isOpen}
        onOpenChange={onOpenChange}
        className="relative flex shrink-0 flex-col border-t bg-muted/5"
        style={panelFrameStyle}
      >
      <div
        className="group absolute inset-x-0 top-0 z-10 flex h-3 -translate-y-1.5 touch-none cursor-row-resize items-center justify-center"
        onPointerDown={handleResizeStart}
        role="separator"
        aria-label="Resize output panel"
        aria-orientation="horizontal"
        aria-valuemax={OUTPUT_PANEL_MAX_HEIGHT}
        aria-valuemin={OUTPUT_PANEL_MIN_HEIGHT}
        aria-valuenow={height}
      >
        <span
          className={`h-1 w-14 rounded-full bg-border transition-[background-color,opacity] group-hover:bg-muted-foreground/40 ${
            isResizing ? "opacity-100" : "opacity-60"
          }`}
        />
      </div>

      <div className="flex h-full flex-col overflow-hidden">
        <Tabs
          value={testPanelTab}
          onValueChange={setTestPanelTab}
          className="flex min-h-0 flex-1 gap-0"
        >
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b bg-transparent">
          <div className="flex min-w-0 items-center gap-2 px-2 sm:px-4">
            <TabsList className="h-7" variant="line">
              <TabsTrigger value="results" className="h-7 text-xs">
                Test Results
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setTestPanelTab("history")}
              >
                History
                {testHistory.length > 0 ? (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {testHistory.length}
                  </Badge>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex min-w-0 shrink-0 items-center gap-1 pr-2 sm:gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              title="Expand test results"
              aria-label="Expand test results"
              onClick={() => setIsExpandedResultsOpen(true)}
            >
              <Maximize2Icon />
            </Button>
            <Select
              value={selectedFixtureId}
              onValueChange={handleLoadFixture}
              disabled={fixtures.length === 0}
            >
              <SelectTrigger
                size="sm"
                className="hidden h-7 w-44 min-w-0 text-xs sm:flex lg:w-56"
                title={fixtures.length === 0 ? "No saved test cases" : "Select test case"}
              >
                {fixtures.length === 0 ? (
                  <span className="min-w-0 truncate text-muted-foreground">None</span>
                ) : (
                  <SelectValue placeholder={fixtureName} />
                )}
              </SelectTrigger>
              <SelectContent
                position="popper"
                className="w-[var(--radix-select-trigger-width)] max-w-[min(24rem,calc(100vw-2rem))]"
              >
                {fixtures.map((fixture) => (
                  <SelectItem key={fixture.id} value={fixture.id} className="min-w-0">
                    <span className="block max-w-full truncate" title={fixture.name}>{fixture.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              className="h-7 w-7 px-0 text-xs sm:w-auto sm:min-w-24 sm:px-2.5"
              onClick={handleRunTest}
              disabled={isRunningTest || !hasRule}
              title={hasRule ? "Run test" : "Open or create a rule before running a test"}
            >
              <PlayIcon />
              <span className="hidden min-w-0 truncate sm:inline">Run Test</span>
            </Button>
            {isRunningTest ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={onCancelRunTest}
                title="Cancel test run"
              >
                <XIcon />
                <span className="hidden sm:inline">Cancel</span>
              </Button>
            ) : null}
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
                title={isOpen ? "Minimize panel" : "Expand panel"}
              >
                {isOpen ? <ChevronDownIcon /> : <ChevronUpIcon />}
                <span className="sr-only">
                  {isOpen ? "Minimize panel" : "Expand panel"}
                </span>
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TabsContent value="results" className="mt-0 flex min-h-0 flex-1 overflow-hidden">
            <QuickTestSummary
              expectedResults={expectedResults}
              hasRule={hasRule}
              hiddenOutcomeNames={hiddenOutcomeNames}
              outcomeNames={outcomeNames}
              parseError={parseError}
              result={result}
              isRunning={isRunningTest}
              sampleEvents={parsedSample.events}
              sampleStats={sampleStats}
              onCaptureAndSaveExpectedResults={() => void handleCaptureAndSaveExpectedResults()}
              onClearResult={onClearResult}
              onHideAllOutcomes={() => setHiddenOutcomeNames(new Set(outcomeNames))}
              onOpenFixtureEditor={() => onTestConfigOpenChange(true)}
              onOutcomeVisibilityChange={(name, visible) => {
                setHiddenOutcomeNames((previous) => {
                  const next = new Set(previous)
                  if (visible) {
                    next.delete(name)
                  } else {
                    next.add(name)
                  }
                  return next
                })
              }}
              onShowAllOutcomes={() => setHiddenOutcomeNames(new Set())}
            />
          </TabsContent>
          <TabsContent value="history" className="mt-0 flex min-h-0 flex-1 overflow-hidden">
            <TestHistoryPanel
              history={testHistory}
              onOpenFixtureEditor={() => onTestConfigOpenChange(true)}
              onRestoreResult={(historyResult) => {
                onRestoreHistoryResult?.(historyResult)
                setTestPanelTab("results")
              }}
            />
          </TabsContent>
        </CollapsibleContent>
        </Tabs>
      </div>
      </Collapsible>
      )}
    </>
  )
}

function RuleFixtureBuilder({
  activeSavedRuleId,
  expectedResults,
  fixtureDescription,
  fixtureFolder,
  fixtureName,
  generationSummary,
  fixtures,
  hasRule,
  isSavingFixture,
  parseError,
  sampleEvents,
  sampleEventsText,
  sampleStats,
  selectedFixtureId,
  onAddCustomEvents,
  onClearExpectedResults,
  onDeleteFixture,
  onExportFixtureJson,
  onFixtureDescriptionChange,
  onFixtureFolderChange,
  onFixtureNameChange,
  onFormatJson,
  onGenerateFromRule,
  onImportFixtureJson,
  onLoadFixture,
  onNewFixture,
  onSampleEventsTextChange,
  onSaveFixture,
}: {
  activeSavedRuleId: string | null
  expectedResults: FixtureExpectedResults | null
  fixtureDescription: string
  fixtureFolder: string
  fixtureName: string
  generationSummary: RuleDerivedGenerationSummary | null
  fixtures: SampleFixture[]
  hasRule: boolean
  isSavingFixture: boolean
  parseError: string | null
  sampleEvents: unknown[] | null
  sampleEventsText: string
  sampleStats: ReturnType<typeof summarizeSampleEvents> | null
  selectedFixtureId: string
  onAddCustomEvents: (options?: CustomFixtureEventOptions) => void
  onClearExpectedResults: () => void
  onDeleteFixture: () => void
  onExportFixtureJson: () => void
  onFixtureDescriptionChange: (description: string) => void
  onFixtureFolderChange: (folder: string) => void
  onFixtureNameChange: (name: string) => void
  onFormatJson: () => void
  onGenerateFromRule: () => void
  onImportFixtureJson: (text: string, fileName: string) => void
  onLoadFixture: (id: string) => void
  onNewFixture: () => void
  onSampleEventsTextChange: (text: string) => void
  onSaveFixture: () => void
}) {
  const fixtureImportInputRef = useRef<HTMLInputElement>(null)
  const fixtureMetadata = parseFixtureDescriptionMetadata(fixtureDescription)
  const activeFixture = fixtures.find((fixture) => fixture.id === selectedFixtureId)
  const groupedFixtures = useMemo(() => groupFixturesByFolder(fixtures), [fixtures])
  const [collapsedFixtureFolders, setCollapsedFixtureFolders] = useState<Set<string>>(() => new Set())
  const isSavedFixture = Boolean(activeFixture)
  const isGeneratedFixtureDraft = isRuleDerivedFixtureDraft(fixtureName, fixtureDescription)
  const [newEventDateTime, setNewEventDateTime] = useState(() =>
    getNextFixtureEventDateTime(sampleEvents)
  )
  const [newEventType, setNewEventType] = useState("PROCESS_LAUNCH")
  const [newEventFields, setNewEventFields] = useState<CustomEventFieldInput[]>(() => {
    return [createDefaultCustomEventField()]
  })
  const [shouldKeepNewEventFields, setShouldKeepNewEventFields] = useState(false)
  const [isFixtureJsonEditorOpen, setIsFixtureJsonEditorOpen] = useState(false)
  const [expandedTestCaseSection, setExpandedTestCaseSection] = useState<"builder" | "events" | null>(null)
  const remainingCustomEvents = Math.max(
    0,
    MAX_FIXTURE_BUILDER_EVENTS - (sampleStats?.eventCount ?? 0)
  )
  const newEventTimestampMs = parseDateTimeLocalInput(newEventDateTime)
  const hasInvalidNewEventTime = newEventTimestampMs === null
  const hasInvalidEventType = !hasValidEventType(newEventType)
  const invalidFieldCount = newEventFields.filter((field) =>
    !hasValidFieldValue(field.path, field.value)
  ).length

  async function handleFixtureFileChange(file: File | null) {
    if (!file) {
      return
    }
    onImportFixtureJson(await file.text(), file.name)
    if (fixtureImportInputRef.current) {
      fixtureImportInputRef.current.value = ""
    }
  }

  function handleAddEventFromForm() {
    if (newEventTimestampMs === null || hasInvalidEventType || invalidFieldCount > 0) {
      return
    }
    onAddCustomEvents({
      eventType: newEventType,
      fields: newEventFields,
      startTime: newEventTimestampMs,
    })
    setNewEventDateTime(addMinutesToDateTimeLocal(newEventDateTime, 1))
    if (!shouldKeepNewEventFields) {
      setNewEventFields([createDefaultCustomEventField(`field-${Date.now()}-0`)])
    }
  }

  function handleFieldPathChange(id: string, path: string) {
    setNewEventFields((fields) =>
      fields.map((field) =>
        field.id === id
          ? {
              ...field,
              path,
              value: hasValidFieldValue(path, field.value)
                ? field.value
                : getDefaultFieldValue(path),
            }
          : field
      )
    )
  }

  function handleFieldValueChange(id: string, value: string) {
    setNewEventFields((fields) =>
      fields.map((field) => (field.id === id ? { ...field, value } : field))
    )
  }

  function handleAddFieldRow() {
    setNewEventFields((fields) => [
      ...fields,
      createDefaultCustomEventField(`field-${Date.now()}-${fields.length}`),
    ])
  }

  function handleRemoveFieldRow(id: string) {
    setNewEventFields((fields) => fields.filter((field) => field.id !== id))
  }

  return (
    <section className="grid h-full min-h-0 min-w-0 bg-sidebar lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <aside className="relative z-20 isolate flex max-h-72 min-h-0 min-w-0 flex-col overflow-hidden border-b border-sidebar-border bg-sidebar [contain:layout_paint] lg:max-h-none lg:max-w-[24rem] lg:border-b-0 lg:border-r">
        <div className="shrink-0 border-b border-sidebar-border p-5">
          <div className="flex min-w-0 items-center gap-2">
            <FlaskConicalIcon className="size-4 shrink-0 text-muted-foreground" />
            <p
              className="truncate text-lg font-semibold text-foreground"
              title={activeFixture?.name ?? fixtureName}
            >
              {activeFixture?.name ?? fixtureName}
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Saved test case library and reusable test events.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {activeFixture?.savedRuleId && activeFixture.savedRuleId === activeSavedRuleId ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                rule test case
              </Badge>
            ) : activeFixture?.savedRuleId ? (
              <Badge
                variant="outline"
                className="font-mono text-[10px] text-muted-foreground"
                title="This saved test case belongs to another saved rule."
              >
                other rule
              </Badge>
            ) : selectedFixtureId !== UNSAVED_FIXTURE_ID ? (
              <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                standalone
              </Badge>
            ) : null}
            {fixtureFolder.trim() ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                {fixtureFolder.trim()}
              </Badge>
            ) : null}
            <Badge variant="outline" className="font-mono text-[10px]">
              {sampleStats ? `${sampleStats.eventCount} events` : "invalid"}
            </Badge>
            <Badge
              variant="outline"
              className={`font-mono text-[10px] ${
                parseError ? "border-destructive/40 text-destructive" : "text-emerald-700"
              }`}
            >
              {parseError ? "parse error" : "ready"}
            </Badge>
            {expectedResults ? (
              <Badge variant="outline" className="font-mono text-[10px]">
                baseline
              </Badge>
            ) : null}
            {isGeneratedFixtureDraft ? (
              <Badge variant="outline" className="font-mono text-[10px] text-amber-700">
                draft
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-sidebar-border px-3">
            <p className="text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
              Saved Test Cases
            </p>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="font-mono text-[10px]">
                {fixtures.length}
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 border-sidebar-border bg-sidebar text-xs"
                onClick={onNewFixture}
              >
                <PlusIcon />
                New
              </Button>
            </div>
          </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-b border-sidebar-border">
          <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <div className="w-full min-w-0 max-w-full space-y-2 overflow-hidden p-3 pr-5">
              {fixtures.length === 0 ? (
                <EmptyState
                  className="rounded-md border-sidebar-border bg-sidebar-accent/20 px-3 py-3"
                  description="Build a test case here, then Save it to reuse it in future tests."
                  title="No saved test cases yet."
                />
              ) : groupedFixtures.map((group) => (
                <section key={group.folder} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 min-w-0 flex-1 justify-start gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground hover:text-foreground"
                      aria-expanded={!collapsedFixtureFolders.has(group.folder)}
                      onClick={() => {
                        setCollapsedFixtureFolders((current) => {
                          const next = new Set(current)
                          if (next.has(group.folder)) {
                            next.delete(group.folder)
                          } else {
                            next.add(group.folder)
                          }
                          return next
                        })
                      }}
                      title={group.folder}
                    >
                      <span className="min-w-0 truncate">{group.folder}</span>
                      {collapsedFixtureFolders.has(group.folder) ? (
                        <ChevronRightIcon className="ml-auto size-3.5 shrink-0" />
                      ) : (
                        <ChevronDownIcon className="ml-auto size-3.5 shrink-0" />
                      )}
                    </Button>
                    <Badge variant="outline" className="h-5 font-mono text-[10px]">
                      {group.fixtures.length}
                    </Badge>
                  </div>
                  {collapsedFixtureFolders.has(group.folder) ? null : group.fixtures.map((fixture) => {
                const isSelected = fixture.id === selectedFixtureId
                const fixtureEvents = parseSampleEvents(fixture.text).events
                const ruleFixture = fixture.savedRuleId && fixture.savedRuleId === activeSavedRuleId
                return (
                  <Button
                    key={fixture.id}
                    type="button"
                    variant="outline"
                    className={`box-border h-auto min-w-0 w-full max-w-full justify-start gap-2 overflow-hidden px-3 py-2 text-left ${
                      isSelected
                        ? "border-primary/50 bg-sidebar-accent text-foreground shadow-sm"
                        : "border-sidebar-border bg-sidebar-accent/35 hover:bg-sidebar-accent"
                    }`}
                    onClick={() => onLoadFixture(fixture.id)}
                    title={fixture.name}
                  >
                    <FlaskConicalIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="grid w-0 min-w-0 flex-1 gap-0.5">
                      <span className="min-w-0 truncate text-sm font-medium" title={fixture.name}>
                        {fixture.name}
                      </span>
                      <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                        {ruleFixture ? "rule test case · " : fixture.savedRuleId ? "other rule · " : ""}
                        {fixtureEvents ? `${fixtureEvents.length} events` : "invalid json"}
                      </span>
                    </span>
                  </Button>
                )
                  })}
                </section>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="shrink-0 space-y-3 bg-sidebar-accent/20 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="fixture-folder" className="text-[11px] text-muted-foreground">
              Folder
            </Label>
            <Input
              id="fixture-folder"
              value={fixtureFolder}
              onChange={(event) => onFixtureFolderChange(event.currentTarget.value)}
              className="h-8 bg-sidebar-accent/45 text-xs"
              maxLength={TEST_CASE_FOLDER_MAX_LENGTH}
              placeholder="Optional folder"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fixture-name" className="text-[11px] text-muted-foreground">
              Name
            </Label>
            <Input
              id="fixture-name"
              value={fixtureName}
              readOnly={isSavedFixture}
              onChange={(event) => {
                if (!isSavedFixture) {
                  onFixtureNameChange(event.currentTarget.value)
                }
              }}
              className="h-8 bg-sidebar-accent/45 text-xs read-only:bg-sidebar-accent/30 read-only:text-muted-foreground"
              maxLength={SAVED_OBJECT_NAME_MAX_LENGTH}
              title={
                isSavedFixture
                  ? "Test case names are locked after creation."
                  : "Choose a unique name. It cannot be changed after save."
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fixture-description" className="text-[11px] text-muted-foreground">
              Description
            </Label>
            <Input
              id="fixture-description"
              value={fixtureDescription}
              onChange={(event) => onFixtureDescriptionChange(event.currentTarget.value)}
              className="h-8 bg-sidebar-accent/45 text-xs"
              maxLength={SAVED_OBJECT_DESCRIPTION_MAX_LENGTH}
              placeholder="Optional context"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 flex-1 text-xs"
              onClick={onSaveFixture}
              disabled={isSavingFixture}
            >
              {isSavingFixture ? (
                <LoadingIndicator label="Saving" className="text-xs text-current" markClassName="size-4 border-current/40 bg-current/10 text-current" />
              ) : (
                <>
                  <SaveIcon />
                  Save
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title="Delete test case"
              onClick={onDeleteFixture}
              disabled={selectedFixtureId === UNSAVED_FIXTURE_ID}
            >
              <Trash2Icon />
              <span className="sr-only">Delete test case</span>
            </Button>
          </div>
        </div>
      </aside>

      <div
        data-testid="test-case-editor-main"
        className={`relative flex min-h-0 min-w-0 flex-col ${
          expandedTestCaseSection ? "z-50 overflow-visible" : "z-0 overflow-hidden"
        }`}
      >
        {expandedTestCaseSection ? (
          <button
            type="button"
            aria-label="Collapse expanded test case section"
            className="fixed inset-0 left-0 top-0 z-40 cursor-default bg-background/65 backdrop-blur-[1px]"
            onClick={() => setExpandedTestCaseSection(null)}
          />
        ) : null}
        <div
          data-testid="event-builder-panel"
          className={`flex flex-col overflow-hidden border-sidebar-border bg-sidebar p-4 ${
            expandedTestCaseSection === "builder"
              ? "fixed inset-3 left-3 top-3 z-50 rounded-lg border shadow-xl lg:inset-8 lg:left-8 lg:top-8"
              : "h-[clamp(24rem,64svh,38rem)] shrink-0 border-b"
          }`}
        >
          <div className="shrink-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <BracesIcon className="size-4 shrink-0 text-muted-foreground" />
                  <h3 className="truncate text-base font-semibold">Event Builder</h3>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {!hasRule ? (
                    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                      no rule loaded
                    </Badge>
                  ) : null}
                  {isGeneratedFixtureDraft ? (
                    <Badge variant="outline" className="border-amber-500/40 font-mono text-[10px] text-amber-700">
                      generated draft
                    </Badge>
                  ) : null}
                  {generationSummary ? (
                    <RuleDerivedGenerationStatus summary={generationSummary} compact />
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title={expandedTestCaseSection === "builder" ? "Collapse event builder" : "Expand event builder"}
                  aria-label={expandedTestCaseSection === "builder" ? "Collapse event builder" : "Expand event builder"}
                  onClick={() => setExpandedTestCaseSection(expandedTestCaseSection === "builder" ? null : "builder")}
                >
                  {expandedTestCaseSection === "builder" ? <Minimize2Icon /> : <Maximize2Icon />}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={!hasRule}
                  title={hasRule ? "Generate a review draft from the active rule" : "Open or create a rule before generating a draft"}
                  onClick={onGenerateFromRule}
                >
                  <BracesIcon />
                  Generate Draft
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-md border border-sidebar-border bg-sidebar-accent/15 p-3">
            <div className="grid gap-3 2xl:grid-cols-[minmax(220px,0.8fr)_minmax(220px,0.8fr)]">
              <DateTimeFieldGroup
                idPrefix="fixture-event-time"
                value={newEventDateTime}
                onChange={setNewEventDateTime}
              />
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="fixture-event-type" className="text-[11px] text-muted-foreground">
                  Event type <span className="text-destructive">*</span>
                </Label>
                <Select value={newEventType} onValueChange={setNewEventType}>
                  <SelectTrigger
                    id="fixture-event-type"
                    size="sm"
                    className="h-8 w-full min-w-0 overflow-hidden bg-sidebar font-mono text-[11px] [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:truncate"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start" className="max-h-80 max-w-[min(24rem,calc(100vw-2rem))]">
                    {UDM_EVENT_TYPES.map((eventType) => (
                      <SelectItem key={eventType} value={eventType} className="min-w-0 max-w-full">
                        <span className="block min-w-0 max-w-full truncate font-mono text-xs">
                          {eventType}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Label className="text-[11px] text-muted-foreground">Fields to set</Label>
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                    {newEventFields.length}
                  </Badge>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 border-sidebar-border bg-sidebar text-xs shadow-sm"
                  onClick={handleAddFieldRow}
                >
                  <PlusIcon />
                  Add Field
                </Button>
              </div>
              <div
                data-testid="event-builder-fields-scroll-area"
                className="min-h-[6.5rem] flex-1 overflow-y-auto overscroll-contain rounded-md border border-sidebar-border/70 bg-sidebar/55"
              >
                <Table className="min-w-[46rem] border-separate border-spacing-0 text-xs">
                  <TableHeader className="sticky top-0 z-10 bg-sidebar">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-14 border-b border-r border-sidebar-border/70 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                        #
                      </TableHead>
                      <TableHead className="w-[42%] border-b border-r border-sidebar-border/70 px-3 py-2 text-[11px] text-muted-foreground">
                        Field
                      </TableHead>
                      <TableHead className="border-b border-r border-sidebar-border/70 px-3 py-2 text-[11px] text-muted-foreground">
                        Value
                      </TableHead>
                      <TableHead className="w-12 border-b border-sidebar-border/70 px-2 py-2" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newEventFields.map((field, index) => (
                      <TableRow
                        key={field.id}
                        data-testid="event-builder-field-row"
                        className="bg-sidebar hover:bg-sidebar-accent/20"
                      >
                        <TableCell className="border-r border-sidebar-border/70 px-3 py-2 align-middle">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent/55 font-mono text-[10px] text-muted-foreground">
                            {index + 1}
                          </span>
                        </TableCell>
                        <TableCell className="min-w-72 border-r border-sidebar-border/70 px-3 py-2 align-top">
                          <UdmFieldPathPicker
                            path={field.path}
                            showLabel={false}
                            onPathChange={(path) => handleFieldPathChange(field.id, path)}
                          />
                        </TableCell>
                        <TableCell className="min-w-64 border-r border-sidebar-border/70 px-3 py-2 align-top">
                          <CustomEventFieldValueInput
                            path={field.path}
                            showLabel={false}
                            value={field.value}
                            onChange={(value) => handleFieldValueChange(field.id, value)}
                          />
                        </TableCell>
                        <TableCell className="px-2 py-2 align-top">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleRemoveFieldRow(field.id)}
                            disabled={newEventFields.length === 1}
                            title="Remove field"
                          >
                            <XIcon />
                            <span className="sr-only">Remove field</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            {hasInvalidNewEventTime || hasInvalidEventType || invalidFieldCount > 0 ? (
              <p className="mt-2 break-words text-[11px] leading-5 text-destructive">
                {hasInvalidNewEventTime
                  ? "Choose a valid date and time."
                  : hasInvalidEventType
                    ? "Choose a valid UDM event_type."
                    : "Fix invalid field values before adding the event."}
              </p>
            ) : null}
            <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-sidebar-border/70 pt-3">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {remainingCustomEvents} event slot{remainingCustomEvents === 1 ? "" : "s"} left
                </span>
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                  <Checkbox
                    checked={shouldKeepNewEventFields}
                    onCheckedChange={(value) => setShouldKeepNewEventFields(value === true)}
                    aria-label="Keep fields after adding event"
                  />
                  <span>Keep fields</span>
                </label>
              </div>
              <Button
                type="button"
                size="sm"
                className="h-9 w-full text-xs sm:w-auto sm:min-w-36"
                onClick={handleAddEventFromForm}
                disabled={
                  remainingCustomEvents === 0 ||
                  hasInvalidNewEventTime ||
                  hasInvalidEventType ||
                  invalidFieldCount > 0
                }
                title={
                  remainingCustomEvents === 0
                    ? `Test case already has ${MAX_FIXTURE_BUILDER_EVENTS} events`
                    : `Add one test event (${remainingCustomEvents} slot${remainingCustomEvents === 1 ? "" : "s"} left)`
                }
              >
                <PlusIcon />
                Add Event
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <input
              ref={fixtureImportInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                void handleFixtureFileChange(event.currentTarget.files?.[0] ?? null)
              }}
            />
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onFormatJson}>
              <BracesIcon />
              Format
            </Button>
            <Button
              type="button"
              variant={isFixtureJsonEditorOpen ? "outline" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setIsFixtureJsonEditorOpen((open) => !open)}
            >
              <BracesIcon />
              Edit JSON
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onExportFixtureJson}>
              <DownloadIcon />
              Export
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => fixtureImportInputRef.current?.click()}
            >
              <ImportIcon />
              Import
            </Button>
            {expectedResults ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={onClearExpectedResults}>
                <EraserIcon />
                Clear Baseline
              </Button>
            ) : null}
          </div>

          {(fixtureMetadata.source || fixtureMetadata.tags.length > 0) ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {fixtureMetadata.source ? (
                <Badge variant="outline" className="max-w-full font-mono text-[10px]">
                  <span className="truncate">source {fixtureMetadata.source}</span>
                </Badge>
              ) : null}
              {fixtureMetadata.tags.slice(0, 4).map((tag) => (
                <Badge key={tag} variant="outline" className="max-w-full font-mono text-[10px]">
                  <span className="truncate">#{tag}</span>
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        {isFixtureJsonEditorOpen ? (
          <div className="shrink-0 border-b border-sidebar-border bg-sidebar p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-normal text-muted-foreground">
                  Events JSON
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Edit the full test event array used by this case.
                </p>
              </div>
              <Badge
                variant="outline"
                className={`font-mono text-[10px] ${
                  parseError ? "border-destructive/40 text-destructive" : "text-emerald-700"
                }`}
              >
                {parseError ? "invalid json" : `${sampleStats?.eventCount ?? 0} events`}
              </Badge>
            </div>
            <Textarea
              aria-label="Test case events JSON"
              value={sampleEventsText}
              onChange={(event) => onSampleEventsTextChange(event.currentTarget.value)}
              spellCheck={false}
              className="max-h-[min(42svh,28rem)] min-h-56 resize-y overflow-auto bg-sidebar-accent/35 font-mono text-[11px] leading-5"
            />
            {parseError ? (
              <p className="mt-2 break-words rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 font-mono text-[11px] text-destructive">
                {parseError}
              </p>
            ) : null}
          </div>
        ) : null}

        <FixtureEventBrowser
          events={sampleEvents}
          isExpanded={expandedTestCaseSection === "events"}
          parseError={parseError}
          onCloseExpanded={() => setExpandedTestCaseSection(null)}
          onExpand={() => setExpandedTestCaseSection("events")}
          onSampleEventsTextChange={onSampleEventsTextChange}
        />
      </div>
    </section>
  )
}

function RuleDerivedGenerationStatus({
  compact = false,
  summary,
}: {
  compact?: boolean
  summary: RuleDerivedGenerationSummary
}) {
  const generated = summary.eventCount > 0
  const sourceLabel = summary.ruleName ? `rule ${summary.ruleName}` : "active rule"

  if (compact) {
    return (
      <Badge
        variant="outline"
        className={`font-mono text-[10px] ${
          generated ? "border-emerald-500/30 text-emerald-700" : "border-amber-500/40 text-amber-700"
        }`}
      >
        {generated ? `${summary.eventCount} draft event${summary.eventCount === 1 ? "" : "s"}` : "draft blocked"}
      </Badge>
    )
  }

  return (
    <div
      className={`mt-2 max-w-2xl rounded-md border px-2.5 py-2 text-xs ${
        generated
          ? "border-emerald-500/25 bg-emerald-500/10 text-muted-foreground"
          : "border-amber-500/30 bg-amber-500/10 text-muted-foreground"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={`font-mono text-[10px] ${
            generated ? "border-emerald-500/30 text-emerald-700" : "border-amber-500/40 text-amber-700"
          }`}
        >
          {generated ? "draft generated" : "draft blocked"}
        </Badge>
        <Badge variant="outline" className="max-w-full font-mono text-[10px]">
          <span className="truncate">{sourceLabel}</span>
        </Badge>
        <Badge variant="outline" className="font-mono text-[10px]">
          {summary.eventVariableCount} event variable{summary.eventVariableCount === 1 ? "" : "s"}
        </Badge>
        <Badge variant="outline" className="font-mono text-[10px]">
          {summary.constraintCount} constraint{summary.constraintCount === 1 ? "" : "s"}
        </Badge>
        {summary.dataTableCount > 0 ? (
          <Badge variant="outline" className="font-mono text-[10px]">
            {summary.dataTableCount} table{summary.dataTableCount === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>
      <p className="mt-2 leading-5">
        {generated
          ? `Generated ${summary.eventCount} draft event${summary.eventCount === 1 ? "" : "s"} from ${sourceLabel}. Review the JSON before saving it as a static test case.`
          : summary.failureReason}
      </p>
    </div>
  )
}

function DateTimeFieldGroup({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string
  value: string
  onChange: (value: string) => void
}) {
  const dateValue = getDateTimeLocalDatePart(value)
  const timeValue = getDateTimeLocalTimePart(value)
  const selectedDate = dateValue ? new Date(`${dateValue}T00:00:00`) : undefined

  function handleDateChange(nextDate: string) {
    onChange(mergeDateTimeLocalParts(nextDate, timeValue || "00:00:00"))
  }

  function handleTimeChange(nextTime: string) {
    onChange(mergeDateTimeLocalParts(dateValue, nextTime))
  }

  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${idPrefix}-date`} className="text-[11px] text-muted-foreground">
          Date
        </Label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id={`${idPrefix}-date`}
              type="button"
              variant="outline"
              className="h-8 w-full min-w-0 justify-start border-sidebar-border bg-sidebar px-2 text-left font-mono text-[11px] font-normal"
            >
              <CalendarIcon className="size-3.5 text-muted-foreground" />
              <span className="min-w-0 truncate">
                {dateValue || "Select date"}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                if (date) {
                  handleDateChange(formatDateInputValue(date))
                }
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor={`${idPrefix}-time`} className="text-[11px] text-muted-foreground">
          Time
        </Label>
        <Input
          id={`${idPrefix}-time`}
          type="time"
          step="1"
          value={timeValue}
          onChange={(event) => handleTimeChange(event.currentTarget.value)}
          className="h-8 bg-sidebar text-xs"
        />
      </div>
    </div>
  )
}

function formatDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function UdmFieldPathPicker({
  path,
  onPathChange,
  showLabel = true,
}: {
  path: string
  onPathChange: (path: string) => void
  showLabel?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLowerCase()
  const filteredPaths = useMemo(() => {
    const matches = normalizedQuery
      ? CUSTOM_EVENT_FIELD_PATHS.filter((fieldPath) =>
          fieldPath.toLowerCase().includes(normalizedQuery)
        )
      : CUSTOM_EVENT_FIELD_PATHS
    return matches.slice(0, FIELD_PICKER_RESULT_LIMIT)
  }, [normalizedQuery])
  const hiddenResultCount = Math.max(
    0,
    (normalizedQuery
      ? CUSTOM_EVENT_FIELD_PATHS.filter((fieldPath) =>
          fieldPath.toLowerCase().includes(normalizedQuery)
        ).length
      : CUSTOM_EVENT_FIELD_PATHS.length) - filteredPaths.length
  )

  return (
    <div className="min-w-0 space-y-1.5">
      {showLabel ? (
        <Label className="text-[11px] text-muted-foreground">Field</Label>
      ) : null}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="grid h-8 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center justify-normal gap-2 border-sidebar-border bg-sidebar-accent/35 px-2 text-left hover:border-primary/30 hover:bg-sidebar-accent/70 aria-expanded:border-primary/35 aria-expanded:bg-primary/10"
            aria-expanded={isOpen}
          >
            <span className="min-w-0 truncate font-mono text-[11px] text-foreground/85" title={path}>
              {path}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-sidebar-border bg-sidebar px-1.5 py-1 text-[10px] text-muted-foreground">
              <SearchIcon className="size-3" />
              Change
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search UDM fields"
              className="font-mono text-xs"
            />
            <CommandList className="max-h-56">
              <CommandEmpty>No fields found.</CommandEmpty>
              <CommandGroup>
                {filteredPaths.map((fieldPath) => (
                  <CommandItem
                    key={fieldPath}
                    value={fieldPath}
                    className="font-mono text-[11px]"
                    onSelect={() => {
                      onPathChange(fieldPath)
                      setQuery("")
                      setIsOpen(false)
                    }}
                  >
                    <CheckIcon
                      className={`size-3.5 ${fieldPath === path ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="min-w-0 break-all">{fieldPath}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {hiddenResultCount > 0 ? (
                <>
                  <CommandSeparator />
                  <p className="px-3 py-2 text-[10px] text-muted-foreground">
                    {hiddenResultCount} more result{hiddenResultCount === 1 ? "" : "s"}. Keep typing to narrow the list.
                  </p>
                </>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function CustomEventFieldValueInput({
  path,
  showLabel = true,
  value,
  onChange,
}: {
  path: string
  showLabel?: boolean
  value: string
  onChange: (value: string) => void
}) {
  const allowedValues = getEventFieldAllowedValues(path)
  const kind = getUdmFieldLiteralKind(path)
  const isInvalid = !hasValidFieldValue(path, value)

  if (allowedValues.length > 0) {
    const selectedValue = allowedValues.includes(value) ? value : undefined
    return (
      <div className="min-w-0 space-y-1.5">
        {showLabel ? (
          <Label className="text-[11px] text-muted-foreground">Value</Label>
        ) : null}
        <Select value={selectedValue} onValueChange={onChange}>
          <SelectTrigger
            size="sm"
            className="h-8 w-full min-w-0 bg-sidebar font-mono text-[11px]"
            aria-invalid={isInvalid}
          >
            <SelectValue placeholder="Choose value" />
          </SelectTrigger>
          <SelectContent align="start" className="max-h-72 max-w-[min(24rem,calc(100vw-2rem))]">
            {allowedValues.map((allowedValue) => (
              <SelectItem key={allowedValue} value={allowedValue}>
                <span className="block min-w-0 truncate font-mono text-xs">{allowedValue}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] leading-4 text-muted-foreground">
          Controlled value from the UDM enum.
        </p>
      </div>
    )
  }

  if (kind === "boolean") {
    return (
      <div className="min-w-0 space-y-1.5">
        {showLabel ? (
          <Label className="text-[11px] text-muted-foreground">Value</Label>
        ) : null}
        <Select value={value === "true" ? "true" : "false"} onValueChange={onChange}>
          <SelectTrigger size="sm" className="h-8 w-full min-w-0 bg-sidebar font-mono text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-1.5">
      {showLabel ? (
        <Label className="text-[11px] text-muted-foreground">Value</Label>
      ) : null}
      <Input
        type={kind === "number" ? "number" : "text"}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="h-8 min-w-0 bg-sidebar text-xs"
        aria-invalid={isInvalid}
        placeholder="Leave blank to use generated value"
      />
      {isInvalid ? (
        <p className="break-words text-[10px] leading-4 text-destructive">
          {kind === "number" ? "Enter a numeric value." : "Choose a valid value."}
        </p>
      ) : null}
    </div>
  )
}

function QuickTestSummary({
  expectedResults,
  hasRule,
  headerActions,
  hiddenOutcomeNames,
  isRunning,
  outcomeNames,
  parseError,
  result,
  sampleEvents,
  sampleStats,
  onCaptureAndSaveExpectedResults,
  onClearResult,
  onHideAllOutcomes,
  onOpenFixtureEditor,
  onOutcomeVisibilityChange,
  onShowAllOutcomes,
}: {
  expectedResults: FixtureExpectedResults | null
  hasRule: boolean
  headerActions?: ReactNode
  hiddenOutcomeNames: Set<string>
  isRunning: boolean
  outcomeNames: string[]
  parseError: string | null
  result: RuleTestRunResult | null
  sampleEvents: unknown[] | null
  sampleStats: ReturnType<typeof summarizeSampleEvents> | null
  onCaptureAndSaveExpectedResults: () => void
  onClearResult: () => void
  onHideAllOutcomes: () => void
  onOpenFixtureEditor: () => void
  onOutcomeVisibilityChange: (name: string, visible: boolean) => void
  onShowAllOutcomes: () => void
}) {
  const matchedRules = result?.rules.filter((rule) => rule.result.matched).length ?? 0
  const unexpectedRules =
    result?.rules.filter((rule) => {
      const expected = expectedResults?.rules[rule.ruleName]
      return expected ? !compareExpectedResult(rule.result, expected).passed : false
    }).length ?? 0

  if (isRunning) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 py-2 sm:px-4 sm:py-3">
        {headerActions ? (
          <div className="flex shrink-0 justify-end">{headerActions}</div>
        ) : null}
        <QuickEventTimeline
          events={sampleEvents}
          hiddenOutcomeNames={hiddenOutcomeNames}
          isRunning={isRunning}
          onOpenFixtureEditor={onOpenFixtureEditor}
          parseError={parseError}
          result={result}
          sampleStats={sampleStats}
        />
      </div>
    )
  }

  if (!hasRule && !parseError) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 py-2 sm:px-4 sm:py-3">
        {headerActions ? (
          <div className="flex shrink-0 justify-end">{headerActions}</div>
        ) : null}
        <div className="flex shrink-0 items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
            <InfoIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">No rule loaded</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Open a saved rule or create a new tab before running a test.
            </p>
          </div>
        </div>
        <QuickEventTimeline
          events={sampleEvents}
          hiddenOutcomeNames={hiddenOutcomeNames}
          onOpenFixtureEditor={onOpenFixtureEditor}
          parseError={parseError}
          result={result}
          sampleStats={sampleStats}
        />
      </div>
    )
  }

  if (!result) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2 sm:px-4 sm:py-3">
        {headerActions ? (
          <div className="flex shrink-0 justify-end">{headerActions}</div>
        ) : null}
        <QuickEventTimeline
          events={sampleEvents}
          hiddenOutcomeNames={hiddenOutcomeNames}
          onOpenFixtureEditor={onOpenFixtureEditor}
          parseError={parseError}
          result={result}
          sampleStats={sampleStats}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Grouped Matches</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Events are grouped by the rule match they satisfied. Expand a group for event fields and selected outcomes.
          </p>
        </div>
        <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5">
          <OutcomeCombobox
            hiddenOutcomeNames={hiddenOutcomeNames}
            outcomeNames={outcomeNames}
            onHideAll={onHideAllOutcomes}
            onShowAll={onShowAllOutcomes}
            onVisibilityChange={onOutcomeVisibilityChange}
          />
          {unexpectedRules > 0 ? (
            <Badge variant="destructive" className="font-mono text-[10px]">
              {unexpectedRules} unexpected
            </Badge>
          ) : expectedResults ? (
            <Badge
              className="border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-700"
              variant="outline"
            >
              expected
            </Badge>
          ) : null}
          {matchedRules > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onCaptureAndSaveExpectedResults}
              aria-label="Capture and save expected results"
            >
              Save baseline
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={onClearResult}
          >
            Clear
          </Button>
          {headerActions}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2 sm:px-4 sm:py-3">
        <QuickEventTimeline
          hiddenOutcomeNames={hiddenOutcomeNames}
          events={sampleEvents}
          onOpenFixtureEditor={onOpenFixtureEditor}
          parseError={parseError}
          result={result}
          sampleStats={sampleStats}
        />
      </div>
    </div>
  )
}

function TestHistoryPanel({
  history,
  onOpenFixtureEditor,
  onRestoreResult,
}: {
  history: TestRunHistoryRecord[]
  onOpenFixtureEditor: () => void
  onRestoreResult: (result: RuleTestRunResult) => void
}) {
  const latestRun = history[0] ?? null
  const matchedRunCount = history.filter((run) => run.matched).length

  if (history.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-5">
        <EmptyState
          className="border-0 bg-transparent"
          icon={<ListChecksIcon className="size-5" />}
          title="No test history yet"
          description="Run a local test to start building session history."
          action={
            <Button type="button" size="sm" onClick={onOpenFixtureEditor}>
              <FlaskConicalIcon />
              Open Test Case Editor
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Run timeline</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Compare recent local runs: matches, event counts, issues, inputs, and the top signal that changed.
          </p>
        </div>
        <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Badge variant="outline" className="font-mono text-[10px]">
            {history.length} runs
          </Badge>
          <Badge
            variant={matchedRunCount > 0 ? "default" : "outline"}
            className={
              matchedRunCount > 0
                ? "font-mono text-[10px]"
                : "font-mono text-[10px] text-muted-foreground"
            }
          >
            {matchedRunCount} matched
          </Badge>
          {latestRun ? (
            <Badge
              variant="outline"
              className="hidden font-mono text-[10px] text-muted-foreground sm:inline-flex"
            >
              {formatHistoryRunTime(latestRun.ranAt)}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-3 py-2 sm:px-4 sm:py-3">
        <ScrollArea className="h-full min-h-0">
          <div className="space-y-2 px-1 py-1">
            {history.map((run, index) => (
              <HistoryRunRow
                key={run.id}
                defaultOpen={index === 0 && run.matched}
                previousRun={history[index + 1] ?? null}
                run={run}
                runNumber={history.length - index}
                onRestoreResult={onRestoreResult}
              />
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

type HistoryRunEvidence = {
  eventSummary: string
  matchedRuleName: string | null
  outcomes: Record<string, unknown>
  placeholders: Record<string, unknown>
  primarySignal: string | null
}

function HistoryRunRow({
  defaultOpen,
  onRestoreResult,
  previousRun,
  run,
  runNumber,
}: {
  defaultOpen: boolean
  onRestoreResult: (result: RuleTestRunResult) => void
  previousRun: TestRunHistoryRecord | null
  run: TestRunHistoryRecord
  runNumber: number
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const evidence = summarizeHistoryRunEvidence(run)
  const summary = summarizeHistoryRun(run)
  const delta = summarizeHistoryRunDelta(run, previousRun)

  useEffect(() => {
    setIsOpen(defaultOpen)
  }, [defaultOpen])

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={`overflow-hidden rounded-md border border-l-2 ${
        run.matched
          ? "border-emerald-500/30 border-l-emerald-500 bg-emerald-500/10"
          : "border-border border-l-muted-foreground/30 bg-muted/20"
      }`}
    >
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <button
          type="button"
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/35"
          onClick={() => setIsOpen((open) => !open)}
        >
          {isOpen ? (
            <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span
                className="min-w-0 truncate font-mono text-xs font-semibold text-foreground"
                title={run.ruleName}
              >
                {runNumber === 1 ? "Run 1" : `Run ${runNumber}`} - {run.ruleName}
              </span>
              <Badge
                variant="outline"
                className={`h-5 font-mono text-[10px] ${
                  run.matched ? "border-emerald-500/40 text-emerald-700" : "text-muted-foreground"
                }`}
              >
                {run.matched ? "matched" : "no match"}
              </Badge>
              {delta ? (
                <Badge
                  variant="outline"
                  className={`h-5 font-mono text-[10px] ${delta.toneClassName}`}
                >
                  {delta.label}
                </Badge>
              ) : null}
            </span>
            <span className="mt-0.5 block whitespace-normal break-words text-xs leading-5 text-muted-foreground">
              {summary.matchSummary} · {summary.eventSummary} · {summary.issueSummary} · {summary.inputSummary}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2 lg:justify-end lg:py-2.5">
          <time className="font-mono text-[11px] text-muted-foreground">
            {formatHistoryRunTime(run.ranAt)}
          </time>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onRestoreResult(run.result)}
          >
            <SearchIcon />
            Review
          </Button>
        </div>
      </div>
      <CollapsibleContent>
        <div className="grid gap-2 border-t border-border/70 bg-background/40 p-2 md:grid-cols-2 xl:grid-cols-4">
          <HistoryDetailCard title="Change" value={delta?.description ?? "First retained run"} />
          <HistoryDetailCard
            title="Top signal"
            value={evidence?.primarySignal ?? (run.matched ? "Matched with no placeholder or outcome signal." : "No rule matched this run.")}
          />
          <HistoryDetailCard title="Input" value={summary.inputSummary} />
          <HistoryDetailCard title="Issues" value={summary.diagnosticPreview} />
        </div>
        {evidence ? (
          <HistoryEvidencePreview evidence={evidence} />
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

function HistoryDetailCard({
  title,
  value,
}: {
  title: string
  value: string
}) {
  return (
    <div className="rounded-sm border border-border/60 bg-background/70 px-3 py-2">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="mt-1 break-words font-mono text-[11px] leading-5 text-muted-foreground">
        {value}
      </p>
    </div>
  )
}

function HistoryEvidencePreview({ evidence }: { evidence: HistoryRunEvidence }) {
  return (
    <div className="grid gap-2 border-t border-border/70 p-2 md:grid-cols-2">
      <HistoryEvidenceCard title="Placeholders" value={evidence.placeholders} />
      <HistoryEvidenceCard title="Outcomes" value={evidence.outcomes} />
    </div>
  )
}

function HistoryEvidenceCard({
  title,
  value,
}: {
  title: string
  value: Record<string, unknown>
}) {
  const entries = Object.entries(value).slice(0, 4)
  const extraCount = Math.max(0, Object.keys(value).length - entries.length)

  return (
    <div className="rounded-sm border border-border/60 bg-background/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <Badge variant="outline" className="font-mono text-[10px]">
          {Object.keys(value).length}
        </Badge>
      </div>
      {entries.length > 0 ? (
        <div className="mt-2 grid gap-1">
          {entries.map(([name, item]) => (
            <div key={name} className="grid gap-1 font-mono text-[11px] leading-5 sm:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)]">
              <span className="min-w-0 truncate text-muted-foreground" title={`$${name}`}>${name}</span>
              <span className="min-w-0 truncate text-foreground/80" title={formatInlineValue(item)}>{formatInlineValue(item)}</span>
            </div>
          ))}
          {extraCount > 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground">+{extraCount} more</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">None returned.</p>
      )}
    </div>
  )
}

type HistoryRunSummary = {
  diagnosticPreview: string
  diagnosticCount: number
  eventSummary: string
  inputSummary: string
  issueSummary: string
  matchCount: number
  matchedEventCount: number
  matchedRuleCount: number
  matchSummary: string
}

type HistoryRunDelta = {
  description: string
  label: string
  toneClassName: string
}

function summarizeHistoryRun(run: TestRunHistoryRecord): HistoryRunSummary {
  const matchedRuleCount = run.result.rules.filter((rule) => rule.result.matched).length
  const matchCount = run.result.rules.reduce(
    (count, rule) => count + Math.max(rule.result.matches.length, rule.result.matched ? 1 : 0),
    0
  )
  const matchedEventCount = run.result.rules.reduce(
    (count, rule) => count + getTotalMatchedEventCount(rule.result),
    0
  )
  const diagnostics = run.result.rules.flatMap((rule) => [
    ...rule.diagnostics,
    ...rule.result.diagnostics,
  ])
  const diagnosticCount = diagnostics.length
  const dataTableSummary =
    run.fixtureCount > 0
      ? `${run.fixtureCount.toLocaleString()} data table${run.fixtureCount === 1 ? "" : "s"}`
      : "no data tables"

  return {
    diagnosticCount,
    diagnosticPreview: diagnostics[0]?.message ?? "No diagnostics returned.",
    eventSummary: `${matchedEventCount.toLocaleString()} matched event${matchedEventCount === 1 ? "" : "s"}`,
    inputSummary: `${run.eventCount.toLocaleString()} test event${run.eventCount === 1 ? "" : "s"}, ${dataTableSummary}`,
    issueSummary: `${diagnosticCount.toLocaleString()} issue${diagnosticCount === 1 ? "" : "s"}`,
    matchCount,
    matchedEventCount,
    matchedRuleCount,
    matchSummary: run.matched
      ? `${matchCount.toLocaleString()} match${matchCount === 1 ? "" : "es"} in ${matchedRuleCount.toLocaleString()} rule${matchedRuleCount === 1 ? "" : "s"}`
      : "no matches",
  }
}

function summarizeHistoryRunDelta(
  run: TestRunHistoryRecord,
  previousRun: TestRunHistoryRecord | null
): HistoryRunDelta | null {
  if (!previousRun) {
    return null
  }

  const current = summarizeHistoryRun(run)
  const previous = summarizeHistoryRun(previousRun)

  if (run.matched !== previousRun.matched) {
    return run.matched
      ? {
          description: `Changed from no match to ${current.matchSummary}.`,
          label: "became match",
          toneClassName: "border-emerald-500/40 text-emerald-700",
        }
      : {
          description: "Changed from matching to no matches.",
          label: "became miss",
          toneClassName: "border-rose-500/40 text-rose-700",
        }
  }

  const matchDelta = current.matchCount - previous.matchCount
  const eventDelta = current.matchedEventCount - previous.matchedEventCount
  const issueDelta = current.diagnosticCount - previous.diagnosticCount
  const parts = [
    formatHistoryDeltaPart("match", matchDelta),
    formatHistoryDeltaPart("matched event", eventDelta),
    formatHistoryDeltaPart("issue", issueDelta),
  ].filter(Boolean)
  const label =
    matchDelta !== 0
      ? formatSignedCount(matchDelta, "match")
      : eventDelta !== 0
        ? formatSignedCount(eventDelta, "event")
        : issueDelta !== 0
          ? formatSignedCount(issueDelta, "issue")
          : "no change"
  const toneClassName =
    matchDelta > 0 || eventDelta > 0
      ? "border-emerald-500/40 text-emerald-700"
      : matchDelta < 0 || eventDelta < 0 || issueDelta > 0
        ? "border-amber-500/40 text-amber-700"
        : "text-muted-foreground"

  return {
    description: parts.length > 0 ? parts.join(", ") : "Same match, event, and issue counts as the previous run.",
    label,
    toneClassName,
  }
}

function formatHistoryDeltaPart(label: string, value: number) {
  if (value === 0) {
    return null
  }
  return `${formatSignedNumber(value)} ${label}${Math.abs(value) === 1 ? "" : "s"}`
}

function formatSignedCount(value: number, label: string) {
  return `${formatSignedNumber(value)} ${label}${Math.abs(value) === 1 ? "" : "s"}`
}

function formatSignedNumber(value: number) {
  return value > 0 ? `+${value}` : `${value}`
}

function summarizeHistoryRunEvidence(run: TestRunHistoryRecord): HistoryRunEvidence | null {
  const matchedRule = run.result.rules.find((rule) => rule.result.matched)
  if (!matchedRule) {
    return null
  }

  const firstMatch = matchedRule.result.matches[0] ?? null
  const matchedEvents = firstMatch?.matchedEvents ?? matchedRule.result.matchedEvents
  const eventVariables = Object.entries(matchedEvents)
  const eventCount = eventVariables.reduce((count, [, events]) => count + events.length, 0)
  const eventSummary = `${eventCount.toLocaleString()} matched event${eventCount === 1 ? "" : "s"} across ${eventVariables.length.toLocaleString()} event variable${eventVariables.length === 1 ? "" : "s"}`
  const placeholders = firstMatch?.placeholders ?? matchedRule.result.placeholders
  const outcomes = firstMatch?.outcomes ?? matchedRule.result.outcomes
  const primarySignal =
    Object.entries(placeholders)[0]
      ? `placeholder $${Object.entries(placeholders)[0][0]} = ${formatInlineValue(Object.entries(placeholders)[0][1])}`
      : Object.entries(outcomes)[0]
        ? `outcome $${Object.entries(outcomes)[0][0]} = ${formatInlineValue(Object.entries(outcomes)[0][1])}`
        : null

  return {
    eventSummary,
    matchedRuleName: matchedRule.ruleName,
    outcomes,
    placeholders,
    primarySignal,
  }
}

function formatHistoryRunTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

function QuickEventTimeline({
  events,
  hiddenOutcomeNames,
  isRunning = false,
  onOpenFixtureEditor,
  parseError,
  result,
  sampleStats,
}: {
  events: unknown[] | null
  hiddenOutcomeNames: Set<string>
  isRunning?: boolean
  onOpenFixtureEditor: () => void
  parseError: string | null
  result: RuleTestRunResult | null
  sampleStats: ReturnType<typeof summarizeSampleEvents> | null
}) {
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(() => new Set())
  const visibleEvents = (events ?? []).slice(0, QUICK_TIMELINE_EVENT_LIMIT)
  const matchedRulesByEvent = useMemo(
    () => buildMatchedRulesByEvent(visibleEvents, result),
    [visibleEvents, result]
  )
  const matchGroups = useMemo(() => buildQuickMatchGroups(result), [result])
  const hasMatchedRule = result?.rules.some((rule) => rule.result.matched) ?? false

  if (!result) {
    const isBlocked = Boolean(parseError)
    const title = isBlocked ? "Cannot run test" : "Begin a test"
    const description = parseError ?? "Run the current rule to see event matches here."

    return (
      <section className="flex min-h-0 flex-1 items-center justify-center px-3 py-4 text-center sm:px-4">
        <div className="w-full min-w-0 max-w-2xl px-4 py-5">
          <div
            className={`mx-auto mb-2 flex size-8 items-center justify-center rounded-full border ${
              isBlocked
                ? "border-destructive/25 bg-destructive/10 text-destructive"
                : "border-primary/25 bg-primary/10 text-primary"
            }`}
          >
            {isRunning ? (
              <LoadingIndicator className="text-primary" markClassName="size-4" />
            ) : isBlocked ? (
              <AlertTriangleIcon className="size-4" />
            ) : (
              <PlayIcon className="size-4" />
            )}
          </div>
          {!isRunning ? (
            <>
              <p className="text-sm font-medium text-foreground">
                {title}
              </p>
              <p className={`mx-auto mt-1 max-w-full whitespace-normal break-words px-1 text-xs leading-5 sm:max-w-xl ${isBlocked ? "text-foreground/80" : "text-muted-foreground"}`}>
                {description}
              </p>
            </>
          ) : null}
          <div className="mt-1 flex min-h-8 flex-wrap items-center justify-center gap-1.5">
            {!isRunning && !isBlocked && sampleStats ? (
              <>
                <QuickStatBadge
                  emptyLabel="0 sources"
                  items={sampleStats.logSources}
                  label={`${sampleStats.logSources.length} sources`}
                  title="Log Sources"
                />
                <QuickStatBadge
                  emptyLabel="0 event types"
                  items={sampleStats.eventTypes}
                  label={`${sampleStats.eventTypes.length} event types`}
                  title="Event Types"
                />
              </>
            ) : null}
          </div>
        </div>
      </section>
    )
  }

  if (!hasMatchedRule && matchGroups.length === 0) {
    const checkedEventCount = sampleStats?.eventCount ?? events?.length ?? 0

    return (
      <section className="flex min-h-0 flex-1 items-center justify-center px-3 py-4 text-center sm:px-4">
        <div className="w-full min-w-0 max-w-2xl px-4 py-5">
          <div className="mx-auto mb-2 flex size-8 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-amber-600">
            <CircleXIcon className="size-4" />
          </div>
          <p className="text-sm font-medium text-foreground">No detection</p>
          <p className="mx-auto mt-1 max-w-full whitespace-normal break-words px-1 text-xs leading-5 text-muted-foreground sm:max-w-xl">
            Checked {checkedEventCount} test event{checkedEventCount === 1 ? "" : "s"} with no
            matching group.
          </p>
          <div className="mt-1 flex min-h-8 flex-wrap items-center justify-center gap-1.5">
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              0 matches
            </Badge>
            {sampleStats ? (
              <>
                <QuickStatBadge
                  emptyLabel="0 sources"
                  items={sampleStats.logSources}
                  label={`${sampleStats.logSources.length} sources`}
                  title="Log Sources"
                />
                <QuickStatBadge
                  emptyLabel="0 event types"
                  items={sampleStats.eventTypes}
                  label={`${sampleStats.eventTypes.length} event types`}
                  title="Event Types"
                />
              </>
            ) : null}
          </div>
        </div>
      </section>
    )
  }

  if (visibleEvents.length === 0 && matchGroups.length === 0) {
    return null
  }

  function setEventOpen(index: number, open: boolean) {
    setExpandedEvents((previous) => {
      const next = new Set(previous)
      if (open) {
        next.add(index)
      } else {
        next.delete(index)
      }
      return next
    })
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden text-center">
      <ScrollArea className="min-h-0 w-full flex-1 text-left" data-testid="quick-test-results-scroll-area">
        <div className="space-y-2 px-1 py-1">
        <QuickMatchGroups groups={matchGroups} hiddenOutcomeNames={hiddenOutcomeNames} />
        {matchGroups.length === 0 ? visibleEvents.map((event, index) => {
          const summary = summarizeFixtureEvent(event, index)
          const matchedRules = matchedRulesByEvent.get(index) ?? []
          const matched = matchedRules.length > 0
          const isOpen = expandedEvents.has(index)
          return (
            <Collapsible
              key={index}
              open={isOpen}
              onOpenChange={(open) => setEventOpen(index, open)}
              className={`overflow-hidden rounded-md border border-l-2 ${
                matched
                  ? "border-emerald-500/30 border-l-emerald-500 bg-emerald-500/10"
                  : "border-border border-l-muted-foreground/30 bg-muted/20"
              }`}
            >
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="grid h-auto w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start justify-normal gap-2 px-2 py-2 text-left hover:bg-muted/40 sm:grid-cols-[auto_minmax(0,0.35fr)_minmax(0,1fr)_auto_auto_auto] sm:gap-3 sm:px-3"
                >
                  {isOpen ? (
                    <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 break-words font-mono text-xs font-semibold leading-5 text-foreground/80">
                    {summary.eventType}
                  </span>
                  <span className="hidden min-w-0 break-words font-mono text-[11px] leading-5 text-muted-foreground sm:block">
                    {summary.injectionLabel
                      ? summary.injectionLabel
                      : matched
                        ? matchedRules.join(", ")
                        : "no match"}
                  </span>
                  <span className="hidden min-w-0 break-words font-mono text-[11px] leading-5 text-muted-foreground xl:block">
                    {summary.timestamp}
                  </span>
                  {summary.injectionLabel ? (
                    <Badge
                      variant="outline"
                      className="hidden h-5 border-amber-500/40 font-mono text-[10px] text-amber-700 sm:inline-flex"
                    >
                      inject
                    </Badge>
                  ) : (
                    <span className="hidden xl:block" />
                  )}
                  <Badge
                    variant="outline"
                    className={`h-5 font-mono text-[10px] ${
                      matched ? "border-emerald-500/40 text-emerald-700" : "text-muted-foreground"
                    }`}
                  >
                    {matched ? "yes" : "no"}
                  </Badge>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t bg-background/60 p-3">
                  <EventFieldInspector event={event} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )
        }) : null}
        </div>
      {matchGroups.length === 0 && events && events.length > visibleEvents.length ? (
        <p className="px-2 pb-2 font-mono text-[11px] text-muted-foreground">
          Showing first {visibleEvents.length} of {events.length} events.
        </p>
      ) : null}
      </ScrollArea>
    </section>
  )
}

function OutcomeCombobox({
  hiddenOutcomeNames,
  outcomeNames,
  onHideAll,
  onShowAll,
  onVisibilityChange,
}: {
  hiddenOutcomeNames: Set<string>
  outcomeNames: string[]
  onHideAll: () => void
  onShowAll: () => void
  onVisibilityChange: (name: string, visible: boolean) => void
}) {
  if (outcomeNames.length === 0) {
    return null
  }

  const visibleCount = outcomeNames.filter((name) => !hiddenOutcomeNames.has(name)).length

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 max-w-full text-xs"
          aria-label="Select outcomes"
        >
          <ListChecksIcon />
          Outcomes
          <Badge variant="secondary" className="ml-0.5 h-5 px-1.5 font-mono text-[10px]">
            {visibleCount}/{outcomeNames.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search outcomes" className="font-mono text-xs" />
          <CommandList>
            <CommandEmpty>No outcomes found.</CommandEmpty>
            <CommandGroup heading="Outcome values">
              <CommandItem onSelect={onShowAll}>
                <CheckIcon className="opacity-0" />
                Show all outcomes
              </CommandItem>
              <CommandItem onSelect={onHideAll}>
                <CheckIcon className="opacity-0" />
                Hide all outcomes
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {outcomeNames.map((name) => {
                const isVisible = !hiddenOutcomeNames.has(name)
                return (
                  <CommandItem
                    key={name}
                    value={name}
                    className="font-mono text-xs"
                    onSelect={() => onVisibilityChange(name, !isVisible)}
                  >
                    <CheckIcon className={`size-3.5 ${isVisible ? "opacity-100" : "opacity-0"}`} />
                    <span className="min-w-0 truncate" title={`$${name}`}>${name}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function QuickStatBadge({
  emptyLabel,
  items,
  label,
  title,
}: {
  emptyLabel: string
  items: Array<[string, number]>
  label: string
  title: string
}) {
  const badge = (
    <Badge variant="outline" className="gap-1.5 font-mono text-[10px]">
      {items.length > 0 ? label : emptyLabel}
      {items.length > 0 ? <InfoIcon className="size-3" /> : null}
    </Badge>
  )

  if (items.length === 0) {
    return badge
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" className="size-auto rounded-full p-0">
          {badge}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="grid max-w-sm gap-1.5 bg-foreground p-2 text-background"
      >
        <p className="px-1 text-[11px] font-semibold uppercase tracking-normal opacity-80">
          {title}
        </p>
        <ScrollArea className="max-h-64 min-w-56">
          <div className="grid gap-1 pr-3">
            {items.map(([name, count]) => (
              <div
                key={name}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 rounded-sm px-1 py-0.5 font-mono text-[11px]"
              >
                <span className="min-w-0 truncate" title={name}>{name}</span>
                <span className="opacity-75">{count}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </TooltipContent>
    </Tooltip>
  )
}

type QuickMatchGroupSummary = {
  eventCount: number
  events: unknown[]
  groupIndex: number
  outcomes: Record<string, unknown>
  ruleName: string
  spanLabel: string
}

function QuickMatchGroups({
  groups,
  hiddenOutcomeNames,
}: {
  groups: QuickMatchGroupSummary[]
  hiddenOutcomeNames: Set<string>
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
  if (groups.length === 0) {
    return null
  }

  function setGroupOpen(key: string, open: boolean) {
    setExpandedGroups((previous) => {
      const next = new Set(previous)
      if (open) {
        next.add(key)
      } else {
        next.delete(key)
      }
      return next
    })
  }

  return (
    <section className="space-y-2">
      {groups.slice(0, 12).map((group) => {
        const key = `${group.ruleName}:${group.groupIndex}`
        const isOpen = expandedGroups.has(key)
        const visibleEvents = group.events.slice(0, 6)
        const hiddenEventCount = Math.max(0, group.events.length - visibleEvents.length)
        const visibleOutcomes = filterOutcomeRecord(group.outcomes, hiddenOutcomeNames)
        return (
          <Collapsible
            key={key}
            open={isOpen}
            onOpenChange={(open) => setGroupOpen(key, open)}
            className="overflow-hidden rounded-md border border-border/70"
          >
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="grid h-auto w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center justify-normal gap-3 rounded-none px-3 py-2.5 text-left hover:bg-muted/35"
              >
                {isOpen ? (
                  <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <CheckCircleIcon className="size-3.5 shrink-0 text-emerald-600" />
                    <span className="truncate font-mono text-xs font-semibold text-foreground">
                      {group.ruleName}
                    </span>
                  </span>
                  <span className="mt-0.5 block whitespace-normal break-words font-mono text-[11px] leading-4 text-muted-foreground">
                    Event span · {group.spanLabel}
                  </span>
                </span>
                <Badge variant="outline" className="h-6 shrink-0 font-mono text-[11px]">
                  {group.eventCount} event{group.eventCount === 1 ? "" : "s"}
                </Badge>
              </Button>
            </CollapsibleTrigger>
            {Object.keys(group.outcomes).length > 0 ? (
              <OutcomePreviewStrip outcomes={visibleOutcomes} totalCount={Object.keys(group.outcomes).length} />
            ) : null}
            <CollapsibleContent>
              <div className="grid gap-1 border-t border-border/70 p-1">
                {visibleEvents.map((event, index) => {
                  const summary = summarizeFixtureEvent(event, index)
                  return (
                    <Collapsible
                      key={`${group.ruleName}:${group.groupIndex}:${index}`}
                      className="bg-transparent"
                    >
                      <CollapsibleTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          className="grid h-auto w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start justify-normal gap-3 rounded-sm px-3 py-2.5 text-left hover:bg-muted/35 sm:grid-cols-[auto_minmax(0,0.35fr)_minmax(0,1fr)_auto]"
                        >
                          <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 break-words font-mono text-xs font-semibold text-foreground/80">
                            {summary.eventType}
                          </span>
                          <span className="hidden min-w-0 truncate font-mono text-xs text-muted-foreground sm:block">
                            {summary.timestamp}
                          </span>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            event {index + 1}
                          </Badge>
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="border-t border-border/60 p-3">
                          <EventFieldInspector event={event} />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )
                })}
                {hiddenEventCount > 0 ? (
                  <p className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    Showing 6 of {group.events.length} events in this group.
                  </p>
                ) : null}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )
      })}
      {groups.length > 12 ? (
        <p className="px-1 pt-1 font-mono text-[11px] text-muted-foreground">
          Showing 12 of {groups.length} detections.
        </p>
      ) : null}
    </section>
  )
}

function OutcomePreviewStrip({
  outcomes,
  totalCount,
}: {
  outcomes: Record<string, unknown>
  totalCount: number
}) {
  const entries = Object.entries(outcomes).slice(0, 4)
  const hiddenByLimit = Math.max(0, Object.keys(outcomes).length - entries.length)
  const hiddenByFilter = Math.max(0, totalCount - Object.keys(outcomes).length)

  return (
    <div className="border-t border-border/70 px-3 py-2">
      {entries.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([name, value]) => (
            <Badge
              key={name}
              variant="outline"
              className="max-w-full gap-1.5 font-mono text-[10px]"
              title={`$${name} = ${formatInlineValue(value)}`}
            >
              <span className="min-w-0 max-w-40 truncate">${name}</span>
              <span className="min-w-0 max-w-48 truncate text-muted-foreground">
                {formatInlineValue(value)}
              </span>
            </Badge>
          ))}
          {hiddenByLimit > 0 ? (
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              +{hiddenByLimit} more
            </Badge>
          ) : null}
        </div>
      ) : (
        <p className="font-mono text-[11px] text-muted-foreground">
          {hiddenByFilter > 0 ? "All outcomes hidden by selector." : "No outcomes returned."}
        </p>
      )}
    </div>
  )
}

function buildQuickMatchGroups(result: RuleTestRunResult | null): QuickMatchGroupSummary[] {
  if (!result) {
    return []
  }

  return result.rules.flatMap((rule) => {
    const matches =
      rule.result.matches.length > 0
        ? rule.result.matches
        : rule.result.matched
          ? [{ matchedEvents: rule.result.matchedEvents }]
          : []

    return matches.map((match, index) => {
      const events = Object.values(match.matchedEvents).flat()
      return {
        eventCount: events.length,
        events,
        groupIndex: index + 1,
        outcomes: "outcomes" in match ? match.outcomes : rule.result.outcomes,
        ruleName: rule.ruleName,
        spanLabel: formatEventGroupSpan(events),
      }
    })
  })
}

function formatEventGroupSpan(events: unknown[]) {
  const timestamps = events
    .map(getEventTimestampMs)
    .filter((timestamp): timestamp is number => Number.isFinite(timestamp))
    .sort((left, right) => left - right)
  if (timestamps.length === 0) {
    return "no timestamps"
  }
  const first = new Date(timestamps[0]).toISOString()
  const last = new Date(timestamps[timestamps.length - 1]).toISOString()
  if (first === last) {
    return formatTimestampLabel(first)
  }
  const hours = (timestamps[timestamps.length - 1] - timestamps[0]) / (60 * 60 * 1000)
  return `${formatTimestampLabel(first)} - ${formatTimestampLabel(last)} (${formatDurationHours(hours)})`
}

function buildMatchedRulesByEvent(
  events: unknown[],
  result: RuleTestRunResult | null
) {
  const matchedKeys = new Map<string, Set<string>>()
  if (!result) {
    return new Map<number, string[]>()
  }

  for (const rule of result.rules) {
    for (const matchedEvents of Object.values(rule.result.matchedEvents)) {
      for (const event of matchedEvents) {
        const key = stableEventKey(event)
        matchedKeys.set(key, new Set([...(matchedKeys.get(key) ?? []), rule.ruleName]))
      }
    }
    for (const match of rule.result.matches) {
      for (const matchedEvents of Object.values(match.matchedEvents)) {
        for (const event of matchedEvents) {
          const key = stableEventKey(event)
          matchedKeys.set(key, new Set([...(matchedKeys.get(key) ?? []), rule.ruleName]))
        }
      }
    }
  }

  return new Map(
    events.map((event, index) => [
      index,
      [...(matchedKeys.get(stableEventKey(event)) ?? [])].sort(),
    ])
  )
}

function FixtureEventBrowser({
  events,
  isExpanded = false,
  parseError,
  onCloseExpanded,
  onExpand,
  onSampleEventsTextChange,
}: {
  events: unknown[] | null
  isExpanded?: boolean
  parseError: string | null
  onCloseExpanded?: () => void
  onExpand?: () => void
  onSampleEventsTextChange: (text: string) => void
}) {
  const [expandedEventIndex, setExpandedEventIndex] = useState<number | null>(null)
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null)
  const eventRows = useMemo(
    () =>
      (events ?? []).slice(0, MAX_FIXTURE_BUILDER_EVENTS).map((event, index) => ({
        event,
        index,
        summary: summarizeFixtureEvent(event, index),
      })),
    [events]
  )
  const hiddenEventCount = Math.max(0, (events?.length ?? 0) - eventRows.length)

  useEffect(() => {
    if (!events?.length) {
      setSelectedEventIndex(null)
      setExpandedEventIndex(null)
      return
    }
    if (selectedEventIndex === null || selectedEventIndex >= events.length) {
      setSelectedEventIndex(0)
    }
  }, [events, selectedEventIndex])

  function handleEventSelect(index: number, isOpen: boolean) {
    setSelectedEventIndex(index)
    setExpandedEventIndex(isOpen ? null : index)
  }

  function handleEventJsonChange(index: number, nextEvent: unknown) {
    if (!events) {
      return
    }
    const nextEvents = events.map((event, eventIndex) =>
      eventIndex === index ? nextEvent : event
    )
    onSampleEventsTextChange(JSON.stringify(nextEvents, null, 2))
  }

  function handleRemoveEvent(index: number) {
    if (!events) {
      return
    }
    const nextEvents = events.filter((_, eventIndex) => eventIndex !== index)
    onSampleEventsTextChange(JSON.stringify(nextEvents, null, 2))
    setExpandedEventIndex((current) => {
      if (current === null) {
        return null
      }
      if (current === index) {
        return null
      }
      return current > index ? current - 1 : current
    })
    setSelectedEventIndex((current) => {
      if (current === null) {
        return null
      }
      if (nextEvents.length === 0) {
        return null
      }
      if (current === index) {
        return Math.min(index, nextEvents.length - 1)
      }
      return current > index ? current - 1 : current
    })
  }

  function handleDuplicateEvent(index: number) {
    if (!events || events.length >= MAX_FIXTURE_BUILDER_EVENTS) {
      return
    }
    const event = events[index]
    if (event === undefined) {
      return
    }
    const duplicatedEvent = JSON.parse(JSON.stringify(event)) as unknown
    const nextEvents = [
      ...events.slice(0, index + 1),
      duplicatedEvent,
      ...events.slice(index + 1),
    ]
    onSampleEventsTextChange(JSON.stringify(nextEvents, null, 2))
    setSelectedEventIndex(index + 1)
    setExpandedEventIndex(index + 1)
  }

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden bg-sidebar ${
        isExpanded
          ? "fixed inset-3 left-3 top-3 z-50 rounded-lg border border-sidebar-border shadow-xl lg:inset-8 lg:left-8 lg:top-8"
          : "flex-1"
      }`}
    >
      <div className="border-b border-sidebar-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
              Test Events
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge variant="outline" className="font-mono text-[10px]">
              {events?.length ?? 0}/{MAX_FIXTURE_BUILDER_EVENTS}
            </Badge>
            {isExpanded ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="Collapse test events"
                aria-label="Collapse test events"
                onClick={onCloseExpanded}
              >
                <Minimize2Icon />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="Expand test events"
                aria-label="Expand test events"
                onClick={onExpand}
              >
                <Maximize2Icon />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div
        data-testid="test-events-scroll-area"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="space-y-2 p-3">
          {parseError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-8 text-center">
              <AlertTriangleIcon className="mx-auto mb-2 size-4 text-destructive" />
              <p className="text-sm font-medium text-destructive">Test event JSON needs attention</p>
              <p className="mt-1 font-mono text-[11px] text-destructive/80">{parseError}</p>
            </div>
          ) : eventRows.length > 0 ? (
            eventRows.map(({ event, index, summary }) => {
              const isOpen = expandedEventIndex === index
              return (
                <div key={index} className="rounded-md border border-sidebar-border bg-sidebar-accent/35">
                  <div
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md hover:bg-sidebar-accent/70 ${
                      selectedEventIndex === index ? "bg-sidebar-accent ring-1 ring-primary/30" : ""
                    }`}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      className="grid h-auto min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start justify-normal gap-3 px-3 py-2 text-left hover:bg-transparent"
                      onClick={() => handleEventSelect(index, isOpen)}
                    >
                      {isOpen ? (
                        <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-xs font-semibold text-foreground/80">
                          {summary.eventType}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                          {[summary.timestamp, summary.source, summary.host, summary.user, summary.process]
                            .filter(Boolean)
                            .join("  ")}
                        </span>
                      </span>
                    </Button>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 px-2 py-2">
                      {summary.injectionLabel ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 font-mono text-[10px] text-amber-700"
                        >
                          inject
                        </Badge>
                      ) : null}
                      <Badge variant="outline" className="font-mono text-[10px]">
                        #{index + 1}
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 text-muted-foreground hover:bg-sidebar hover:text-foreground"
                        title={
                          (events?.length ?? 0) >= MAX_FIXTURE_BUILDER_EVENTS
                            ? `Test case already has ${MAX_FIXTURE_BUILDER_EVENTS} events`
                            : "Duplicate event"
                        }
                        disabled={(events?.length ?? 0) >= MAX_FIXTURE_BUILDER_EVENTS}
                        onClick={() => handleDuplicateEvent(index)}
                      >
                        <CopyIcon className="size-3.5" />
                        <span className="sr-only">Duplicate event</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Remove event"
                        onClick={() => handleRemoveEvent(index)}
                      >
                        <Trash2Icon className="size-3.5" />
                        <span className="sr-only">Remove event</span>
                      </Button>
                    </div>
                  </div>
                  {isOpen ? (
                    <div className="border-t border-sidebar-border bg-sidebar p-2">
                      <EventTimestampEditor
                        event={event}
                        onChange={(nextEvent) => handleEventJsonChange(index, nextEvent)}
                      />
                      <EventFieldInspector
                        event={event}
                        editableJson
                        onJsonChange={(nextEvent) => handleEventJsonChange(index, nextEvent)}
                      />
                    </div>
                  ) : null}
                </div>
              )
            })
          ) : (
            <EmptyState
              className="rounded-md border-sidebar-border bg-sidebar-accent/40 px-3 py-8"
              description="Use Add event to create one manually, Import a JSON test case, or Generate Draft from the active rule."
              title="No test events yet"
            />
          )}
          {hiddenEventCount > 0 ? (
            <p className="px-1 font-mono text-[11px] text-muted-foreground">
              Showing first {MAX_FIXTURE_BUILDER_EVENTS} events. Trim the test case JSON to keep this test focused.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function EventTimestampEditor({
  event,
  onChange,
}: {
  event: unknown
  onChange: (event: unknown) => void
}) {
  const timestampMs = getEventTimestampMs(event)
  const [value, setValue] = useState(() =>
    timestampMs === null ? "" : toDateTimeLocalInput(timestampMs)
  )

  useEffect(() => {
    setValue(timestampMs === null ? "" : toDateTimeLocalInput(timestampMs))
  }, [timestampMs])

  function handleTimestampChange(nextValue: string) {
    setValue(nextValue)
    const nextTimestampMs = parseDateTimeLocalInput(nextValue)
    if (nextTimestampMs !== null) {
      onChange(setEventTimestamp(event, nextTimestampMs))
    }
  }

  return (
    <div className="mb-2 grid gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/35 p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <DateTimeFieldGroup
        idPrefix="selected-event-time"
        value={value}
        onChange={handleTimestampChange}
      />
      <Badge variant="outline" className="w-fit font-mono text-[10px]">
        {timestampMs === null ? "no timestamp" : formatTimestampLabel(new Date(timestampMs).toISOString())}
      </Badge>
    </div>
  )
}

function summarizeFixtureEvent(event: unknown, index: number) {
  return {
    eventType: getNestedString(event, ["metadata", "event_type"]) ?? `EVENT_${index + 1}`,
    host:
      getNestedString(event, ["principal", "hostname"]) ??
      getNestedString(event, ["target", "hostname"]) ??
      "",
    process:
      getNestedString(event, ["principal", "process", "command_line"]) ??
      getNestedString(event, ["target", "process", "command_line"]) ??
      "",
    source: getEventLogSource(event),
    timestamp: formatEventTimestamp(event),
    injectionLabel: getLegacyInjectionLabel(event),
    user:
      getNestedString(event, ["principal", "user", "userid"]) ??
      getNestedString(event, ["target", "user", "userid"]) ??
      "",
  }
}

function getLegacyInjectionLabel(event: unknown) {
  const summary = getNestedString(event, ["security_result", "summary"])
  const prefix = "Scenario injection: "
  return summary?.startsWith(prefix) ? summary.slice(prefix.length) : ""
}

function createIntentProcessEvent({
  commandLine,
  host,
  index,
  timestamp,
  user,
}: {
  commandLine: string
  host: string
  index: number
  timestamp: UdmTimestamp
  user: string
}) {
  const fileName = commandLine.split(/\s+/)[0]?.replace(/^.*[\\/]/, "") || "process.exe"
  return {
    metadata: {
      event_timestamp: timestamp,
      event_type: "PROCESS_LAUNCH",
      product_name: "Windows EDR",
      vendor_name: "Microsoft",
    },
    principal: {
      hostname: host,
      process: {
        command_line: commandLine,
        file: {
          full_path: `C:\\Windows\\System32\\${fileName}`,
        },
        pid: 80000 + index,
      },
      user: {
        userid: user,
      },
    },
    security_result: {
      action: "ALLOW",
      summary: `Intent positive: process command ${commandLine}`,
    },
  }
}

function createIntentLoginEvent({
  host,
  index,
  timestamp,
  user,
}: {
  host: string
  index: number
  timestamp: UdmTimestamp
  user: string
}) {
  return {
    metadata: {
      event_timestamp: timestamp,
      event_type: "USER_LOGIN",
      product_name: "Windows Security",
      vendor_name: "Microsoft",
    },
    principal: {
      hostname: host,
      ip: [`10.0.5.${20 + (index % 120)}`],
      user: {
        userid: user,
      },
    },
    security_result: {
      action: "ALLOW",
      summary: `Intent positive: login by ${user}`,
    },
  }
}

function parseSampleEvents(text: string): ParsedSampleEvents {
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      return { events: null, error: "Sample events must be a JSON array." }
    }
    const timestampedEvents = addMissingEventTimestamps(parsed)
    const safetyError = validateJsonValueSafety(timestampedEvents, "Sample events")
    if (safetyError) {
      return { events: null, error: safetyError }
    }
    const eventError = validateUdmEvents(timestampedEvents)
    if (eventError) {
      return { events: null, error: eventError }
    }
    return { events: timestampedEvents, error: null }
  } catch (error) {
    return {
      events: null,
      error: error instanceof Error ? error.message : "Invalid JSON.",
    }
  }
}

function normalizeSampleEventsText(text: string) {
  const parsed = parseSampleEvents(text)
  return parsed.events ? JSON.stringify(parsed.events, null, 2) : text
}

function addMissingEventTimestamps(events: unknown[]) {
  const baseTimestampMs = Date.now() - events.length * 60 * 1000
  return events.map((event, index) =>
    addMissingEventTimestamp(event, baseTimestampMs + index * 60 * 1000)
  )
}

function addMissingEventTimestamp(event: unknown, timestampMs: number) {
  if (!isRecord(event)) {
    return event
  }
  if (getEventTimestampMs(event) !== null) {
    return event
  }
  const metadata = isRecord(event.metadata) ? event.metadata : {}
  return {
    ...event,
    metadata: {
      ...metadata,
      event_timestamp: createUdmTimestamp(timestampMs),
    },
  }
}

function toFixtureFileName(name: string) {
  const fileName = name
    .trim()
    .toLowerCase()
    .replace(/\.json$/i, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return fileName || "udm-test-case"
}

function toFixtureName(fileName: string) {
  const name = fileName
    .replace(/\.json$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
  return name || "Imported test case"
}

function buildFixtureLastRunSummary(result: RuleTestRunResult) {
  const matchedRules = result.rules.filter((rule) => rule.result.matched).length
  const matchedEvents = result.rules.reduce(
    (count, rule) => count + getTotalMatchedEventCount(rule.result),
    0
  )
  const issueCount =
    result.diagnostics.length +
    result.rules.reduce(
      (count, rule) => count + rule.diagnostics.length + rule.result.diagnostics.length,
      0
    )
  return `Last run: ${new Date().toISOString()} | ${matchedRules}/${result.rules.length} rules matched | ${matchedEvents} matched events | ${issueCount} issues`
}

function upsertFixtureLastRunSummary(description: string, summary: string) {
  const lines = description
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("Last run:"))
  return [...lines, summary].filter((line) => line.trim().length > 0).join("\n")
}

function stripFixtureFolderMetadata(description: string) {
  return description
    .split(/\r?\n/)
    .filter((line) => !/^\s*folder\s*[:=]/i.test(line))
    .join("\n")
    .trim()
}

function upsertFixtureFolderMetadata(description: string, folder: string) {
  const cleanedDescription = stripFixtureFolderMetadata(description)
  const normalizedFolder = folder.trim()
  if (!normalizedFolder) {
    return cleanedDescription
  }
  return [cleanedDescription, `folder: ${normalizedFolder}`]
    .filter((line) => line.trim().length > 0)
    .join("\n")
}

function parseFixtureDescriptionMetadata(description: string) {
  const folder =
    description.match(/(?:^|\n)\s*folder\s*[:=]\s*([^\n]+)/i)?.[1]?.trim() ?? null
  const source =
    description.match(/(?:^|\n)\s*source\s*[:=]\s*([^\n]+)/i)?.[1]?.trim() ?? null
  const tagsText = description.match(/(?:^|\n)\s*tags?\s*[:=]\s*([^\n]+)/i)?.[1] ?? ""
  const tags = [
    ...new Set(
      tagsText
        .split(/[,;\s]+/)
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean)
    ),
  ]
  return { folder, source, tags }
}

function groupFixturesByFolder(fixtures: SampleFixture[]) {
  const groups = new Map<string, SampleFixture[]>()
  for (const fixture of fixtures) {
    const folder = parseFixtureDescriptionMetadata(fixture.description ?? "").folder || "Default"
    groups.set(folder, [...(groups.get(folder) ?? []), fixture])
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === "Default") {
        return 1
      }
      if (right === "Default") {
        return -1
      }
      return left.localeCompare(right)
    })
    .map(([folder, groupFixtures]) => ({ folder, fixtures: groupFixtures }))
}

function stableEventKey(value: unknown) {
  return JSON.stringify(sortJson(value))
}

function formatInlineValue(value: unknown) {
  if (typeof value === "string") {
    return JSON.stringify(value)
  }
  if (value === undefined) {
    return "undefined"
  }
  return JSON.stringify(value)
}

function summarizeSampleEvents(events: unknown[]) {
  const eventTypes = new Map<string, number>()
  const injections = new Map<string, number>()
  const logSources = new Map<string, number>()
  const timestamps: number[] = []
  const timelineEvents: Array<{ injected: boolean; timestamp: number }> = []
  let objectCount = 0

  for (const event of events) {
    if (event && typeof event === "object" && !Array.isArray(event)) {
      objectCount += 1
      const eventType = getNestedString(event, ["metadata", "event_type"]) ?? "unknown"
      eventTypes.set(eventType, (eventTypes.get(eventType) ?? 0) + 1)
      const logSource = getEventLogSource(event)
      logSources.set(logSource, (logSources.get(logSource) ?? 0) + 1)
      const injectionLabel = getLegacyInjectionLabel(event)
      if (injectionLabel) {
        injections.set(injectionLabel, (injections.get(injectionLabel) ?? 0) + 1)
      }
      const timestamp = getEventTimestampMs(event)
      if (timestamp !== null) {
        timestamps.push(timestamp)
        timelineEvents.push({
          injected: Boolean(injectionLabel),
          timestamp,
        })
      }
    }
  }
  timestamps.sort((left, right) => left - right)
  const firstTimestamp = timestamps[0] ? new Date(timestamps[0]).toISOString() : null
  const lastTimestamp = timestamps.at(-1) ? new Date(timestamps.at(-1) as number).toISOString() : null
  const timelineHours =
    timestamps.length > 1
      ? (timestamps[timestamps.length - 1] - timestamps[0]) / (60 * 60 * 1000)
      : 0
  const timelineBuckets = buildTimelineBuckets(timelineEvents)

  return {
    eventCount: events.length,
    eventTypes: [...eventTypes.entries()].sort(([left], [right]) => left.localeCompare(right)),
    firstTimestamp,
    injections: [...injections.entries()].sort(([, leftCount], [, rightCount]) => rightCount - leftCount),
    logSources: [...logSources.entries()].sort(([, leftCount], [, rightCount]) => rightCount - leftCount),
    lastTimestamp,
    objectCount,
    timelineBuckets,
    timelineHours,
    timestampCount: timestamps.length,
  }
}

function formatTimestampLabel(timestamp: string | null) {
  if (!timestamp) {
    return "none"
  }
  return timestamp.replace(".000Z", "Z").replace("T", " ")
}

function formatDurationHours(hours: number) {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`
  }
  return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`
}

function buildTimelineBuckets(events: Array<{ injected: boolean; timestamp: number }>) {
  if (events.length === 0) {
    return []
  }
  const timestamps = events.map((event) => event.timestamp).sort((left, right) => left - right)
  const first = timestamps[0]
  const last = timestamps[timestamps.length - 1]
  const bucketCount = Math.min(8, Math.max(1, timestamps.length))
  const span = Math.max(1, last - first)
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = first + (span / bucketCount) * index
    return {
      count: 0,
      injectionCount: 0,
      label: formatTimestampLabel(new Date(bucketStart).toISOString()),
    }
  })

  for (const event of events) {
    const index =
      bucketCount === 1
        ? 0
        : Math.min(bucketCount - 1, Math.floor(((event.timestamp - first) / span) * bucketCount))
    buckets[index].count += 1
    if (event.injected) {
      buckets[index].injectionCount += 1
    }
  }

  return buckets
}

function getEventLogSource(event: unknown) {
  const vendor = getNestedString(event, ["metadata", "vendor_name"])
  const product = getNestedString(event, ["metadata", "product_name"])
  const logSource = getNestedString(event, ["metadata", "log_source"])
  const productEventType = getNestedString(event, ["metadata", "product_event_type"])

  if (vendor && product) {
    return `${vendor} / ${product}`
  }
  return logSource ?? product ?? productEventType ?? "unknown source"
}

function getEventTimestampMs(event: unknown) {
  const timestampValue =
    getNestedValue(event, ["metadata", "event_timestamp"]) ??
    getNestedValue(event, ["metadata", "collected_timestamp"]) ??
    getNestedValue(event, ["metadata", "ingested_timestamp"]) ??
    getNestedValue(event, ["event_timestamp"]) ??
    getNestedValue(event, ["timestamp"])

  return parseTimestampMs(timestampValue)
}

function formatEventTimestamp(event: unknown) {
  const timestamp = getEventTimestampMs(event)
  return timestamp === null ? "no timestamp" : formatTimestampLabel(new Date(timestamp).toISOString())
}


function getNestedString(value: unknown, path: string[]) {
  let current = value
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === "string" && current.trim() ? current : null
}

function SampleStatsBar({
  stats,
}: {
  stats: ReturnType<typeof summarizeSampleEvents>
}) {
  const visibleTypes = stats.eventTypes.slice(0, 3)
  const hiddenTypeCount = Math.max(0, stats.eventTypes.length - visibleTypes.length)

  return (
    <div className="flex h-9 shrink-0 items-center gap-1.5 overflow-hidden border-b px-3">
      <Badge variant={stats.objectCount === stats.eventCount ? "outline" : "destructive"} className="font-mono text-[10px]">
        {stats.objectCount}/{stats.eventCount} objects
      </Badge>
      {visibleTypes.map(([eventType, count]) => (
        <Badge key={eventType} variant="outline" className="min-w-0 max-w-40 font-mono text-[10px]">
          <span className="truncate">{eventType}</span>
          <span>{count}</span>
        </Badge>
      ))}
      {hiddenTypeCount > 0 ? (
        <Badge variant="outline" className="font-mono text-[10px]">
          +{hiddenTypeCount}
        </Badge>
      ) : null}
    </div>
  )
}

function RunSummary({ result }: { result: RuleTestRunResult }) {
  const matchedRules = result.rules.filter((rule) => rule.result.matched).length
  const matchedEventCount = result.rules.reduce(
    (count, rule) => count + getTotalMatchedEventCount(rule.result),
    0
  )
  const hasMatch = matchedRules > 0

  return (
    <section
      className={`rounded-lg border px-4 py-4 ${
        hasMatch
          ? "border-emerald-500/35 bg-emerald-500/10"
          : "border-border bg-muted/20"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {hasMatch ? (
            <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : (
            <CircleXIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p
              className={`text-sm font-semibold ${
                hasMatch ? "text-emerald-700" : "text-foreground"
              }`}
            >
              {hasMatch ? "Matched" : "No Match"}
            </p>
            <p className="mt-0.5 text-xs text-foreground/60">
              {matchedRules}/{result.rules.length} rule{result.rules.length === 1 ? "" : "s"} matched, {matchedEventCount} matched event{matchedEventCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="outline" className="font-mono text-[10px]">
            {result.rules.length} rules
          </Badge>
          <Badge
            variant="outline"
            className={
              hasMatch
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                : "text-muted-foreground"
            }
          >
            {hasMatch ? "match" : "miss"}
          </Badge>
        </div>
      </div>
    </section>
  )
}

function FixtureDiffSummary({
  expectedResults,
  result,
  onResultFilterChange,
}: {
  expectedResults: FixtureExpectedResults | null
  result: RuleTestRunResult
  onResultFilterChange: (filter: string) => void
}) {
  if (!expectedResults) {
    return null
  }

  const unexpectedRules = result.rules
    .map((rule) => {
      const expected = expectedResults.rules[rule.ruleName]
      if (!expected) {
        return null
      }
      const expectation = compareExpectedResult(rule.result, expected)
      return expectation.passed
        ? null
        : {
            diffCount: expectation.diffs.length,
            failureCount: expectation.failures.length,
            firstDiff: expectation.diffs[0]?.path ?? expectation.failures[0] ?? "result",
            ruleName: rule.ruleName,
          }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  if (unexpectedRules.length === 0) {
    return (
      <section className="border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <CheckCircleIcon className="size-4 shrink-0 text-emerald-600" />
            <p className="truncate text-xs font-medium text-emerald-700">
              Test case baseline matched all expected rule results.
            </p>
          </div>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-700">
            expected
          </Badge>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-2 border border-rose-500/30 bg-rose-500/5 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-rose-600" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-rose-700">
              Test case baseline drift
            </p>
            <p className="mt-0.5 text-xs text-foreground/60">
              {unexpectedRules.length} rule{unexpectedRules.length === 1 ? "" : "s"} differ from the saved expected results.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 text-xs"
          onClick={() => onResultFilterChange("unexpected")}
        >
          <SearchIcon />
          Show Drift
        </Button>
      </div>
      <div className="grid gap-1">
        {unexpectedRules.slice(0, 5).map((rule) => (
          <div
            key={rule.ruleName}
            className="grid gap-1 border bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-5 sm:grid-cols-[minmax(120px,0.4fr)_auto_minmax(0,1fr)]"
          >
            <span className="min-w-0 truncate text-rose-700" title={rule.ruleName}>{rule.ruleName}</span>
            <span className="text-muted-foreground">
              {rule.failureCount} failures / {rule.diffCount} diffs
            </span>
            <span className="min-w-0 truncate text-foreground/70" title={rule.firstDiff}>{rule.firstDiff}</span>
          </div>
        ))}
        {unexpectedRules.length > 5 ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            Showing 5 of {unexpectedRules.length} unexpected rules.
          </p>
        ) : null}
      </div>
    </section>
  )
}

function DetailedTestResults({
  expectedResults,
  filter,
  hiddenOutcomeNames,
  isRunning,
  outcomeNames,
  result,
  onFilterChange,
  onHideAllOutcomes,
  onOutcomeVisibilityChange,
  onShowAllOutcomes,
}: {
  expectedResults: FixtureExpectedResults | null
  filter: string
  hiddenOutcomeNames: Set<string>
  isRunning: boolean
  outcomeNames: string[]
  result: RuleTestRunResult | null
  onFilterChange: (filter: string) => void
  onHideAllOutcomes: () => void
  onOutcomeVisibilityChange: (name: string, visible: boolean) => void
  onShowAllOutcomes: () => void
}) {
  if (isRunning) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoadingIndicator markClassName="size-4" />
          Running test
        </div>
      </section>
    )
  }

  if (!result) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center p-4 text-center">
        <div className="max-w-md">
          <div className="mx-auto mb-2 flex size-8 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
            <ListChecksIcon className="size-4" />
          </div>
          <p className="text-sm font-medium text-foreground">Detection Details</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Run a test to inspect outcomes, baselines, matched event groups, placeholders, and raw event fields.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Detection Details</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Drill into rule outcomes, expected-result drift, matched groups, and event fields.
          </p>
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-1.5">
          <Input
            value={filter}
            onChange={(event) => onFilterChange(event.currentTarget.value)}
            placeholder="Filter results"
            className="h-7 w-36 text-xs sm:w-48"
          />
          <OutcomeCombobox
            hiddenOutcomeNames={hiddenOutcomeNames}
            outcomeNames={outcomeNames}
            onHideAll={onHideAllOutcomes}
            onShowAll={onShowAllOutcomes}
            onVisibilityChange={onOutcomeVisibilityChange}
          />
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-3 p-3 sm:p-4">
          <FixtureDiffSummary
            expectedResults={expectedResults}
            result={result}
            onResultFilterChange={onFilterChange}
          />
          <RuleResultsSection
            expectedResults={expectedResults}
            filter={filter}
            hiddenOutcomeNames={hiddenOutcomeNames}
            result={result}
          />
        </div>
      </ScrollArea>
    </section>
  )
}

function RuleResultsSection({
  expectedResults,
  filter,
  hiddenOutcomeNames,
  result,
}: {
  expectedResults: FixtureExpectedResults | null
  filter: string
  hiddenOutcomeNames: Set<string>
  result: RuleTestRunResult
}) {
  if (result.rules.length === 0) {
    return (
      <section className="bg-background/40 px-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">No compiled rules to run.</p>
      </section>
    )
  }
  const visibleRules = result.rules.filter((rule) =>
    matchesRuleResultFilter(rule, expectedResults?.rules[rule.ruleName] ?? null, filter)
  )

  if (visibleRules.length === 0) {
    return (
      <section className="bg-background/40 px-3 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          No rule results match the current filter.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      {visibleRules.map((rule, index) => (
        <RuleResultCard
          key={`${rule.ruleName}:${index}`}
          expected={expectedResults?.rules[rule.ruleName] ?? null}
          hiddenOutcomeNames={hiddenOutcomeNames}
          rule={rule}
        />
      ))}
    </div>
  )
}

function matchesRuleResultFilter(
  rule: RuleTestRunResult["rules"][number],
  expected: RuleExpectedResult | null,
  filter: string
) {
  const query = filter.trim().toLowerCase()
  if (!query) {
    return true
  }

  const diagnostics = [...rule.diagnostics, ...rule.result.diagnostics]
  const expectation = expected ? compareExpectedResult(rule.result, expected) : null
  const haystack = [
    rule.ruleName,
    rule.result.matched ? "matched match" : "miss no match",
    diagnostics.length > 0 ? "issues diagnostics errors warnings" : "clean no issues",
    expectation ? (expectation.passed ? "expected baseline" : "unexpected baseline") : "no baseline",
    expected?.matches ? "per-match match baseline" : "",
    ...Object.keys(rule.result.outcomes),
  ].join(" ").toLowerCase()

  return query.split(/\s+/).every((term) => haystack.includes(term))
}

function collectOutcomeNames(result: RuleTestRunResult | null) {
  const names = new Set<string>()
  for (const rule of result?.rules ?? []) {
    for (const name of Object.keys(rule.result.outcomes)) {
      names.add(name)
    }
    for (const match of rule.result.matches) {
      for (const name of Object.keys(match.outcomes)) {
        names.add(name)
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right))
}

function filterOutcomeRecord(
  outcomes: Record<string, unknown>,
  hiddenOutcomeNames: Set<string>
) {
  if (hiddenOutcomeNames.size === 0) {
    return outcomes
  }
  return Object.fromEntries(
    Object.entries(outcomes).filter(([name]) => !hiddenOutcomeNames.has(name))
  )
}

function RuleResultCard({
  expected,
  hiddenOutcomeNames,
  rule,
}: {
  expected: RuleExpectedResult | null
  hiddenOutcomeNames: Set<string>
  rule: RuleTestRunResult["rules"][number]
}) {
  const diagnostics = [...rule.diagnostics, ...rule.result.diagnostics]
  const matchedEventCount = getTotalMatchedEventCount(rule.result)
  const matchCount = rule.result.matches.length
  const expectation = expected ? compareExpectedResult(rule.result, expected) : null
  const visibleOutcomes = filterOutcomeRecord(rule.result.outcomes, hiddenOutcomeNames)

  return (
    <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
      <div className="flex min-h-14 flex-wrap items-start justify-between gap-3 border-b bg-muted/20 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {rule.result.matched ? (
            <CheckCircleIcon className="size-5 shrink-0 text-emerald-600" />
          ) : (
            <CircleXIcon className="size-5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-semibold text-foreground">
              {rule.ruleName}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {matchedEventCount} matched event{matchedEventCount === 1 ? "" : "s"}
              {matchCount > 1 ? ` across ${matchCount} matches` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {expectation ? (
            <Badge
              variant="outline"
              className={
                expectation.passed
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                  : "border-rose-500/40 bg-rose-500/10 text-rose-700"
              }
            >
              {expectation.passed ? "expected" : "unexpected"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              no baseline
            </Badge>
          )}
          <Badge variant={diagnostics.length > 0 ? "destructive" : "outline"}>
            {diagnostics.length} issues
          </Badge>
          <Badge
            variant="outline"
            className={
              rule.result.matched
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
                : "text-muted-foreground"
            }
          >
            {rule.result.matched ? "match" : "miss"}
          </Badge>
        </div>
      </div>

      {diagnostics.length > 0 ? (
        <div className="space-y-1 border-b px-3 py-2">
          {diagnostics.slice(0, 4).map((diagnostic, index) => (
            <div
              key={`${diagnostic.message}:${index}`}
              className="flex gap-2 font-mono text-[11px] leading-5 text-destructive"
            >
              <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
              <span>{diagnostic.message}</span>
            </div>
          ))}
          {diagnostics.length > 4 ? (
            <p className="font-mono text-[11px] text-muted-foreground">
              Showing 4 of {diagnostics.length} issues.
            </p>
          ) : null}
        </div>
      ) : null}

      {expectation && !expectation.passed ? (
        <div className="space-y-2 border-b px-3 py-2">
          {expectation.failures.map((failure) => (
            <div
              key={failure}
              className="flex gap-2 font-mono text-[11px] leading-5 text-rose-600"
            >
              <AlertTriangleIcon className="mt-0.5 size-3 shrink-0" />
              <span>{failure}</span>
            </div>
          ))}
          {expectation.diffs.length > 0 ? (
            <div className="space-y-1">
              {expectation.diffs.slice(0, 8).map((diff) => (
                <div
                  key={diff.path}
                  className="grid gap-1 border bg-rose-500/5 px-2 py-1.5 font-mono text-[11px] leading-5 sm:grid-cols-[minmax(120px,0.3fr)_minmax(0,1fr)_minmax(0,1fr)]"
                >
                  <span className="min-w-0 truncate text-rose-700" title={diff.path}>{diff.path}</span>
                  <span className="min-w-0 break-words text-muted-foreground">
                    expected {formatInlineValue(diff.expected)}
                  </span>
                  <span className="min-w-0 break-words text-foreground/75">
                    got {formatInlineValue(diff.actual)}
                  </span>
                </div>
              ))}
              {expectation.diffs.length > 8 ? (
                <p className="font-mono text-[11px] text-muted-foreground">
                  Showing 8 of {expectation.diffs.length} differences.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 p-4">
        <KeyValueSection
          maxEntries={MAX_RENDERED_OUTCOMES}
          title="Outcomes"
          emptyText={
            Object.keys(rule.result.outcomes).length > 0
              ? "All outcomes hidden by filter"
              : "No outcomes"
          }
          value={visibleOutcomes}
        />
        <MatchedEventsSection hiddenOutcomeNames={hiddenOutcomeNames} result={rule.result} />
      </div>
    </section>
  )
}

function getMatchedEventCount(matchedEvents: Record<string, unknown[]>) {
  return Object.values(matchedEvents).reduce((count, events) => count + events.length, 0)
}

function getTotalMatchedEventCount(result: YaralEvaluationResult) {
  if (result.matches.length === 0) {
    return getMatchedEventCount(result.matchedEvents)
  }
  return result.matches.reduce(
    (count, match) => count + getMatchedEventCount(match.matchedEvents),
    0
  )
}

function KeyValueSection({
  emptyText,
  maxEntries,
  title,
  value,
}: {
  emptyText: string
  maxEntries?: number
  title: string
  value: Record<string, unknown>
}) {
  const entries = Object.entries(value)
  const visibleEntries = maxEntries ? entries.slice(0, maxEntries) : entries
  const hiddenEntryCount = Math.max(0, entries.length - visibleEntries.length)

  return (
    <section className="overflow-hidden rounded-lg border bg-background/70">
      <div className="flex h-10 items-center justify-between border-b bg-muted/20 px-3">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <Badge variant="outline" className="font-mono text-[11px]">{entries.length}</Badge>
      </div>
      {entries.length > 0 ? (
        <>
          <div className="max-h-96 divide-y overflow-y-auto overscroll-contain">
            {visibleEntries.map(([name, item]) => (
              <div
                key={name}
                className="grid gap-2 px-3 py-3 xl:grid-cols-[minmax(108px,0.35fr)_minmax(0,1fr)] xl:gap-3"
              >
                <span className="min-w-0 truncate font-mono text-xs font-medium text-muted-foreground" title={`$${name}`}>
                  ${name}
                </span>
                <FormattedValue value={item} />
              </div>
            ))}
          </div>
          {hiddenEntryCount > 0 ? (
            <p className="border-t px-3 py-2 font-mono text-[11px] text-muted-foreground">
              Showing {visibleEntries.length} of {entries.length} {title.toLowerCase()}.
            </p>
          ) : null}
        </>
      ) : (
        <p className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {emptyText}
        </p>
      )}
    </section>
  )
}

function MatchedEventsSection({
  hiddenOutcomeNames,
  result,
}: {
  hiddenOutcomeNames: Set<string>
  result: YaralEvaluationResult
}) {
  if (result.matches.length > 1) {
    return <MultipleMatchesSection hiddenOutcomeNames={hiddenOutcomeNames} matches={result.matches} />
  }

  const entries = Object.entries(result.matchedEvents)

  return (
    <section className="overflow-hidden rounded-lg border bg-background/70">
      <div className="flex h-10 items-center justify-between border-b bg-muted/20 px-3">
        <p className="text-sm font-medium text-foreground">Matched Events</p>
        <Badge variant="outline" className="font-mono text-[11px]">{entries.length}</Badge>
      </div>
      {entries.length > 0 ? (
        <div className="divide-y">
          {entries.map(([name, events]) => (
            <MatchedEventGroup key={name} name={name} events={events} />
          ))}
        </div>
      ) : (
        <p className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
          No matched events
        </p>
      )}
    </section>
  )
}

function MultipleMatchesSection({
  hiddenOutcomeNames,
  matches,
}: {
  hiddenOutcomeNames: Set<string>
  matches: YaralEvaluationMatch[]
}) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(matches.length / MAX_RENDERED_MATCHES))
  const safePage = Math.min(page, pageCount - 1)
  const pageStart = safePage * MAX_RENDERED_MATCHES
  const visibleMatches = matches.slice(pageStart, pageStart + MAX_RENDERED_MATCHES)
  const isPaginated = matches.length > MAX_RENDERED_MATCHES

  return (
    <section className="overflow-hidden rounded-lg border bg-background/70">
      <div className="flex min-h-9 items-center justify-between gap-3 border-b px-3 py-1.5">
        <p className="text-sm font-medium text-foreground">Matches</p>
        <div className="flex items-center gap-1.5">
          {isPaginated ? (
            <Badge variant="outline" className="font-mono text-[10px]">
              {pageStart + 1}-{pageStart + visibleMatches.length}
            </Badge>
          ) : null}
          <Badge variant="outline">{matches.length}</Badge>
        </div>
      </div>
      <div className="divide-y">
        {visibleMatches.map((match, index) => (
          <MatchedResultGroup
            key={index}
            hiddenOutcomeNames={hiddenOutcomeNames}
            index={pageStart + index}
            match={match}
          />
        ))}
        {isPaginated ? (
          <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-2">
            <p className="min-w-0 break-words font-mono text-[11px] text-muted-foreground">
              Page {safePage + 1} of {pageCount}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={safePage === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function MatchedResultGroup({
  hiddenOutcomeNames,
  index,
  match,
}: {
  hiddenOutcomeNames: Set<string>
  index: number
  match: YaralEvaluationMatch
}) {
  const [isOpen, setIsOpen] = useState(index === 0)
  const eventCount = getMatchedEventCount(match.matchedEvents)
  const eventVariableCount = Object.keys(match.matchedEvents).length
  const visibleOutcomes = filterOutcomeRecord(match.outcomes, hiddenOutcomeNames)
  const outcomeCount = Object.keys(visibleOutcomes).length
  const totalOutcomeCount = Object.keys(match.outcomes).length
  const placeholderCount = Object.keys(match.placeholders).length

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="grid h-auto w-full grid-cols-[minmax(104px,0.28fr)_minmax(0,1fr)_auto] items-start justify-normal gap-3 px-3 py-2 text-left hover:bg-muted/40"
        >
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            {isOpen ? (
              <ChevronDownIcon className="size-3 shrink-0" />
            ) : (
              <ChevronRightIcon className="size-3 shrink-0" />
            )}
            <span className="break-words">match {index + 1}</span>
          </span>
          <span className="min-w-0 break-words font-mono text-[11px] leading-5 text-foreground/75">
            {eventCount} event{eventCount === 1 ? "" : "s"}, {eventVariableCount} variable
            {eventVariableCount === 1 ? "" : "s"}
          </span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {outcomeCount + placeholderCount}
          </Badge>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-3 border-t bg-muted/10 p-3">
          <div className="space-y-3">
            <KeyValueSection
              title="Placeholders"
              emptyText="No placeholders"
              value={match.placeholders}
            />
            <KeyValueSection
              maxEntries={MAX_RENDERED_OUTCOMES}
              title="Outcomes"
              emptyText={
                totalOutcomeCount > 0
                  ? "All outcomes hidden by filter"
                  : "No outcomes"
              }
              value={visibleOutcomes}
            />
          </div>
          <section className="overflow-hidden rounded-lg border bg-background/70">
            <div className="flex h-10 items-center justify-between border-b bg-muted/20 px-3">
              <p className="text-sm font-medium text-foreground">Matched Events</p>
              <Badge variant="outline">{eventVariableCount}</Badge>
            </div>
            <div className="divide-y">
              {Object.entries(match.matchedEvents).map(([name, events]) => (
                <MatchedEventGroup key={name} name={name} events={events as unknown[]} />
              ))}
            </div>
          </section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function MatchedEventGroup({
  events,
  name,
}: {
  events: unknown[]
  name: string
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="grid h-auto w-full grid-cols-[minmax(96px,0.35fr)_minmax(0,1fr)_auto] items-start justify-normal gap-3 px-3 py-2 text-left hover:bg-muted/40"
        >
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            {isOpen ? <ChevronDownIcon className="size-3 shrink-0" /> : <ChevronRightIcon className="size-3 shrink-0" />}
            <span className="break-all">${name}</span>
          </span>
          <span className="font-mono text-[11px] leading-5 text-foreground/75">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
          <ListChecksIcon className="size-3.5 text-muted-foreground" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 border-t bg-muted/10 p-2">
          {events.map((event, index) => {
            const summary = summarizeFixtureEvent(event, index)
            const source = getEventLogSource(event)
            return (
              <MatchedEventDetail
                key={index}
                event={event}
                index={index}
                source={source}
                summary={summary}
              />
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function MatchedEventDetail({
  event,
  index,
  source,
  summary,
}: {
  event: unknown
  index: number
  source: string
  summary: ReturnType<typeof summarizeFixtureEvent>
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="overflow-hidden rounded-md border bg-background/70">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="grid h-auto w-full grid-cols-[auto_minmax(0,1fr)] items-start justify-normal gap-3 px-2 py-1.5 text-left hover:bg-muted/40 xl:grid-cols-[auto_minmax(0,1fr)_auto]"
        >
          {isOpen ? (
            <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0">
            <span className="block break-words font-mono text-[11px] font-semibold leading-5 text-foreground/80">
              {summary.eventType}
            </span>
            <span className="mt-0.5 block break-words font-mono text-[10px] leading-4 text-muted-foreground">
              {summary.timestamp}
              {summary.host ? `  ${summary.host}` : ""}
              {summary.user ? `  ${summary.user}` : ""}
              {summary.process ? `  ${summary.process}` : ""}
            </span>
          </span>
          <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 pl-6 xl:col-span-1 xl:pl-0">
            {summary.injectionLabel ? (
              <Badge
                variant="outline"
                className="border-amber-500/40 font-mono text-[10px] text-amber-700"
              >
                inject
              </Badge>
            ) : null}
            <Badge variant="outline" className="max-w-full font-mono text-[10px] xl:max-w-40">
              <span className="min-w-0 truncate">{source}</span>
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              #{index + 1}
            </Badge>
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t bg-muted/10 p-2">
          <EventFieldInspector event={event} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function EventFieldInspector({
  editableJson = false,
  event,
  onJsonChange,
}: {
  editableJson?: boolean
  event: unknown
  onJsonChange?: (event: unknown) => void
}) {
  const fields = useMemo(() => flattenEventFields(event), [event])
  const eventJson = useMemo(() => JSON.stringify(event, null, 2), [event])
  const [jsonDraft, setJsonDraft] = useState(eventJson)
  const [jsonDraftError, setJsonDraftError] = useState<string | null>(null)

  useEffect(() => {
    setJsonDraft(eventJson)
    setJsonDraftError(null)
  }, [eventJson])

  function commitJsonDraft() {
    if (!editableJson || jsonDraft === eventJson) {
      return
    }
    try {
      const parsed = JSON.parse(jsonDraft) as unknown
      setJsonDraftError(null)
      onJsonChange?.(parsed)
    } catch (error) {
      setJsonDraftError(error instanceof Error ? error.message : "Event JSON is invalid.")
    }
  }

  function handleFieldValueChange(path: string, currentValue: unknown, nextValue: string) {
    const allowedValues = getEventFieldAllowedValues(path)
    if (allowedValues.length > 0 && !allowedValues.includes(nextValue)) {
      return
    }
    let coercedValue: unknown = nextValue
    if (typeof currentValue === "number") {
      const numericValue = Number(nextValue)
      coercedValue = Number.isFinite(numericValue) ? numericValue : nextValue
    } else if (typeof currentValue === "boolean") {
      coercedValue = nextValue === "true"
    } else if (currentValue === null && nextValue === "null") {
      coercedValue = null
    }
    onJsonChange?.(setEventFieldValue(event, path, coercedValue))
  }

  return (
    <Tabs defaultValue="fields" className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <TabsList className="h-7" variant="line">
          <TabsTrigger value="fields" className="h-7 text-xs">
            Fields
          </TabsTrigger>
          <TabsTrigger value="json" className="h-7 text-xs">
            Raw JSON
          </TabsTrigger>
        </TabsList>
        <Badge variant="outline" className="font-mono text-[10px]">
          {fields.length}
        </Badge>
      </div>
      <TabsContent value="fields" className="mt-0">
        {fields.length > 0 ? (
          <ScrollArea className="max-h-64 bg-background/40">
            <div className="divide-y">
              {fields.slice(0, 120).map((field) => (
                <div
                  key={field.path}
                  className="grid gap-2 px-2 py-1.5 md:grid-cols-[minmax(140px,0.45fr)_minmax(0,1fr)]"
                >
                  <span className="min-w-0 break-all font-mono text-[11px] leading-5 text-muted-foreground">
                    {field.path}
                  </span>
                  {editableJson && onJsonChange && field.editable ? (
                    field.allowedValues.length > 0 ? (
                      <Select
                        value={
                          typeof field.rawValue === "string" && field.allowedValues.includes(field.rawValue)
                            ? field.rawValue
                            : undefined
                        }
                        onValueChange={(value) => handleFieldValueChange(field.path, field.rawValue, value)}
                      >
                        <SelectTrigger
                          aria-label={`Edit ${field.path}`}
                          size="sm"
                          className="h-8 min-w-0 bg-background/70 font-mono text-[11px]"
                        >
                          <SelectValue placeholder="Choose value" />
                        </SelectTrigger>
                        <SelectContent align="start" className="max-h-72 max-w-[min(24rem,calc(100vw-2rem))]">
                          {field.allowedValues.map((allowedValue) => (
                            <SelectItem key={allowedValue} value={allowedValue}>
                              <span className="block min-w-0 truncate font-mono text-xs">{allowedValue}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : field.valueKind === "boolean" ? (
                      <Select
                        value={field.rawValue === true ? "true" : "false"}
                        onValueChange={(value) => handleFieldValueChange(field.path, field.rawValue, value)}
                      >
                        <SelectTrigger
                          aria-label={`Edit ${field.path}`}
                          size="sm"
                          className="h-8 min-w-0 bg-background/70 font-mono text-[11px]"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start">
                          <SelectItem value="true">true</SelectItem>
                          <SelectItem value="false">false</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        aria-label={`Edit ${field.path}`}
                        type={field.valueKind === "number" ? "number" : "text"}
                        value={String(field.rawValue ?? "")}
                        onChange={(changeEvent) =>
                          handleFieldValueChange(field.path, field.rawValue, changeEvent.currentTarget.value)
                        }
                        className="h-8 min-w-0 bg-background/70 font-mono text-[11px]"
                      />
                    )
                  ) : (
                    <span className="min-w-0 break-words font-mono text-[11px] text-foreground/80">
                      {field.value}
                    </span>
                  )}
                </div>
              ))}
            </div>
            {fields.length > 120 ? (
              <p className="border-t px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                Showing 120 of {fields.length} fields.
              </p>
            ) : null}
          </ScrollArea>
        ) : (
          <p className="bg-background/40 px-2 py-2 font-mono text-[11px] text-muted-foreground">
            No scalar fields found.
          </p>
        )}
      </TabsContent>
      <TabsContent value="json" className="mt-0">
        {editableJson ? (
          <div className="overflow-hidden bg-background/40">
            {jsonDraftError ? (
              <div className="border-b bg-destructive/10 px-3 py-2 font-mono text-[11px] text-destructive">
                {jsonDraftError}
              </div>
            ) : null}
            <Textarea
              aria-label="Event raw JSON"
              value={jsonDraft}
              onChange={(changeEvent) => {
                setJsonDraft(changeEvent.currentTarget.value)
                setJsonDraftError(null)
              }}
              onBlur={commitJsonDraft}
              spellCheck={false}
              className="shadcn-scrollbar h-64 resize-none rounded-none border-0 bg-transparent p-3 font-mono text-[11px] leading-5 text-foreground/80 shadow-none focus-visible:ring-0"
              aria-invalid={Boolean(jsonDraftError)}
            />
          </div>
        ) : (
          <ScrollArea className="max-h-64 bg-background/40">
            <pre className="whitespace-pre-wrap p-2 font-mono text-[11px] leading-5 text-foreground/75">
              {eventJson}
            </pre>
          </ScrollArea>
        )}
      </TabsContent>
    </Tabs>
  )
}

function flattenEventFields(value: unknown) {
  const fields: Array<{
    allowedValues: readonly string[]
    editable: boolean
    path: string
    rawValue: unknown
    value: string
    valueKind: "boolean" | "number" | "other" | "string"
  }> = []

  function visit(current: unknown, path: string) {
    if (current === null || current === undefined || typeof current !== "object") {
      let valueKind: "boolean" | "number" | "other" | "string" = "other"
      if (typeof current === "boolean") {
        valueKind = "boolean"
      } else if (typeof current === "number") {
        valueKind = "number"
      } else if (typeof current === "string") {
        valueKind = "string"
      }
      fields.push({
        allowedValues: getEventFieldAllowedValues(path),
        editable: path.length > 0 && ["boolean", "number", "string"].includes(typeof current),
        path: path || "$event",
        rawValue: current,
        value: formatInlineValue(current),
        valueKind,
      })
      return
    }
    if (Array.isArray(current)) {
      if (current.length === 0) {
        fields.push({ allowedValues: [], editable: false, path, rawValue: current, value: "[]", valueKind: "other" })
        return
      }
      current.forEach((item, index) => visit(item, `${path}[${index}]`))
      return
    }
    const entries = Object.entries(current as Record<string, unknown>)
    if (entries.length === 0) {
      fields.push({ allowedValues: [], editable: false, path, rawValue: current, value: "{}", valueKind: "other" })
      return
    }
    for (const [key, item] of entries) {
      visit(item, path ? `${path}.${key}` : key)
    }
  }

  visit(value, "")
  return fields
}

function FormattedValue({ value }: { value: unknown }) {
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return (
      <ScrollArea className="max-h-24">
        <pre className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-foreground/75">
          {JSON.stringify(value, null, 2)}
        </pre>
      </ScrollArea>
    )
  }

  return (
    <span className="min-w-0 break-words font-mono text-[11px] text-foreground/75">
      {value === null || value === undefined ? "null" : String(value)}
    </span>
  )
}
