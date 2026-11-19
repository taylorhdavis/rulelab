import type { OnMount } from "@monaco-editor/react"
import { BookOpenIcon, BugIcon, CommandIcon, DownloadIcon, ExternalLinkIcon, FilePlusIcon, HelpCircleIcon, ImportIcon, ListChecksIcon, MoreHorizontalIcon, SaveIcon, Settings2Icon, ShieldCheckIcon, } from "lucide-react"
import type { editor } from "monaco-editor"
import { Dialog as DialogPrimitive } from "radix-ui"
import type { ChangeEvent, ReactNode } from "react"
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router"
import { toast } from "sonner"
import { useAuth } from "wasp/client/auth"
import { getDataTables, getEditorTutorialStatus, getSavedRules, markEditorTutorialSeen, saveRule, useQuery, } from "wasp/client/operations"
import { AppShell } from "../../components/AppShell"
import { AuthGate } from "../../components/AuthGate"
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Checkbox } from "../../components/ui/checkbox"
import { CodeBlock } from "../../components/ui/code-block"
import { ConfirmDialog } from "../../components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "../../components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, } from "../../components/ui/dropdown-menu"
import { Input } from "../../components/ui/input"
import { LoadingIndicator } from "../../components/ui/loading-indicator"
import { ScrollArea } from "../../components/ui/scroll-area"
import { Separator } from "../../components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs"
import { Textarea } from "../../components/ui/textarea"
import type { YaralEvaluationDataTable, YaralValidationResult, } from "../../domain/yaral"
import { getYaralRuleMetadata, validateYaralRule } from "../../domain/yaral"
import { formatYaralRule } from "../../domain/yaral/formatter"
import type { RuleTestRunResult } from "../../domain/yaral/testing/run-rule-test"
import { useIsMobile } from "../../hooks/use-mobile"
import { getPublicErrorMessage } from "../../lib/public-errors"
import type { EditorCommand } from "./components/CommandPalette"
import type { DataTableSummary } from "./components/DataTablesPanel"
import { EditorTabBar } from "./components/EditorTabBar"
import type { SavedRuleSummary, } from "./components/RuleLibraryPanel"
import { StatusBar } from "./components/StatusBar"
import { createDefaultRule, FONT_SIZE_MAX, FONT_SIZE_MIN, INSPECTOR_DEFAULT_WIDTH, LEGACY_DEFAULT_RULES, OUTPUT_PANEL_DEFAULT_HEIGHT, SAVED_STARTER_RULE, } from "./constants"
import { getEditorKeybindingAction } from "./editor-keybindings"
import type { YaralDataTableCompletionItem } from "./monaco/yaral-language"
import { configureYaralLanguage, getYaralCompilerReferenceRanges, setYaralDataTableCompletions, } from "./monaco/yaral-language"
import { cancelRunningYaralRuleTest, runYaralRuleTestInBrowser, } from "./run-rule-test-client"
const Editor = lazy(() => import("@monaco-editor/react"))
const RuleLibraryPanel = lazy(() => import("./components/RuleLibraryPanel").then((module) => ({ default: module.RuleLibraryPanel })))
const OutputPanel = lazy(() => import("./components/OutputPanel").then((module) => ({ default: module.OutputPanel })))
const DataTablesPanel = lazy(() => import("./components/DataTablesPanel").then((module) => ({ default: module.DataTablesPanel })))
const MAX_TEST_RUN_HISTORY = 15
const MAX_OPEN_RULE_TABS = 10
const RuleInspector = lazy(() => import("./components/RuleInspector").then((module) => ({ default: module.RuleInspector })))
const CommandPalette = lazy(() => import("./components/CommandPalette").then((module) => ({ default: module.CommandPalette })))
const UNTITLED_RULE_NAME = "untitled_rule"
const INITIAL_TAB_ID = "rule-tab-1"
const LEGACY_EDITOR_SESSION_STORAGE_KEYS = [
  "yara-l-studio:editor-session:v1",
  "yara-l-studio:editor-session:v2",
  "detection-studio:editor-session:v2"
]
const EDITOR_SESSION_STORAGE_KEY_PREFIX = "rulelab:editor-session:v1"
const WORKSPACE_SETTINGS_STORAGE_KEY_PREFIX = "rulelab:workspace-settings:v1"
const EDITOR_SESSION_SAVE_DEBOUNCE_MS = 500
const EDITOR_VALIDATION_DEBOUNCE_MS = 250
const RULE_FOLDER_MAX_LENGTH = 64
const RULE_TAGS_INPUT_MAX_LENGTH = 2000
const DATA_TABLE_QUERY_OPTIONS = {
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  retry: 1,
  staleTime: 30000,
} as const
const OPEN_RULE_TAB_LIMIT_MESSAGE = `You can have up to ${MAX_OPEN_RULE_TABS} rule tabs open. Close a tab before opening another.`
const GOOGLE_SECOPS_DOC_LINKS = [
  {
    description: "Official starting point for rule structure, single-event rules, multi-event rules, and validation.",
    href: "https://docs.cloud.google.com/chronicle/docs/yara-l/getting-started",
    label: "YARA-L getting started",
  },
  {
    description: "How event variables, event field predicates, placeholder variables, and joins are declared.",
    href: "https://docs.cloud.google.com/chronicle/docs/yara-l/events-syntax",
    label: "Events syntax",
  },
  {
    description: "How multi-event correlation groups related events by placeholder variables over time.",
    href: "https://docs.cloud.google.com/chronicle/docs/yara-l/match-syntax",
    label: "Match syntax",
  },
  {
    description: "How event variables, counts, placeholder conditions, outcomes, and bounded conditions trigger alerts.",
    href: "https://docs.cloud.google.com/chronicle/docs/yara-l/condition-syntax",
    label: "Condition syntax",
  },
  {
    description: "Example rules and query patterns to compare against while shaping detections.",
    href: "https://docs.cloud.google.com/chronicle/docs/yara-l/yara-l-2-0-examples",
    label: "Examples",
  },
  {
    description: "Canonical field names and prefixes for UDM event and entity data.",
    href: "https://docs.cloud.google.com/chronicle/docs/reference/udm-field-list",
    label: "UDM field list",
  },
  {
    description: "How Google SecOps validates rules against historical data.",
    href: "https://docs.cloud.google.com/chronicle/docs/detection/run-rule-historical-data",
    label: "Run against historical data",
  }
] as const
function getRuleName(ruleText: string) {
  return getYaralRuleMetadata(ruleText).name ?? UNTITLED_RULE_NAME
}
function suppressMonacoFindWidgetTitles(editor: Parameters<OnMount>[0]) {
  const editorNode = editor.getDomNode?.() ?? null
  if (!editorNode) {
    return () => { }
  }
  const clearFindWidgetTitles = () => {
    editorNode
      .querySelectorAll<HTMLElement>(".find-widget [title]")
      .forEach((element) => element.removeAttribute("title"))
  }
  clearFindWidgetTitles()
  const observer = new MutationObserver(clearFindWidgetTitles)
  observer.observe(editorNode, {
    attributes: true,
    attributeFilter: ["title"],
    childList: true,
    subtree: true,
  })
  return () => observer.disconnect()
}
type RuleEditorTab = {
  id: string
  isDirty: boolean
  lastSavedSource: string | null
  name: string
  savedRuleId: string | null
  sourceRef: RuleEditorTabSourceRef
  source: string
}
type RuleEditorTabSourceRef = {
  type: "local"
  savedRuleId: string | null
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
type StudioNavigationState = {
  studioPanel?: "dataTables" | "fixtureEditor" | "library" | "settings"
}
type WorkspaceValidationSettings = {
  experimentalDiagnostics: boolean
  referenceHighlights: boolean
  treatWarningsAsErrors: boolean
}
type FirstSaveMetadata = {
  folder: string
  name: string
  source: string
  tags: string
}
type PendingRuleOverwrite = {
  existingRule: SavedRuleSummary
  metadata: FirstSaveMetadata
}
type EditorValidationOptions = {
  dataTables?: YaralEvaluationDataTable[]
  experimentalDiagnostics: boolean
  treatWarningsAsErrors: boolean
}
function validateEditorRule(source: string, options: EditorValidationOptions) {
  return validateYaralRule(source, {
    dataTables: options.dataTables,
    experimentalDiagnostics: options.experimentalDiagnostics,
    namedDiagnosticProfile: "editor-default",
    treatWarningsAsErrors: options.treatWarningsAsErrors,
  })
}
function createTabId() {
  return `rule-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
function createRuleTab(source?: string, options: Partial<RuleEditorTab> = {}): RuleEditorTab {
  const tabSource = source ?? createDefaultRule()
  const savedRuleId = options.savedRuleId ?? null
  return {
    id: options.id ?? createTabId(),
    isDirty: options.isDirty ?? false,
    lastSavedSource: options.lastSavedSource ?? null,
    name: options.name ?? getRuleName(tabSource),
    savedRuleId,
    sourceRef: options.sourceRef ?? { type: "local", savedRuleId },
    source: tabSource,
  }
}
function createDefaultEditorSession() {
  const defaultRule = SAVED_STARTER_RULE
  const tabs = [
    createRuleTab(defaultRule, {
      id: INITIAL_TAB_ID,
      lastSavedSource: defaultRule,
    })
  ]
  return { activeTabId: INITIAL_TAB_ID, tabs }
}
function getTabStatusContext(_tab: RuleEditorTab) { return { label: "Local", segments: [{ label: "Local", title: "Local rule library" }], sourceType: "local" as const, title: "Local rule library" } }
function getSaveActionLabel(tab: RuleEditorTab | null) {
  return "Save"
}
function getSaveActionTitle(tab: RuleEditorTab | null) {
  if (!tab) {
    return "Save rule"
  }
  return "Save to local library"
}
function getEditorSessionStorageKey(userId: string) {
  return `${EDITOR_SESSION_STORAGE_KEY_PREFIX}:${userId}`
}
function getWorkspaceSettingsStorageKey(userId: string) {
  return `${WORKSPACE_SETTINGS_STORAGE_KEY_PREFIX}:${userId}`
}
function loadWorkspaceSettings(storageKey: string): WorkspaceValidationSettings {
  if (typeof window === "undefined") {
    return createDefaultWorkspaceSettings()
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as Partial<WorkspaceValidationSettings> | null
    return {
      experimentalDiagnostics: typeof parsed?.experimentalDiagnostics === "boolean"
        ? parsed.experimentalDiagnostics
        : false,
      referenceHighlights: typeof parsed?.referenceHighlights === "boolean"
        ? parsed.referenceHighlights
        : false,
      treatWarningsAsErrors: typeof parsed?.treatWarningsAsErrors === "boolean"
        ? parsed.treatWarningsAsErrors
        : true,
    }
  }
  catch {
    return createDefaultWorkspaceSettings()
  }
}
function saveWorkspaceSettings(storageKey: string, settings: WorkspaceValidationSettings) {
  if (typeof window === "undefined") {
    return
  }
  window.localStorage.setItem(storageKey, JSON.stringify(settings))
}
function createDefaultWorkspaceSettings(): WorkspaceValidationSettings {
  return {
    experimentalDiagnostics: false,
    referenceHighlights: false,
    treatWarningsAsErrors: true,
  }
}
function loadEditorSession(storageKey: string) {
  if (typeof window === "undefined") {
    return createDefaultEditorSession()
  }
  const storageKeys = [
    storageKey,
    ...LEGACY_EDITOR_SESSION_STORAGE_KEYS.map((legacyKey) => legacyKey.includes(":v2") ? `${legacyKey}:${getUserIdFromEditorSessionStorageKey(storageKey)}` : legacyKey)
  ]
  try {
    const parsed = storageKeys.reduce<{
      activeTabId?: unknown
      tabs?: unknown
    } | null>((restored, nextStorageKey) => {
      if (restored) {
        return restored
      }
      return JSON.parse(window.localStorage.getItem(nextStorageKey) ?? "null") as {
        activeTabId?: unknown
        tabs?: unknown
      } | null
    }, null)
    if (!parsed || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return createDefaultEditorSession()
    }
    const tabs = parsed.tabs
      .filter((tab): tab is Partial<RuleEditorTab> & {
        source: string
      } => Boolean(tab && typeof tab === "object" && typeof (tab as RuleEditorTab).source === "string"))
      .map((tab) => {
        const restoredSource = getRestoredTabSource(tab)
        return createRuleTab(restoredSource, {
          id: typeof tab.id === "string" ? tab.id : undefined,
          isDirty: Boolean(tab.isDirty) || hasObsoleteSourceRef(tab),
          lastSavedSource: getRestoredLastSavedSource(tab, restoredSource),
          name: isUntouchedInitialGeneratedDefaultTab(tab) ||
            isUntouchedLegacyDefaultTab(tab) ||
            typeof tab.name !== "string"
            ? getRuleName(restoredSource)
            : tab.name,
          savedRuleId: !hasObsoleteSourceRef(tab) && typeof tab.savedRuleId === "string" ? tab.savedRuleId : null,
          sourceRef: getRestoredSourceRef(tab),
        })
      })
      .slice(0, MAX_OPEN_RULE_TABS)
    if (tabs.length === 0) {
      return createDefaultEditorSession()
    }
    const activeTabId = typeof parsed.activeTabId === "string" && tabs.some((tab) => tab.id === parsed.activeTabId)
      ? parsed.activeTabId
      : tabs[0].id
    return { activeTabId, tabs }
  }
  catch {
    return createDefaultEditorSession()
  }
}
function getUserIdFromEditorSessionStorageKey(storageKey: string) {
  return storageKey.split(":").at(-1) ?? ""
}
function isUntouchedLegacyDefaultTab(tab: Partial<RuleEditorTab> & {
  source: string
}) {
  return (!tab.isDirty &&
    isLegacyDefaultRule(tab.source) &&
    (typeof tab.lastSavedSource !== "string" ||
      isLegacyDefaultRule(tab.lastSavedSource)) &&
    tab.savedRuleId == null)
}
function isLegacyDefaultRule(source: string) {
  return (LEGACY_DEFAULT_RULES as readonly string[]).includes(source)
}
function getRestoredTabSource(tab: Partial<RuleEditorTab> & {
  source: string
}) {
  if (isUntouchedInitialGeneratedDefaultTab(tab)) {
    return SAVED_STARTER_RULE
  }
  return isUntouchedLegacyDefaultTab(tab) ? createDefaultRule() : tab.source
}
function getRestoredLastSavedSource(tab: Partial<RuleEditorTab> & {
  source: string
}, restoredSource: string) {
  const previousSource = (tab as {
    sourceRef?: {
      type?: unknown
    }
  }).sourceRef
  if (previousSource && previousSource.type !== "local")
    return null
  if (isUntouchedInitialGeneratedDefaultTab(tab) || isUntouchedLegacyDefaultTab(tab)) {
    return restoredSource
  }
  return typeof tab.lastSavedSource === "string" ? tab.lastSavedSource : null
}
function isUntouchedInitialGeneratedDefaultTab(tab: Partial<RuleEditorTab> & {
  source: string
}) {
  return (tab.id === INITIAL_TAB_ID &&
    !tab.isDirty &&
    tab.savedRuleId == null &&
    (typeof tab.lastSavedSource !== "string" || tab.lastSavedSource === tab.source) &&
    (!tab.sourceRef ||
      (tab.sourceRef.savedRuleId === null)) &&
    isGeneratedDefaultRuleSource(tab.source))
}
function isGeneratedDefaultRuleSource(source: string) {
  const metadata = getYaralRuleMetadata(source)
  return (metadata.name?.startsWith("user_login_") === true &&
    source.includes('description = "Detects successful user login events."') &&
    source.includes('$e.metadata.event_type = "USER_LOGIN"') &&
    source.includes("$e.principal.user.userid = /.+/"))
}
function hasObsoleteSourceRef(tab: Partial<RuleEditorTab>) {
  const sourceRef = (tab as { sourceRef?: { type?: unknown } }).sourceRef
  return Boolean(sourceRef && sourceRef.type !== "local")
}
function getRestoredSourceRef(tab: Partial<RuleEditorTab>): RuleEditorTabSourceRef { return { type: "local", savedRuleId: !hasObsoleteSourceRef(tab) && typeof tab.savedRuleId === "string" ? tab.savedRuleId : null } }
function saveEditorSession(storageKey: string, tabs: RuleEditorTab[], activeTabId: string) {
  if (typeof window === "undefined") {
    return
  }
  window.localStorage.setItem(storageKey, JSON.stringify({
    activeTabId,
    tabs,
  }))
}
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs)
    })
  ])
}
function isMissingSavedRuleError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false
  }
  const maybeError = error as {
    message?: unknown
    statusCode?: unknown
  }
  return (maybeError.statusCode === 404 &&
    typeof maybeError.message === "string" &&
    maybeError.message.includes("Rule not found")) || (typeof maybeError.message === "string" &&
      maybeError.message.includes("Rule not found"))
}
export function RuleEditorPage() {
  return (<AuthGate>
    <RuleEditorContent />
  </AuthGate>)
}
function RuleEditorContent() {
  const { data: authUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const editorSessionStorageKey = useMemo(() => (authUser?.id ? getEditorSessionStorageKey(authUser.id) : null), [authUser?.id])
  const workspaceSettingsStorageKey = useMemo(() => (authUser?.id ? getWorkspaceSettingsStorageKey(authUser.id) : null), [authUser?.id])
  const { data: dbDataTables, error: dataTablesError, refetch: refetchDataTables, } = useQuery(getDataTables, undefined, DATA_TABLE_QUERY_OPTIONS)
  const { data: dbSavedRules, refetch: refetchSavedRules, } = useQuery(getSavedRules, undefined, {
    retry: 1,
    staleTime: 0,
  })
  const { data: editorTutorialStatus, refetch: refetchEditorTutorialStatus, } = useQuery(getEditorTutorialStatus, undefined, {
    retry: 1,
    staleTime: 60000,
  })
  const savedRules = (dbSavedRules ?? []) as SavedRuleSummary[]
  const hasLoadedSavedRules = dbSavedRules !== undefined
  const [optimisticDataTables, setOptimisticDataTables] = useState<DataTableSummary[]>([])
  const [deletedDataTableIds, setDeletedDataTableIds] = useState<string[]>([])
  const savedDataTables = useMemo(() => mergeDataTableSummaries(((dbDataTables ?? []) as DataTableSummary[]).filter((table) => !deletedDataTableIds.includes(table.id)), optimisticDataTables), [dbDataTables, deletedDataTableIds, optimisticDataTables])
  const hasLoadedDataTables = dbDataTables !== undefined
  const validationDataTables = useMemo(() => hasLoadedDataTables || optimisticDataTables.length > 0
    ? normalizeValidationDataTables(savedDataTables)
    : undefined, [hasLoadedDataTables, optimisticDataTables.length, savedDataTables])
  const dataTableCompletionItems = useMemo(() => normalizeDataTableCompletionItems(savedDataTables), [savedDataTables])
  const [sessionHydrationKey, setSessionHydrationKey] = useState<string | null>(null)
  const [workspaceSettingsHydrationKey, setWorkspaceSettingsHydrationKey] = useState<string | null>(null)
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const [fontSize, setFontSize] = useState(13)
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isDataTablesOpen, setIsDataTablesOpen] = useState(false)
  const [isFixtureEditorOpen, setIsFixtureEditorOpen] = useState(false)
  const [isEventExplorerOpen, setIsEventExplorerOpen] = useState(false)
  const [isImportExportOpen, setIsImportExportOpen] = useState(false)
  const [isTutorialOpen, setIsTutorialOpen] = useState(false)
  const [isValidatorOpen, setIsValidatorOpen] = useState(false)
  const [isWorkspaceSettingsOpen, setIsWorkspaceSettingsOpen] = useState(false)
  const [isOutputPanelOpen, setIsOutputPanelOpen] = useState(true)
  const [outputPanelHeight, setOutputPanelHeight] = useState(OUTPUT_PANEL_DEFAULT_HEIGHT)
  const [isInspectorOpen, setIsInspectorOpen] = useState(true)
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH)
  const [tabs, setTabs] = useState<RuleEditorTab[]>(() => createDefaultEditorSession().tabs)
  const [activeTabId, setActiveTabId] = useState(INITIAL_TAB_ID)
  const [testResult, setTestResult] = useState<RuleTestRunResult | null>(null)
  const [testRunHistory, setTestRunHistory] = useState<TestRunHistoryRecord[]>([])
  const [experimentalDiagnostics, setExperimentalDiagnostics] = useState(createDefaultWorkspaceSettings().experimentalDiagnostics)
  const [referenceHighlights, setReferenceHighlights] = useState(createDefaultWorkspaceSettings().referenceHighlights)
  const [treatWarningsAsErrors, setTreatWarningsAsErrors] = useState(createDefaultWorkspaceSettings().treatWarningsAsErrors)
  const [libraryRefreshToken, setLibraryRefreshToken] = useState(0)
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null)
  const [] = useState(false)
  const [firstSaveMetadata, setFirstSaveMetadata] = useState<FirstSaveMetadata | null>(null)
  const [isFirstSaveSaving, setIsFirstSaveSaving] = useState(false)
  const [pendingRuleOverwrite, setPendingRuleOverwrite] = useState<PendingRuleOverwrite | null>(null)
  const [isTestRunning, setIsTestRunning] = useState(false)
  const activeTabIdRef = useRef(activeTabId)
  const experimentalDiagnosticsRef = useRef(experimentalDiagnostics)
  const referenceHighlightsRef = useRef(referenceHighlights)
  const treatWarningsAsErrorsRef = useRef(treatWarningsAsErrors)
  const validationTimeoutRef = useRef<number | null>(null)
  const sessionSaveTimeoutRef = useRef<number | null>(null)
  const pendingTestTimeoutRef = useRef<number | null>(null)
  const testRunIdRef = useRef(0)
  const isApplyingTabRef = useRef(false)
  const hasAutoOpenedTutorialRef = useRef(false)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const hasOpenTabs = Boolean(activeTab)
  const ruleText = activeTab?.source ?? ""
  const [validation, setValidation] = useState<YaralValidationResult>(() => activeTab
    ? validateEditorRule(activeTab.source, {
      dataTables: validationDataTables,
      experimentalDiagnostics,
      treatWarningsAsErrors,
    })
    : createEmptyValidation())
  const [inspectorRuleText, setInspectorRuleText] = useState(activeTab?.source ?? "")
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const referenceDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null)
  const findWidgetTitleCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (isMobile) {
      setIsInspectorOpen(false)
    }
  }, [isMobile])
  useEffect(() => {
    const state = getStudioNavigationState(location.state)
    if (!state) {
      return
    }
    if (state.studioPanel === "library") {
      setIsLibraryOpen(true)
    }
    else if (state.studioPanel === "dataTables") {
      setIsDataTablesOpen(true)
    }
    else if (state.studioPanel === "fixtureEditor") {
      setIsFixtureEditorOpen(true)
    }
    else if (state.studioPanel === "settings") {
      setIsWorkspaceSettingsOpen(true)
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])
  function applyValidationMarkers(editor: Parameters<OnMount>[0], monaco: Parameters<OnMount>[1], nextValidation: YaralValidationResult, nextTreatWarningsAsErrors = treatWarningsAsErrors) {
    const model = editor.getModel()
    if (!model) {
      return
    }
    monaco.editor.setModelMarkers(model, "yaral-validator", nextValidation.diagnostics.map((diagnostic) => ({
      endColumn: diagnostic.endColumn,
      endLineNumber: diagnostic.endLine,
      message: diagnostic.message,
      severity: diagnostic.severity === "error" ||
        (nextTreatWarningsAsErrors && diagnostic.severity === "warning")
        ? monaco.MarkerSeverity.Error
        : monaco.MarkerSeverity.Warning,
      startColumn: diagnostic.column,
      startLineNumber: diagnostic.line,
    })))
  }
  function validateRuleSource(source: string, nextTreatWarningsAsErrors = treatWarningsAsErrorsRef.current) {
    const nextValidation = validateEditorRule(source, {
      dataTables: validationDataTables,
      experimentalDiagnostics: experimentalDiagnosticsRef.current,
      treatWarningsAsErrors: nextTreatWarningsAsErrors,
    })
    setValidation(nextValidation)
    setInspectorRuleText(source)
    if (editorRef.current &&
      monacoRef.current &&
      editorRef.current.getValue() === source) {
      applyValidationMarkers(editorRef.current, monacoRef.current, nextValidation, nextTreatWarningsAsErrors)
    }
    return nextValidation
  }
  function clearScheduledValidation() {
    if (validationTimeoutRef.current !== null) {
      window.clearTimeout(validationTimeoutRef.current)
      validationTimeoutRef.current = null
    }
  }
  function scheduleValidation(source: string, nextTreatWarningsAsErrors = treatWarningsAsErrorsRef.current, delayMs = EDITOR_VALIDATION_DEBOUNCE_MS) {
    clearScheduledValidation()
    validationTimeoutRef.current = window.setTimeout(() => {
      validationTimeoutRef.current = null
      validateRuleSource(source, nextTreatWarningsAsErrors)
    }, delayMs)
  }
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])
  useEffect(() => {
    if (!workspaceSettingsStorageKey || workspaceSettingsHydrationKey === workspaceSettingsStorageKey) {
      return
    }
    const restoredSettings = loadWorkspaceSettings(workspaceSettingsStorageKey)
    setExperimentalDiagnostics(restoredSettings.experimentalDiagnostics)
    setReferenceHighlights(restoredSettings.referenceHighlights)
    setTreatWarningsAsErrors(restoredSettings.treatWarningsAsErrors)
    setWorkspaceSettingsHydrationKey(workspaceSettingsStorageKey)
  }, [workspaceSettingsHydrationKey, workspaceSettingsStorageKey])
  useEffect(() => {
    if (!workspaceSettingsStorageKey ||
      workspaceSettingsHydrationKey !== workspaceSettingsStorageKey) {
      return
    }
    saveWorkspaceSettings(workspaceSettingsStorageKey, {
      experimentalDiagnostics,
      referenceHighlights,
      treatWarningsAsErrors,
    })
  }, [
    experimentalDiagnostics,
    referenceHighlights,
    treatWarningsAsErrors,
    workspaceSettingsHydrationKey,
    workspaceSettingsStorageKey
  ])
  useEffect(() => {
    if (!editorSessionStorageKey || sessionHydrationKey === editorSessionStorageKey) {
      return
    }
    const restoredSession = loadEditorSession(editorSessionStorageKey)
    for (const legacyStorageKey of LEGACY_EDITOR_SESSION_STORAGE_KEYS) {
      window.localStorage.removeItem(legacyStorageKey)
      window.localStorage.removeItem(`${legacyStorageKey}:${authUser?.id ?? ""}`)
    }
    setTabs(restoredSession.tabs)
    setActiveTabId(restoredSession.activeTabId)
    setSessionHydrationKey(editorSessionStorageKey)
  }, [editorSessionStorageKey, sessionHydrationKey])
  useEffect(() => {
    if (sessionHydrationKey !== editorSessionStorageKey ||
      editorTutorialStatus === undefined ||
      hasAutoOpenedTutorialRef.current) {
      return
    }
    hasAutoOpenedTutorialRef.current = true
    if (!editorTutorialStatus.seen) {
      setIsTutorialOpen(true)
    }
  }, [editorSessionStorageKey, editorTutorialStatus, sessionHydrationKey])
  useEffect(() => {
    if (!editorSessionStorageKey || sessionHydrationKey !== editorSessionStorageKey) {
      return
    }
    if (sessionSaveTimeoutRef.current !== null) {
      window.clearTimeout(sessionSaveTimeoutRef.current)
    }
    sessionSaveTimeoutRef.current = window.setTimeout(() => {
      sessionSaveTimeoutRef.current = null
      saveEditorSession(editorSessionStorageKey, tabs, activeTabId)
    }, EDITOR_SESSION_SAVE_DEBOUNCE_MS)
    return () => {
      if (sessionSaveTimeoutRef.current !== null) {
        window.clearTimeout(sessionSaveTimeoutRef.current)
        sessionSaveTimeoutRef.current = null
      }
    }
  }, [activeTabId, editorSessionStorageKey, sessionHydrationKey, tabs])
  useEffect(() => {
    if (!hasLoadedSavedRules) {
      return
    }
    const defaultSavedRule = savedRules.find((rule) => rule.name === getRuleName(SAVED_STARTER_RULE) && rule.source === SAVED_STARTER_RULE)
    if (!defaultSavedRule) {
      return
    }
    setTabs((previousTabs) => {
      let changed = false
      const nextTabs = previousTabs.map((tab) => {
        if (tab.savedRuleId ||
          tab.isDirty ||
          tab.source !== SAVED_STARTER_RULE ||
          (tab.lastSavedSource !== null && tab.lastSavedSource !== SAVED_STARTER_RULE)) {
          return tab
        }
        changed = true
        return {
          ...tab,
          lastSavedSource: defaultSavedRule.source,
          name: defaultSavedRule.name,
          savedRuleId: defaultSavedRule.id,
          source: defaultSavedRule.source,
          sourceRef: { type: "local" as const, savedRuleId: defaultSavedRule.id },
        }
      })
      return changed ? nextTabs : previousTabs
    })
  }, [hasLoadedSavedRules, savedRules])
  useEffect(() => {
    treatWarningsAsErrorsRef.current = treatWarningsAsErrors
    if (activeTab) {
      validateRuleSource(getCurrentRuleText(), treatWarningsAsErrors)
    }
    else {
      clearScheduledValidation()
      setValidation(createEmptyValidation())
      setInspectorRuleText("")
    }
  }, [treatWarningsAsErrors])
  useEffect(() => {
    experimentalDiagnosticsRef.current = experimentalDiagnostics
    if (activeTab) {
      validateRuleSource(getCurrentRuleText(), treatWarningsAsErrorsRef.current)
    }
    else {
      clearScheduledValidation()
      setValidation(createEmptyValidation())
      setInspectorRuleText("")
    }
  }, [experimentalDiagnostics])
  useEffect(() => {
    referenceHighlightsRef.current = referenceHighlights
    if (!referenceHighlights) {
      referenceDecorationsRef.current?.clear()
    }
    else if (editorRef.current && monacoRef.current) {
      updateReferenceHighlights(editorRef.current, monacoRef.current)
    }
  }, [referenceHighlights])
  useEffect(() => {
    if (activeTab) {
      validateRuleSource(getCurrentRuleText(), treatWarningsAsErrorsRef.current)
    }
  }, [validationDataTables])
  useEffect(() => {
    clearScheduledValidation()
    if (!activeTab) {
      setValidation(createEmptyValidation())
      setInspectorRuleText("")
      setTestResult(null)
      applyEditorValueFromTab("")
      return
    }
    if (!editorRef.current) {
      validateRuleSource(activeTab.source, treatWarningsAsErrorsRef.current)
      setInspectorRuleText(activeTab.source)
      setTestResult(null)
      return
    }
    applyEditorValueFromTab(activeTab.source)
    validateRuleSource(activeTab.source, treatWarningsAsErrorsRef.current)
    setInspectorRuleText(activeTab.source)
    setTestResult(null)
  }, [activeTab?.id])
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!tabs.some((tab) => tab.isDirty)) {
        return
      }
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [tabs])
  useEffect(() => {
    function handleEditorCommand(event: KeyboardEvent) {
      const action = getEditorKeybindingAction(event)
      if (!action) {
        return
      }
      event.preventDefault()
      runEditorKeybindingAction(action)
    }
    window.addEventListener("keydown", handleEditorCommand)
    return () => window.removeEventListener("keydown", handleEditorCommand)
  })
  useEffect(() => () => {
    clearScheduledValidation()
    if (sessionSaveTimeoutRef.current !== null) {
      window.clearTimeout(sessionSaveTimeoutRef.current)
      sessionSaveTimeoutRef.current = null
    }
    if (pendingTestTimeoutRef.current !== null) {
      window.clearTimeout(pendingTestTimeoutRef.current)
    }
    findWidgetTitleCleanupRef.current?.()
    findWidgetTitleCleanupRef.current = null
    cancelRunningYaralRuleTest()
  }, [])
  useEffect(() => {
    setYaralDataTableCompletions(dataTableCompletionItems)
  }, [dataTableCompletionItems])
  function getCurrentRuleText() {
    return editorRef.current?.getValue() ?? ruleText
  }
  function applyEditorValueFromTab(value: string) {
    if (!editorRef.current || editorRef.current.getValue() === value) {
      return
    }
    isApplyingTabRef.current = true
    try {
      editorRef.current.setValue(value)
    }
    finally {
      isApplyingTabRef.current = false
    }
  }
  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    referenceDecorationsRef.current = editor.createDecorationsCollection()
    findWidgetTitleCleanupRef.current?.()
    findWidgetTitleCleanupRef.current = suppressMonacoFindWidgetTitles(editor)
    registerEditorKeybindings(editor, monaco)
    validateRuleSource(editor.getValue(), treatWarningsAsErrors)
    editor.onDidChangeCursorPosition((event: editor.ICursorPositionChangedEvent) => {
      setCursorPos({
        line: event.position.lineNumber,
        col: event.position.column,
      })
      updateReferenceHighlights(editor, monaco)
    })
    editor.onDidChangeModelContent(() => {
      if (isApplyingTabRef.current) {
        return
      }
      const nextRuleText = editor.getValue()
      const nextTreatWarningsAsErrors = treatWarningsAsErrorsRef.current
      const nextName = getRuleName(nextRuleText)
      const currentTabId = activeTabIdRef.current
      setTabs((previousTabs) => previousTabs.map((tab) => tab.id === currentTabId
        ? {
          ...tab,
          isDirty: nextRuleText !== tab.lastSavedSource,
          name: nextName,
          source: nextRuleText,
        }
        : tab))
      scheduleValidation(nextRuleText, nextTreatWarningsAsErrors)
      updateReferenceHighlights(editor, monaco)
    })
  }
  function registerEditorKeybindings(editor: Parameters<OnMount>[0], monaco: Parameters<OnMount>[1]) {
    const ctrlCmd = monaco.KeyMod.CtrlCmd
    const shift = monaco.KeyMod.Shift
    const alt = monaco.KeyMod.Alt
    const bindings: Array<[
      number,
      NonNullable<ReturnType<typeof getEditorKeybindingAction>>
    ]> = [
        [ctrlCmd | monaco.KeyCode.KeyS, "save"],
        [ctrlCmd | monaco.KeyCode.KeyK, "commandPalette"],
        [ctrlCmd | shift | monaco.KeyCode.KeyF, "format"],
        [ctrlCmd | monaco.KeyCode.Enter, "testPanel"],
        [monaco.KeyCode.F8, "firstDiagnostic"],
        [ctrlCmd | alt | monaco.KeyCode.KeyN, "newRule"],
        [ctrlCmd | alt | monaco.KeyCode.KeyL, "library"],
        [ctrlCmd | alt | monaco.KeyCode.KeyD, "dataTables"],
        [ctrlCmd | shift | monaco.KeyCode.KeyW, "toggleWarnings"],
        [ctrlCmd | monaco.KeyCode.Equal, "zoomIn"],
        [ctrlCmd | monaco.KeyCode.Minus, "zoomOut"]
      ]
    for (const [keybinding, action] of bindings) {
      editor.addCommand(keybinding, () => runEditorKeybindingAction(action))
    }
  }
  const editorCommands = useMemo<EditorCommand[]>(() => [
    {
      disabled: !hasOpenTabs,
      group: "Rule",
      id: "save-rule",
      keywords: ["library"],
      label: "Save Rule",
      onSelect: () => void handleSaveRule(),
      shortcut: "Ctrl S",
    },
    {
      disabled: !hasOpenTabs,
      group: "Rule",
      id: "format-rule",
      keywords: ["pretty print indent"],
      label: "Format Rule",
      onSelect: handleFormatRule,
      shortcut: "Ctrl Shift F",
    },
    {
      group: "Rule",
      id: "new-rule",
      keywords: ["tab"],
      label: "New Rule Tab",
      onSelect: handleNewTab,
      shortcut: "Ctrl Alt N",
    },
    {
      group: "Navigate",
      id: "open-library",
      keywords: ["rules saved"],
      label: "Open Rule Library",
      onSelect: () => setIsLibraryOpen(true),
      shortcut: "Ctrl Alt L",
    },
    {
      group: "Navigate",
      id: "open-data-tables",
      keywords: ["reference lists tables"],
      label: "Open Data Tables",
      onSelect: () => setIsDataTablesOpen(true),
      shortcut: "Ctrl Alt D",
    },
    {
      group: "Testing",
      id: "open-test-panel",
      keywords: ["test cases test events output results"],
      label: "Open Test Panel",
      onSelect: () => setIsOutputPanelOpen(true),
      shortcut: "Ctrl Enter",
    },
    {
      disabled: validation.diagnostics.length === 0,
      group: "Navigate",
      id: "first-diagnostic",
      keywords: ["error warning issue"],
      label: "Go To First Diagnostic",
      onSelect: goToFirstDiagnostic,
      shortcut: "F8",
    },
    {
      group: "Workspace",
      id: "toggle-experimental-diagnostics",
      keywords: ["validation warnings experimental udm fields"],
      label: experimentalDiagnostics
        ? "Disable Experimental Diagnostics"
        : "Enable Experimental Diagnostics",
      onSelect: () => setExperimentalDiagnostics((value) => !value),
    },
    {
      group: "Workspace",
      id: "toggle-reference-highlights",
      keywords: ["highlight references outcome event variable"],
      label: referenceHighlights
        ? "Disable Reference Highlights"
        : "Enable Reference Highlights",
      onSelect: () => setReferenceHighlights((value) => !value),
    },
    {
      group: "Workspace",
      id: "toggle-warnings",
      keywords: ["validation errors"],
      label: treatWarningsAsErrors
        ? "Allow Warnings Without Failing"
        : "Treat Warnings As Errors",
      onSelect: () => setTreatWarningsAsErrors((value) => !value),
      shortcut: "Ctrl Shift W",
    },
    {
      group: "View",
      id: "zoom-in",
      label: "Increase Editor Font Size",
      onSelect: () => zoom(1),
      shortcut: "Ctrl =",
    },
    {
      group: "View",
      id: "zoom-out",
      label: "Decrease Editor Font Size",
      onSelect: () => zoom(-1),
      shortcut: "Ctrl -",
    }
  ], [experimentalDiagnostics, hasOpenTabs, referenceHighlights, treatWarningsAsErrors, validation.diagnostics])
  function activateTab(id: string) {
    activeTabIdRef.current = id
    setActiveTabId(id)
  }
  function openRuleTab(nextTab: RuleEditorTab, successMessage?: string) {
    if (tabs.length >= MAX_OPEN_RULE_TABS) {
      toast.error(OPEN_RULE_TAB_LIMIT_MESSAGE)
      return false
    }
    setTabs((previousTabs) => previousTabs.length >= MAX_OPEN_RULE_TABS ? previousTabs : [...previousTabs, nextTab])
    activateTab(nextTab.id)
    if (successMessage) {
      toast.success(successMessage)
    }
    return true
  }
  function handleNewTab() {
    const nextTab = createRuleTab()
    openRuleTab(nextTab)
  }
  function handleCloseTab(id: string) {
    const tab = tabs.find((item) => item.id === id)
    if (tab?.isDirty) {
      setPendingCloseTabId(id)
      return
    }
    closeTab(id)
  }
  function closeTab(id: string) {
    setTabs((previousTabs) => {
      const closedTabIndex = previousTabs.findIndex((tab) => tab.id === id)
      const nextTabs = previousTabs.filter((tab) => tab.id !== id)
      if (nextTabs.length === 0) {
        activeTabIdRef.current = ""
        setActiveTabId("")
        setTestResult(null)
        return []
      }
      if (id === activeTabIdRef.current) {
        const nextActiveTab = nextTabs[Math.max(0, closedTabIndex - 1)] ?? nextTabs[0]
        activeTabIdRef.current = nextActiveTab.id
        setActiveTabId(nextActiveTab.id)
      }
      return nextTabs
    })
  }
  function confirmCloseDirtyTab() {
    if (!pendingCloseTabId) {
      return
    }
    closeTab(pendingCloseTabId)
    setPendingCloseTabId(null)
  }
  function zoom(delta: number) {
    setFontSize((prev) => {
      const next = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, prev + delta))
      editorRef.current?.updateOptions({ fontSize: next })
      return next
    })
  }
  function runEditorKeybindingAction(action: ReturnType<typeof getEditorKeybindingAction>) {
    if (!action) {
      return
    }
    switch (action) {
      case "commandPalette":
        setIsCommandPaletteOpen(true)
        return
      case "dataTables":
        setIsDataTablesOpen(true)
        return
      case "firstDiagnostic":
        goToFirstDiagnostic()
        return
      case "format":
        handleFormatRule()
        return
      case "library":
        setIsLibraryOpen(true)
        return
      case "newRule":
        handleNewTab()
        return
      case "save":
        void handleSaveRule()
        return
      case "testPanel":
        setIsOutputPanelOpen(true)
        return
      case "toggleWarnings":
        setTreatWarningsAsErrors((value) => !value)
        return
      case "zoomIn":
        zoom(1)
        return
      case "zoomOut":
        zoom(-1)
        return
    }
  }
  function handleFormatRule() {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model || !activeTab) {
      return
    }
    const source = editor.getValue()
    const formatted = formatYaralRule(source)
    if (formatted === source) {
      toast.info("Rule is already formatted.")
      return
    }
    const fullRange = model.getFullModelRange()
    editor.executeEdits("format-yaral-rule", [
      {
        forceMoveMarkers: true,
        range: fullRange,
        text: formatted,
      }
    ])
    editor.pushUndoStop()
    validateRuleSource(formatted, treatWarningsAsErrorsRef.current)
    toast.success("Formatted rule.")
  }
  function goToFirstDiagnostic() {
    const editor = editorRef.current
    const [diagnostic] = validation.diagnostics
    if (!editor || !diagnostic) {
      return
    }
    editor.focus()
    editor.revealPositionInCenter({
      column: diagnostic.column,
      lineNumber: diagnostic.line,
    })
    editor.setPosition({
      column: diagnostic.column,
      lineNumber: diagnostic.line,
    })
  }
  function updateReferenceHighlights(editor: Parameters<OnMount>[0], monaco: Parameters<OnMount>[1]) {
    const model = editor.getModel()
    const position = editor.getPosition()
    const decorations = referenceDecorationsRef.current
    if (!model || !position || !decorations) {
      return
    }
    if (!referenceHighlightsRef.current) {
      decorations.clear()
      return
    }
    const ranges = getYaralCompilerReferenceRanges(model.getValue(), position)
    decorations.set(ranges.map((range) => ({
      options: {
        className: "yaral-reference-highlight",
        overviewRuler: {
          color: "rgba(245, 158, 11, 0.55)",
          position: monaco.editor.OverviewRulerLane.Center,
        },
      },
      range: new monaco.Range(range.line, range.column, range.endLine, range.endColumn),
    })))
  }
  function runRuleTest(sampleEvents: unknown[], dataTables: YaralEvaluationDataTable[] = []) {
    if (!activeTab || isTestRunning) {
      return
    }
    const events = sampleEvents as Record<string, unknown>[]
    const runId = testRunIdRef.current + 1
    testRunIdRef.current = runId
    const source = getCurrentRuleText()
    const currentValidation = validateEditorRule(source, {
      dataTables,
      experimentalDiagnostics: experimentalDiagnosticsRef.current,
      treatWarningsAsErrors: treatWarningsAsErrorsRef.current,
    })
    const targetRuleName = currentValidation.ruleName ?? getRuleName(source)
    setIsTestRunning(true)
    setTestResult(null)
    setIsOutputPanelOpen(true)
    pendingTestTimeoutRef.current = window.setTimeout(() => {
      pendingTestTimeoutRef.current = null
      if (testRunIdRef.current !== runId) {
        return
      }
      runYaralRuleTestInBrowser({
        dataTables,
        events,
        ruleText: source,
        runMode: targetRuleName ? "target" : "first",
        targetRuleName,
      })
        .then((result) => {
          if (testRunIdRef.current !== runId) {
            return
          }
          const matched = result.rules.some((rule) => rule.result.matched)
          const matchCount = result.rules.reduce((count, rule) => count + rule.result.matches.length, 0)
          setTestResult(result)
          setTestRunHistory((current) => [
            {
              eventCount: events.length,
              fixtureCount: dataTables.length,
              id: `${Date.now()}-${runId}`,
              matched,
              matchCount,
              ranAt: new Date().toISOString(),
              result,
              ruleName: targetRuleName,
            },
            ...current
          ].slice(0, MAX_TEST_RUN_HISTORY))
        })
        .catch((error) => {
          if (testRunIdRef.current !== runId) {
            return
          }
          toast.error(getPublicErrorMessage(error, "Could not run test."))
        })
        .finally(() => {
          if (testRunIdRef.current === runId) {
            setIsTestRunning(false)
          }
        })
    }, 0)
  }
  function cancelRuleTest() {
    testRunIdRef.current += 1
    if (pendingTestTimeoutRef.current !== null) {
      window.clearTimeout(pendingTestTimeoutRef.current)
      pendingTestTimeoutRef.current = null
    }
    cancelRunningYaralRuleTest()
    setIsTestRunning(false)
  }
  async function handleSaveRule() {
    if (!activeTab) {
      toast.error("Open or create a rule tab before saving.")
      return
    }
    const nextRuleText = editorRef.current?.getValue() ?? ruleText
    const nextRuleName = getRuleName(nextRuleText)
    const toastId = "save-rule"
    try {
      if (!activeTab.savedRuleId) {
        setFirstSaveMetadata({
          folder: "",
          name: nextRuleName,
          source: nextRuleText,
          tags: "",
        })
        return
      }
      const refreshedRulesResult = await refetchSavedRules()
      const currentSavedRules = ((refreshedRulesResult.data ?? savedRules) as SavedRuleSummary[])
      const currentSavedRule = currentSavedRules.find((rule) => rule.id === activeTab.savedRuleId) ?? null
      const lastSavedRuleName = activeTab.lastSavedSource
        ? getRuleName(activeTab.lastSavedSource)
        : activeTab.name
      if (activeTab.savedRuleId &&
        !currentSavedRule) {
        clearActiveTabSavedRuleReference(nextRuleText, nextRuleName)
        setFirstSaveMetadata({
          folder: "",
          name: nextRuleName,
          source: nextRuleText,
          tags: "",
        })
        return
      }
      if (!currentSavedRule) {
        return
      }
      if (nextRuleName !== lastSavedRuleName) {
        setFirstSaveMetadata({
          folder: currentSavedRule.folder ?? "",
          name: nextRuleName,
          source: nextRuleText,
          tags: (currentSavedRule.tags ?? []).join(", "),
        })
        return
      }
      const nextDescription = getYaralRuleMetadata(nextRuleText).description ?? null
      if (currentSavedRule.source === nextRuleText &&
        (currentSavedRule.description ?? null) === nextDescription) {
        markActiveTabClean(nextRuleText, nextRuleName)
        toast.info("No changes to save.")
        return
      }
      toast.loading(`Saving ${nextRuleName}...`, { id: toastId })
      const saved = await withTimeout(saveRule({
        description: nextDescription,
        folder: currentSavedRule.folder ?? null,
        id: activeTab.savedRuleId,
        name: nextRuleName,
        source: nextRuleText,
        tags: currentSavedRule.tags ?? [],
      }), 8000, "Internal server error.")
      setTabs((previousTabs) => previousTabs.map((tab) => tab.id === activeTabIdRef.current
        ? {
          ...tab,
          isDirty: false,
          lastSavedSource: saved.source,
          name: saved.name,
          savedRuleId: saved.id,
          sourceRef: { type: "local", savedRuleId: saved.id },
          source: saved.source,
        }
        : tab))
      toast.success(`Saved ${saved.name} to the library.`, { id: toastId })
      await refetchSavedRules()
      setLibraryRefreshToken((value) => value + 1)
    }
    catch (error) {
      if (isMissingSavedRuleError(error)) {
        const nextRuleText = editorRef.current?.getValue() ?? ruleText
        const nextRuleName = getRuleName(nextRuleText)
        clearActiveTabSavedRuleReference(nextRuleText, nextRuleName)
        setFirstSaveMetadata({
          folder: "",
          name: nextRuleName,
          source: nextRuleText,
          tags: "",
        })
        toast.info("That saved rule is no longer available. Save it as a new local rule.", {
          id: toastId,
        })
        return
      }
      toast.error(getPublicErrorMessage(error, "Could not save rule."), {
        id: toastId,
      })
    }
  }
  function markActiveTabClean(source: string, name: string) {
    setTabs((previousTabs) => previousTabs.map((tab) => tab.id === activeTabIdRef.current
      ? {
        ...tab,
        isDirty: false,
        lastSavedSource: source,
        name,
        source,
      }
      : tab))
  }
  function clearActiveTabSavedRuleReference(source: string, name: string) {
    setTabs((previousTabs) => previousTabs.map((tab) => tab.id === activeTabIdRef.current
      ? {
        ...tab,
        isDirty: source !== tab.lastSavedSource,
        name,
        savedRuleId: null,
        source,
        sourceRef: { type: "local", savedRuleId: null },
      }
      : tab))
  }
  async function handleConfirmFirstLocalSave() {
    if (!activeTab || !firstSaveMetadata) {
      return
    }
    const name = firstSaveMetadata.name.trim() || getRuleName(firstSaveMetadata.source)
    const existingRule = savedRules.find((rule) => rule.name === name)
    if (existingRule) {
      setPendingRuleOverwrite({
        existingRule,
        metadata: {
          ...firstSaveMetadata,
          name,
        },
      })
      return
    }
    await saveFirstLocalRule(firstSaveMetadata, null)
  }
  async function saveFirstLocalRule(metadata: FirstSaveMetadata, overwriteRuleId: string | null) {
    if (!activeTab) {
      return
    }
    const name = metadata.name.trim() || getRuleName(metadata.source)
    const folder = metadata.folder.trim()
    const tags = parseTagInput(metadata.tags)
    const toastId = "save-rule"
    setIsFirstSaveSaving(true)
    try {
      toast.loading(overwriteRuleId ? `Replacing ${name}...` : `Saving ${name}...`, { id: toastId })
      const saved = await withTimeout(saveRule({
        description: getYaralRuleMetadata(metadata.source).description,
        folder: folder || null,
        id: overwriteRuleId,
        name,
        source: metadata.source,
        tags,
      }), 8000, "Internal server error.")
      setTabs((previousTabs) => previousTabs.map((tab) => tab.id === activeTabIdRef.current
        ? {
          ...tab,
          isDirty: false,
          lastSavedSource: saved.source,
          name: saved.name,
          savedRuleId: saved.id,
          sourceRef: { type: "local", savedRuleId: saved.id },
          source: saved.source,
        }
        : tab))
      setFirstSaveMetadata(null)
      setPendingRuleOverwrite(null)
      toast.success(overwriteRuleId
        ? `Replaced ${saved.name} in the library.`
        : `Saved ${saved.name} to the library.`, { id: toastId })
      await refetchSavedRules()
      setLibraryRefreshToken((value) => value + 1)
    }
    catch (error) {
      toast.error(getPublicErrorMessage(error, "Could not save rule."), {
        id: toastId,
      })
    }
    finally {
      setIsFirstSaveSaving(false)
    }
  }
  function handleLoadRule(rule: SavedRuleSummary) {
    const nextTab = createRuleTab(rule.source, {
      lastSavedSource: rule.source,
      name: rule.name,
      savedRuleId: rule.id,
    })
    openRuleTab(nextTab)
  }
  function handleInsertDataTableReference(reference: string) {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    const selection = editor.getSelection()
    if (!selection) {
      return
    }
    editor.executeEdits("data-table-reference", [
      {
        range: selection,
        text: reference,
        forceMoveMarkers: true,
      }
    ])
    editor.focus()
    validateRuleSource(editor.getValue(), treatWarningsAsErrorsRef.current)
  }
  return (<AppShell breadcrumb="Rule Editor" compactHeader section="Workspace" title="Rule Editor" actions={({ bugReportHref }) => (<>
    <Button type="button" size="sm" className="h-8 text-xs" onClick={() => void handleSaveRule()} disabled={!hasOpenTabs} title={getSaveActionTitle(activeTab)}>
      <SaveIcon />
      <span className="hidden sm:inline">{getSaveActionLabel(activeTab)}</span>
    </Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs" title="More editor actions">
          <MoreHorizontalIcon />
          <span className="hidden sm:inline">More</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">

        <DropdownMenuItem onSelect={() => setIsTutorialOpen(true)}>
          <HelpCircleIcon />
          Guide
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setIsCommandPaletteOpen(true)}>
          <CommandIcon />
          Command palette
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setIsImportExportOpen(true)}>
          <ImportIcon />
          Import / export
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setIsWorkspaceSettingsOpen(true)}>
          <Settings2Icon />
          Workspace settings
        </DropdownMenuItem>
        {bugReportHref ? (<>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href={bugReportHref}>
              <BugIcon />
              Report a bug
            </a>
          </DropdownMenuItem>
        </>) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  </>)}>
    <Suspense fallback={null}>
      <RuleLibraryPanel activeSavedRuleId={activeTab?.savedRuleId ?? null} currentRuleName={activeTab?.name ?? UNTITLED_RULE_NAME} getCurrentRuleText={getCurrentRuleText} isOpen={isLibraryOpen} refreshToken={libraryRefreshToken} onLoadRule={handleLoadRule} onOpenChange={setIsLibraryOpen} />
    </Suspense>
    {isDataTablesOpen ? (<Suspense fallback={null}>
      <DataTablesPanel dataTables={savedDataTables} error={dataTablesError} isOpen={isDataTablesOpen} onDataTableDeleted={(id) => {
        setDeletedDataTableIds((current) => [...new Set([...current, id])])
        setOptimisticDataTables((current) => current.filter((table) => table.id !== id))
      }} onDataTableSaved={(table) => {
        setDeletedDataTableIds((current) => current.filter((id) => id !== table.id))
        setOptimisticDataTables((current) => mergeDataTableSummaries(current, [table]))
      }} onInsertReference={handleInsertDataTableReference} onOpenChange={setIsDataTablesOpen} onRefreshDataTables={async () => {
        await refetchDataTables()
      }} />
    </Suspense>) : null}
    {isCommandPaletteOpen ? (<Suspense fallback={null}>
      <CommandPalette commands={editorCommands} isOpen={isCommandPaletteOpen} onOpenChange={setIsCommandPaletteOpen} />
    </Suspense>) : null}
    <EventExplorerDialog isOpen={isEventExplorerOpen} onOpenChange={setIsEventExplorerOpen} />
    <ValidatorDialog currentRuleText={getCurrentRuleText} dataTables={validationDataTables ?? []} experimentalDiagnostics={experimentalDiagnostics} isOpen={isValidatorOpen} onOpenChange={setIsValidatorOpen} treatWarningsAsErrors={treatWarningsAsErrors} />
    <RuleEditorTutorialDialog isOpen={isTutorialOpen} onOpenChange={(open) => {
      setIsTutorialOpen(open)
      if (!open) {
        void markEditorTutorialSeen()
          .then(() => refetchEditorTutorialStatus())
          .catch(() => undefined)
      }
    }} />
    <ImportExportDialog currentRuleName={activeTab?.name ?? UNTITLED_RULE_NAME} currentRuleText={getCurrentRuleText} isOpen={isImportExportOpen} onImportRule={(source) => {
      const nextTab = createRuleTab(source, {
        lastSavedSource: null,
        name: getRuleName(source),
      })
      if (openRuleTab(nextTab, `Imported ${nextTab.name}.`)) {
        setIsImportExportOpen(false)
      }
    }} onOpenChange={setIsImportExportOpen} />
    <DialogPrimitive.Root open={Boolean(firstSaveMetadata)} onOpenChange={(open) => {
      if (open || isFirstSaveSaving) {
        return
      }
      setFirstSaveMetadata(null)
    }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80" />
        <DialogPrimitive.Content className={`fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-sidebar text-sidebar-foreground shadow-xl outline-none ${isMobile
          ? "inset-x-3 top-1/2 max-h-[min(90vh,calc(100vh-2rem))] -translate-y-1/2"
          : "left-1/2 top-1/2 max-h-[min(90vh,calc(100vh-2rem))] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2"}`}>
          <div className="border-b border-sidebar-border px-4 py-3">
            <DialogPrimitive.Title className="text-sm font-semibold">
              Save rule
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Save this rule to your library.
            </DialogPrimitive.Description>
          </div>
          <div className="grid gap-3 p-4">
            <div className="grid gap-1.5 text-xs font-medium">
              <span>Rule name</span>
              <div aria-label="Rule name" className="flex h-8 items-center rounded-md border border-input bg-muted/40 px-3 font-mono text-xs text-muted-foreground" id="first-save-name">
                <span className="min-w-0 truncate">{firstSaveMetadata?.name ?? ""}</span>
              </div>
              <p className="text-[11px] font-normal leading-4 text-muted-foreground">
                Rename it in the rule declaration before saving.
              </p>
            </div>
            <label className="grid gap-1.5 text-xs font-medium" htmlFor="first-save-folder">
              Folder
              <Input id="first-save-folder" value={firstSaveMetadata?.folder ?? ""} onChange={(event) => {
                const nextFolder = event.currentTarget.value
                setFirstSaveMetadata((current) => current ? { ...current, folder: nextFolder } : current)
              }} disabled={isFirstSaveSaving} className="h-8 text-xs" maxLength={RULE_FOLDER_MAX_LENGTH} placeholder="Optional folder" />
            </label>
            <label className="grid gap-1.5 text-xs font-medium" htmlFor="first-save-tags">
              Tags
              <Input id="first-save-tags" value={firstSaveMetadata?.tags ?? ""} onChange={(event) => {
                const nextTags = event.currentTarget.value
                setFirstSaveMetadata((current) => current ? { ...current, tags: nextTags } : current)
              }} disabled={isFirstSaveSaving} className="h-8 font-mono text-xs" maxLength={RULE_TAGS_INPUT_MAX_LENGTH} placeholder="tag_one, tag_two" />
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-sidebar-border px-4 py-3">
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={isFirstSaveSaving} onClick={() => setFirstSaveMetadata(null)}>
              Cancel
            </Button>

            <Button type="button" size="sm" className="h-8 text-xs" disabled={!firstSaveMetadata?.name.trim() || isFirstSaveSaving} onClick={() => void handleConfirmFirstLocalSave()}>
              <SaveIcon />
              Save Local Rule
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
    <ConfirmDialog confirmLabel="Replace Rule" description={pendingRuleOverwrite
      ? `A rule named "${pendingRuleOverwrite.existingRule.name}" already exists. Replacing it will update that existing library rule and keep rule names unique.`
      : ""} isDestructive isOpen={Boolean(pendingRuleOverwrite)} title="Replace existing rule?" onConfirm={() => {
        if (!pendingRuleOverwrite) {
          return
        }
        void saveFirstLocalRule(pendingRuleOverwrite.metadata, pendingRuleOverwrite.existingRule.id)
      }} onOpenChange={(open) => {
        if (!open) {
          setPendingRuleOverwrite(null)
        }
      }} />
    <DialogPrimitive.Root open={isWorkspaceSettingsOpen} onOpenChange={setIsWorkspaceSettingsOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80" />
        <DialogPrimitive.Content className={`fixed z-50 flex flex-col overflow-hidden rounded-lg border bg-sidebar text-sidebar-foreground shadow-xl outline-none ${isMobile
          ? "inset-0 rounded-none"
          : "left-1/2 top-1/2 max-h-[min(90vh,calc(100vh-2rem))] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2"}`}>
          <div className="border-b border-sidebar-border px-4 py-3">
            <DialogPrimitive.Title className="text-sm font-semibold">
              Settings
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
              Tune validation behaviour for the current workspace.
            </DialogPrimitive.Description>
          </div>
          <div className="space-y-3 p-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-sidebar-border bg-sidebar-accent/35 px-3 py-2.5 transition-colors hover:bg-sidebar-accent/60">
              <Checkbox checked={experimentalDiagnostics} onCheckedChange={(checked) => setExperimentalDiagnostics(Boolean(checked))} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  Experimental diagnostics
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  Show advisory checks for useful local warnings that still need official YARA-L documentation confirmation.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-sidebar-border bg-sidebar-accent/35 px-3 py-2.5 transition-colors hover:bg-sidebar-accent/60">
              <Checkbox checked={referenceHighlights} onCheckedChange={(checked) => setReferenceHighlights(Boolean(checked))} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  Highlight matching references
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  Highlight related YARA-L variables like event and outcome references when the cursor is on one of them.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-sidebar-border bg-sidebar-accent/35 px-3 py-2.5 transition-colors hover:bg-sidebar-accent/60">
              <Checkbox checked={treatWarningsAsErrors} onCheckedChange={(checked) => setTreatWarningsAsErrors(Boolean(checked))} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  Warnings fail validation
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  Promote validator warnings to errors while editing and testing rules.
                </span>
              </span>
            </label>
          </div>
          <div className="flex justify-end border-t border-sidebar-border px-4 py-3">
            <DialogPrimitive.Close asChild>
              <Button type="button" size="sm" className="h-8 text-xs">
                Done
              </Button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>

    <ConfirmDialog confirmLabel="Close Tab" description="This rule has unsaved changes. Closing it will discard the edits in this tab." isDestructive isOpen={Boolean(pendingCloseTabId)} title="Close unsaved rule?" onConfirm={confirmCloseDirtyTab} onOpenChange={(open) => {
      if (!open) {
        setPendingCloseTabId(null)
      }
    }} />

    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-2">
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border bg-sidebar shadow-sm">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {activeTab ? (<div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-2 xl:hidden">
            <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
              {validation.ruleName ?? activeTab.name}
            </span>
            <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 text-xs" onClick={() => setIsInspectorOpen(true)}>
              <ShieldCheckIcon />
              Inspector
            </Button>
          </div>) : null}
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              {activeTab ? (<EditorTabBar activeTabId={activeTab.id} canOpenNewTab={tabs.length < MAX_OPEN_RULE_TABS} fontSize={fontSize} tabs={tabs.map((tab) => ({
                id: tab.id,
                isDirty: tab.isDirty,
                name: tab.name,
              }))} onCloseTab={handleCloseTab} onNewTab={handleNewTab} onSelectTab={activateTab} onZoomIn={() => zoom(1)} onZoomOut={() => zoom(-1)} />) : null}

              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                {activeTab ? null : (<div className="flex h-full items-center justify-center bg-muted/5 p-6">
                  <div className="flex max-w-md flex-col items-center gap-4 text-center">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold">No rule selected</h3>
                      <p className="text-xs leading-5 text-muted-foreground">
                        Create a new rule or open one from the library to start editing and testing.
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button type="button" size="sm" className="h-8 text-xs" onClick={handleNewTab}>
                        <FilePlusIcon />
                        New Rule
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setIsLibraryOpen(true)}>
                        <BookOpenIcon />
                        Library
                      </Button>
                    </div>
                  </div>
                </div>)}
                <div className={activeTab ? "h-full min-w-0 overflow-hidden" : "hidden"}>
                  <Suspense fallback={<div className="flex h-full items-center justify-center bg-background">
                    <LoadingIndicator label="Loading editor" />
                  </div>}>
                    <Editor theme="yaral-dark" language="yaral" height="100%" defaultValue={activeTab?.source ?? ""} beforeMount={configureYaralLanguage} onMount={handleEditorMount} options={{
                      automaticLayout: true,
                      fontSize,
                      fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
                      lineNumbers: "on",
                      minimap: { enabled: false },
                      cursorBlinking: "smooth",
                      hideCursorInOverviewRuler: true,
                      links: false,
                      occurrencesHighlight: "off",
                      overviewRulerBorder: false,
                      overviewRulerLanes: 0,
                      renderLineHighlight: "none",
                      scrollBeyondLastLine: false,
                      scrollbar: {
                        horizontalScrollbarSize: 10,
                        verticalScrollbarSize: 10,
                        useShadows: false,
                      },
                      wordWrap: "off",
                      tabSize: 2,
                      insertSpaces: true,
                      folding: true,
                      lineDecorationsWidth: 16,
                      lineNumbersMinChars: 3,
                      find: { addExtraSpaceOnTop: false },
                      padding: { top: 0, bottom: 16 },
                      smoothScrolling: true,
                      stickyScroll: { enabled: false },
                    }} />
                  </Suspense>
                </div>
              </div>

              {activeTab ? (<>
                <StatusBar cursorColumn={cursorPos.col} cursorLine={cursorPos.line} sourceContext={getTabStatusContext(activeTab)} />
                <Suspense fallback={null}>
                  <OutputPanel activeSavedRuleId={activeTab.savedRuleId} dataTables={validationDataTables ?? []} getRuleText={getCurrentRuleText} hasRule height={outputPanelHeight} isTestConfigOpen={isFixtureEditorOpen} isRunningTest={isTestRunning} isOpen={isOutputPanelOpen} testHistory={testRunHistory} onCancelRunTest={cancelRuleTest} onClearResult={() => setTestResult(null)} onHeightChange={setOutputPanelHeight} onOpenChange={setIsOutputPanelOpen} onRestoreHistoryResult={setTestResult} onTestConfigOpenChange={setIsFixtureEditorOpen} onRunTest={runRuleTest} result={testResult} ruleText={ruleText} />
                </Suspense>
              </>) : null}
            </div>

            {activeTab ? (<Suspense fallback={null}>
              <RuleInspector dataTables={savedDataTables} hasRule isOpen={isInspectorOpen} ruleText={inspectorRuleText} treatWarningsAsErrors={treatWarningsAsErrors} validation={validation} width={inspectorWidth} onOpenChange={setIsInspectorOpen} onWidthChange={setInspectorWidth} />
            </Suspense>) : null}
          </div>
        </div>
      </div>
    </div>
  </AppShell>)
}
function EventExplorerDialog({ isOpen, onOpenChange, }: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [rawEvent, setRawEvent] = useState("")
  const [query, setQuery] = useState("")
  const parsed = useMemo(() => parseJsonObject(rawEvent), [rawEvent])
  const rows = useMemo(() => {
    if (!parsed.value) {
      return []
    }
    const normalizedQuery = query.trim().toLowerCase()
    return flattenJson(parsed.value).filter((row) => normalizedQuery.length === 0 ||
      row.path.toLowerCase().includes(normalizedQuery) ||
      row.value.toLowerCase().includes(normalizedQuery))
  }, [parsed.value, query])
  return (<ToolDialog description="Paste one UDM event to inspect field paths and values." isOpen={isOpen} onOpenChange={onOpenChange} title="Event Explorer">
    <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,1.05fr)]">
      <div className="flex min-h-0 flex-col gap-2">
        <Textarea className="min-h-72 flex-1 resize-none bg-sidebar-accent/35 font-mono text-xs" onChange={(event) => setRawEvent(event.currentTarget.value)} placeholder='{"metadata":{"event_type":"PROCESS_LAUNCH"}}' value={rawEvent} />
        {parsed.error ? (<p className="text-xs text-destructive">{parsed.error}</p>) : (<p className="text-xs text-muted-foreground">
          {rows.length === 0 ? "Paste an object to inspect its fields." : `${rows.length} fields found.`}
        </p>)}
      </div>
      <div className="flex min-h-0 flex-col gap-2">
        <Input className="h-8 bg-sidebar-accent/35 text-xs" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Filter paths or values" value={query} />
        <ScrollArea className="min-h-72 flex-1 rounded-md border border-sidebar-border bg-sidebar-accent/25">
          <div className="divide-y divide-sidebar-border">
            {rows.length > 0 ? (rows.map((row) => (<div key={row.path} className="grid gap-1 px-3 py-2">
              <code className="break-all text-xs text-foreground">{row.path}</code>
              <span className="break-all text-xs text-muted-foreground">{row.value}</span>
            </div>))) : (<div className="px-3 py-8 text-center text-xs text-muted-foreground">
              No fields to show.
            </div>)}
          </div>
        </ScrollArea>
      </div>
    </div>
  </ToolDialog>)
}
function ValidatorDialog({ currentRuleText, dataTables, experimentalDiagnostics, isOpen, onOpenChange, treatWarningsAsErrors, }: {
  currentRuleText: () => string
  dataTables: YaralEvaluationDataTable[]
  experimentalDiagnostics: boolean
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  treatWarningsAsErrors: boolean
}) {
  const ruleText = isOpen ? currentRuleText() : ""
  const report = useMemo(() => ruleText
    ? validateEditorRule(ruleText, {
      dataTables,
      experimentalDiagnostics,
      treatWarningsAsErrors,
    })
    : createEmptyValidation(), [dataTables, experimentalDiagnostics, ruleText, treatWarningsAsErrors])
  const errorCount = report.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length
  const warningCount = report.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length
  return (<ToolDialog description="Review diagnostics for the active editor tab." isOpen={isOpen} onOpenChange={onOpenChange} title="Validator">
    <div className="flex flex-wrap gap-2">
      <Badge variant={report.isValid ? "default" : "destructive"}>
        {report.isValid ? "Valid" : "Needs attention"}
      </Badge>
      <Badge variant="outline">{errorCount} errors</Badge>
      <Badge variant="outline">{warningCount} warnings</Badge>
      <Badge variant="outline">{report.ruleType.replace("_", " ")}</Badge>
    </div>
    <ScrollArea className="mt-3 max-h-[55vh] rounded-md border border-sidebar-border bg-sidebar-accent/25">
      <div className="divide-y divide-sidebar-border">
        {report.diagnostics.length > 0 ? (report.diagnostics.map((diagnostic, index) => (<div key={`${diagnostic.line}-${diagnostic.column}-${index}`} className="grid gap-1 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={diagnostic.severity === "error" ? "destructive" : "outline"}>
              {diagnostic.severity}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Line {diagnostic.line}, column {diagnostic.column}
            </span>
          </div>
          <p className="truncate text-sm text-foreground" title={diagnostic.message}>
            {diagnostic.message}
          </p>
        </div>))) : (<div className="px-3 py-8 text-center text-sm text-muted-foreground">
          No diagnostics for the active rule.
        </div>)}
      </div>
    </ScrollArea>
  </ToolDialog>)
}
function ImportExportDialog({ currentRuleName, currentRuleText, isOpen, onImportRule, onOpenChange, }: {
  currentRuleName: string
  currentRuleText: () => string
  isOpen: boolean
  onImportRule: (source: string) => void
  onOpenChange: (open: boolean) => void
}) {
  function exportActiveRule() {
    const source = currentRuleText()
    const blob = new Blob([source], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${sanitizeFileName(currentRuleName)}.yaral`
    link.click()
    URL.revokeObjectURL(url)
  }
  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ""
    if (!file) {
      return
    }
    onImportRule(await file.text())
  }
  return (<ToolDialog description="Move rules in or out of the active browser workspace." isOpen={isOpen} onOpenChange={onOpenChange} title="Import / Export">
    <div className="grid gap-3 sm:grid-cols-2">
      <Button type="button" variant="outline" className="h-auto min-h-32 flex-col items-start justify-start gap-3 border-sidebar-border bg-sidebar-accent/35 p-4 text-left hover:bg-sidebar-accent/60" onClick={exportActiveRule}>
        <DownloadIcon className="size-5 text-muted-foreground" />
        <span>
          <span className="block text-sm font-medium">Export Active Rule</span>
          <span className="mt-1 block text-xs leading-5 text-muted-foreground">
            Download the current editor tab as a `.yaral` file.
          </span>
        </span>
      </Button>
      <Button asChild variant="outline" className="h-auto min-h-32 cursor-pointer flex-col items-start justify-start gap-3 border-sidebar-border bg-sidebar-accent/35 p-4 text-left hover:bg-sidebar-accent/60">
        <label>
          <ImportIcon className="size-5 text-muted-foreground" />
          <span>
            <span className="block text-sm font-medium">Import Rule File</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Open a `.yaral` or text file as a new unsaved tab.
            </span>
          </span>
          <input className="sr-only" type="file" accept=".yaral,.yara,.txt" onChange={(event) => void handleImport(event)} />
        </label>
      </Button>
    </div>
  </ToolDialog>)
}
function RuleEditorTutorialDialog({ isOpen, onOpenChange, }: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (<Dialog open={isOpen} onOpenChange={onOpenChange}>
    <DialogContent className="w-[min(58rem,calc(100vw-2rem))] p-0">
      <DialogHeader className="border-b px-4 py-3 pr-12">
        <DialogTitle className="flex items-center gap-2">
          <HelpCircleIcon className="size-4 text-primary" />
          RuleLab guide
        </DialogTitle>
        <DialogDescription>
          A compact guide to YARA-L writing, validation, local tests, and the checks experienced reviewers make before saving.
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="start" className="min-h-0 gap-0">
        <div className="border-b px-4 py-2">
          <ScrollArea className="w-full">
            <TabsList className="grid h-auto w-max grid-cols-4">
              <TabsTrigger value="start">First rule</TabsTrigger>
              <TabsTrigger value="sections">Rule sections</TabsTrigger>
              <TabsTrigger value="test-cases">Test cases</TabsTrigger>
              <TabsTrigger value="review">Review & save</TabsTrigger>
            </TabsList>
          </ScrollArea>
        </div>

        <ScrollArea className="h-[min(66vh,42rem)]">
          <div className="min-h-full p-4">
            <TabsContent value="start" className="mt-0 space-y-4">
              <Alert>
                <ListChecksIcon className="size-4" />
                <div>
                  <AlertTitle>Best first loop</AlertTitle>
                  <AlertDescription>
                    Start by changing one predicate in the starter rule, run a local test case, then read the inspector. Small edits make YARA-L much easier to learn.
                  </AlertDescription>
                </div>
              </Alert>

              <div className="grid gap-3 md:grid-cols-3">
                <TutorialCard title="1. Edit the rule" body="Use the centre editor for the source. Suggestions appear for UDM fields, helper functions, data tables, and known enum values." />
                <TutorialCard title="2. Watch diagnostics" body="The inspector summarises sections, variables, referenced UDM fields, helper calls, match windows, and warnings before you save." />
                <TutorialCard title="3. Test locally" body="Generate or edit test-case events in the output panel. Local tests are fast feedback; final validation still belongs in Google SecOps." />
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm leading-6">
                <p className="font-medium">Rule first or test case first?</p>
                <p className="text-muted-foreground">
                  Either works. If you are learning YARA-L, sketch a small rule first so the sections make sense, then create a positive test case immediately. If you already have real telemetry or a known detection scenario, start with the test case and shape the rule around the behaviour it must catch.
                </p>
              </div>

              <CodeBlock>
                <code>{`rule first_login_rule {
  meta:
    author = "you"

  events:
    $e.metadata.event_type = "USER_LOGIN"
    $e.principal.user.userid = /.+/

  condition:
    $e
}`}</code>
              </CodeBlock>
            </TabsContent>

            <TabsContent value="sections" className="mt-0 space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  ["meta", "Human context: author, description, references, severity notes, and other details reviewers need."],
                  ["events", "The facts that must be true on one or more events. Event variables start with `$`, like `$e` or `$login`."],
                  ["match", "Required for multi-event rules. It groups related events by placeholder variables over a time window, such as `$user over 10m`."],
                  ["outcome", "Computes values such as risk scores, counts, arrays, or labels that help someone understand the alert."],
                  ["condition", "Decides whether the rule fires. Simple rules often use `$e`; multi-event rules must cover every event variable or an associated placeholder."],
                  ["options", "Optional engine settings for specific rule behaviour."]
                ].map(([name, body]) => (<TutorialCard key={name} title={`${name}:`} body={body} />))}
              </div>

              <Separator />

              <div className="space-y-2 text-sm leading-6">
                <p>
                  UDM field paths hang off an event variable. In <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">$e.metadata.event_type</code>, <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">$e</code> is the event and <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">metadata.event_type</code> is the field path.
                </p>
                <p className="text-muted-foreground">
                  Placeholder variables are values you extract from events, such as <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">$user</code>. They are useful for joins, match keys, and readable outcomes.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm leading-6">
                  <p className="font-medium">Single-event rules</p>
                  <p className="text-muted-foreground">
                    A single-event rule usually defines one event variable, filters its fields, and uses that variable in <code className="font-mono text-xs">condition:</code>. It can use <code className="font-mono text-xs">match:</code> for grouped counts, but it does not need one just to fire on one event.
                  </p>
                </div>
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm leading-6">
                  <p className="font-medium">Multi-event rules</p>
                  <p className="text-muted-foreground">
                    A multi-event rule must include <code className="font-mono text-xs">match:</code>. Extract the shared value as a placeholder, group it with a time window, then make sure each event variable is covered by <code className="font-mono text-xs">condition:</code> or an associated placeholder.
                  </p>
                </div>
              </div>

              <CodeBlock>
                <code>{`rule login_then_resource_access {
  meta:
    author = "you"

  events:
    $login.metadata.event_type = "USER_LOGIN"
    $user = $login.principal.user.userid

    $access.metadata.event_type = "USER_RESOURCE_ACCESS"
    $user = $access.principal.user.userid

  match:
    $user over 10m

  condition:
    $login and $access
}`}</code>
              </CodeBlock>
            </TabsContent>

            <TabsContent value="test-cases" className="mt-0 space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <TutorialCard title="Test case editor" body="A test case is a named set of UDM JSON events plus optional expected results. Keep one positive case, one near miss, and one realistic noisy case." />
                <TutorialCard title="Generated events" body="RuleLab can derive a starting test event from simple predicates, then you can edit the values that matter to your detection." />
                <TutorialCard title="Data tables" body="Save lookup rows and reference them with `%table` or `%table.column` so membership checks can run locally." />
                <TutorialCard title="Run history" body="Use recent runs to compare changes. A good edit should explain why matches changed, not just whether they changed." />
                <TutorialCard title="Real scenarios" body="Build tests that look like real investigations: expected hits, near misses, benign noise, and repeated events that prove the rule is selective." />
                <TutorialCard title="Expected results" body="Save the match state you expect so later edits can show drift in matches, placeholders, outcomes, and warnings instead of relying on memory." />
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm leading-6">
                  <p className="font-medium">How to think about a test case</p>
                  <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                    <li>Name it after the behaviour you expect, such as <span className="font-medium text-foreground">PowerShell process launch</span>.</li>
                    <li>Add the smallest UDM event that should match the rule.</li>
                    <li>Run it and confirm the matched event, match keys, outcomes, and warnings all make sense.</li>
                    <li>Duplicate it into a near miss by changing one important field, such as the event type or command line.</li>
                    <li>Add harmless background events when you want to check that a noisy scenario does not create extra matches.</li>
                  </ol>
                </div>
                <CodeBlock className="h-full">
                  <code>{`{
  "metadata": {
    "event_type": "PROCESS_LAUNCH",
    "product_name": "Windows"
  },
  "principal": {
    "hostname": "WORKSTATION-1",
    "process": {
      "command_line": "powershell.exe -NoProfile"
    }
  }
}`}</code>
                </CodeBlock>
              </div>

              <Alert variant="warning">
                <ShieldCheckIcon className="size-4" />
                <div>
                  <AlertTitle>Local tests are a fast feedback loop</AlertTitle>
                  <AlertDescription>
                    They do not replace production SecOps validation. Treat unsupported or approximate helper warnings as review items before deployment.
                  </AlertDescription>
                </div>
              </Alert>
            </TabsContent>

            <TabsContent value="review" className="mt-0 space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <TutorialCard title="Reference highlights" body="Click variables to see where they are defined and reused. This is especially helpful in multi-event rules." />
                <TutorialCard title="Warnings as errors" body="Keep this on when you want saves to behave like a strict review gate. Turn it off while exploring rough ideas." />

                <TutorialCard title="Import and export" body="Move `.yaral` files in and out of RuleLab without coupling experiments to your saved library." />
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm leading-6">
                <p className="font-medium">Experienced reviewer checklist</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>Every event variable used in <code className="font-mono text-xs">condition:</code> is bounded in <code className="font-mono text-xs">events:</code>.</li>
                  <li>Multi-event rules include a meaningful <code className="font-mono text-xs">match:</code> key and time window.</li>
                  <li>Outcome values are useful to an analyst and not just restating the predicate.</li>
                  <li>Test cases cover the intended hit, a near miss, and a realistic noisy event.</li>
                </ul>
              </div>

              <Alert>
                <BookOpenIcon className="size-4" />
                <div>
                  <AlertTitle>Use the guide again any time</AlertTitle>
                  <AlertDescription>
                    This guide appears automatically once for a new account. After that, open it from the Help button in the editor header.
                  </AlertDescription>
                </div>
              </Alert>

              <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Official Google references</p>
                  <p className="text-sm leading-6 text-muted-foreground">
                    RuleLab is an authoring aid. Use Google SecOps documentation as the source of truth when a rule is ready for review.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {GOOGLE_SECOPS_DOC_LINKS.map((link) => (<Button key={link.href} asChild variant="outline" className="h-auto min-h-12 justify-start gap-2 whitespace-normal px-3 py-2 text-left">
                    <a href={link.href} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon className="mt-0.5 size-3.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-5">{link.label}</span>
                        <span className="block text-xs font-normal leading-5 text-muted-foreground">
                          {link.description}
                        </span>
                      </span>
                    </a>
                  </Button>))}
                </div>
              </div>
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>

      <DialogFooter className="mt-0 flex-row items-center justify-end border-t bg-popover px-4 py-3">
        <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>)
}
function TutorialCard({ body, title }: {
  body: string
  title: string
}) {
  return (<Card className="gap-3 rounded-lg py-4 shadow-none">
    <CardHeader className="px-4">
      <CardTitle className="text-sm">{title}</CardTitle>
    </CardHeader>
    <CardContent className="px-4 text-sm leading-6 text-muted-foreground">
      {body}
    </CardContent>
  </Card>)
}
function ToolDialog({ children, description, isOpen, onOpenChange, title, }: {
  children: ReactNode
  description: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  title: string
}) {
  const isMobile = useIsMobile()
  return (<DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80" />
      <DialogPrimitive.Content className={`fixed z-50 flex flex-col overflow-hidden border bg-sidebar text-sidebar-foreground shadow-xl outline-none ${isMobile
        ? "inset-0 rounded-none"
        : "left-1/2 top-1/2 max-h-[min(90vh,calc(100vh-2rem))] w-[min(64rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg"}`}>
        <div className="shrink-0 border-b border-sidebar-border px-4 py-3">
          <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </DialogPrimitive.Description>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-4">{children}</div>
        <div className="flex shrink-0 justify-end border-t border-sidebar-border px-4 py-3">
          <DialogPrimitive.Close asChild>
            <Button type="button" size="sm" className="h-8 text-xs">
              Done
            </Button>
          </DialogPrimitive.Close>
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>)
}
function parseJsonObject(rawJson: string): {
  error: string | null
  value: unknown
} {
  if (!rawJson.trim()) {
    return { error: null, value: null }
  }
  try {
    const value = JSON.parse(rawJson) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "Paste a single JSON object event.", value: null }
    }
    return { error: null, value }
  }
  catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not parse JSON.",
      value: null,
    }
  }
}
function flattenJson(value: unknown, prefix = ""): Array<{
  path: string
  value: string
}> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenJson(item, `${prefix}[${index}]`))
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => flattenJson(child, prefix ? `${prefix}.${key}` : key))
  }
  return [
    {
      path: prefix || "(root)",
      value: formatJsonScalar(value),
    }
  ]
}
function formatJsonScalar(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value)
}
function sanitizeFileName(name: string) {
  const sanitized = name.trim().replace(/[^a-z0-9_.-]+/gi, "_").replace(/^_+|_+$/g, "")
  return sanitized || UNTITLED_RULE_NAME
}
function getStudioNavigationState(value: unknown): StudioNavigationState | null {
  if (!value || typeof value !== "object") {
    return null
  }
  const state = value as Record<string, unknown>
  const studioPanel = isStudioPanel(state.studioPanel) ? state.studioPanel : undefined
  return studioPanel ? { studioPanel } : null
}
function isStudioPanel(value: unknown): value is NonNullable<StudioNavigationState["studioPanel"]> {
  return value === "dataTables" || value === "fixtureEditor" || value === "library" || value === "settings"
}
function createEmptyValidation(): YaralValidationResult {
  return {
    dataTableReferences: [],
    diagnostics: [],
    eventVariables: [],
    functionUses: [],
    isValid: false,
    match: null,
    outcomeVariables: [],
    placeholderVariables: [],
    referencedFields: [],
    ruleName: null,
    ruleType: "single_event",
    sections: [
      { name: "meta", present: false },
      { name: "events", present: false },
      { name: "match", present: false },
      { name: "outcome", present: false },
      { name: "condition", present: false },
      { name: "options", present: false }
    ],
    summary: {
      eventFilters: 0,
      matchWindow: null,
      matchWindowType: null,
    },
  }
}
function normalizeValidationDataTables(dataTables: DataTableSummary[]): YaralEvaluationDataTable[] {
  return dataTables
    .filter((table) => typeof table.name === "string" && table.name.trim().length > 0)
    .map((table) => ({
      name: table.name,
      rows: Array.isArray(table.rows) ? table.rows : [],
    }))
}
function normalizeDataTableCompletionItems(dataTables: DataTableSummary[]): YaralDataTableCompletionItem[] {
  return dataTables
    .filter((table) => typeof table.name === "string" && table.name.trim().length > 0)
    .map((table) => {
      const rows = Array.isArray(table.rows) ? table.rows : []
      return {
        columns: getDataTableCompletionColumns(rows),
        description: table.description,
        name: table.name,
        rowCount: rows.length,
      }
    })
}
function parseTagInput(value: string) {
  return [
    ...new Set(value
      .split(",")
      .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
      .filter(Boolean))
  ]
}
function getDataTableCompletionColumns(rows: unknown[]) {
  const columnSet = new Set<string>()
  for (const row of rows) {
    if (isPlainObject(row)) {
      for (const key of Object.keys(row)) {
        columnSet.add(key)
      }
    }
    else {
      columnSet.add("value")
    }
  }
  if (columnSet.size === 0) {
    columnSet.add("value")
  }
  return [...columnSet].sort((left, right) => {
    if (left === "value")
      return -1
    if (right === "value")
      return 1
    return left.localeCompare(right)
  })
}
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function mergeDataTableSummaries(baseTables: DataTableSummary[], overlayTables: DataTableSummary[]) {
  const byId = new Map(baseTables.map((table) => [table.id, table]))
  for (const table of overlayTables) {
    byId.set(table.id, table)
  }
  return [...byId.values()].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() ||
    left.name.localeCompare(right.name))
}
