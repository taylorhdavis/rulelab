import Editor, { DiffEditor } from "@monaco-editor/react"
import { RefreshCwIcon, AlertTriangleIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, DownloadIcon, FileCodeIcon, ImportIcon, RotateCcwIcon, SearchIcon, Trash2Icon, XIcon, } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { deleteRule, getSavedRules, getSavedRuleVersions, restoreSavedRuleVersion, saveRule, useQuery, } from "wasp/client/operations"
import { EditorPanelHeader } from "../../../components/editor-layout"
import { Alert, AlertDescription } from "../../../components/ui/alert"
import { Badge } from "../../../components/ui/badge"
import { Button } from "../../../components/ui/button"
import { ConfirmDialog } from "../../../components/ui/confirm-dialog"
import { EmptyState } from "../../../components/ui/empty-state"
import { Input } from "../../../components/ui/input"
import { LoadingIndicator, LoadingShimmer } from "../../../components/ui/loading-indicator"
import { ScrollArea } from "../../../components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "../../../components/ui/select"
import { getYaralRuleMetadata } from "../../../domain/yaral"
import { useIsMobile } from "../../../hooks/use-mobile"
import { getPublicErrorMessage } from "../../../lib/public-errors"
import { configureYaralLanguage } from "../monaco/yaral-language"
const CURRENT_VERSION_COMPARE_ID = "__rule-library-current__"
const PREVIEW_VERSION_COMPARE_ID = "__rule-library-preview__"
export type SavedRuleSummary = {
  createdAt: Date
  description: string | null
  folder?: string | null
  id: string
  name: string
  source: string
  tags?: string[]
  updatedAt: Date
}
export type SavedRuleVersionSummary = {
  createdAt: Date
  description: string | null
  folder: string | null
  id: string
  name: string
  savedRuleId: string
  source: string
  tags: string[]
}
type VersionComparisonEntry = {
  createdAt: Date
  description: string | null
  folder: string | null
  id: string
  source: string
  tags: string[]
}
type RuleLibraryPanelProps = {
  activeSavedRuleId: string | null
  currentRuleName?: string
  getCurrentRuleText?: () => string
  isOpen: boolean
  refreshToken: number
  onLoadRule: (rule: SavedRuleSummary) => void
  onOpenChange: (open: boolean) => void
}
type SaveRuleMetadataArgs = {
  description?: string | null
  folder?: string | null
  id?: string | null
  name: string
  source: string
  tags?: string[]
}
export function RuleLibraryPanel({ activeSavedRuleId, currentRuleName, getCurrentRuleText, isOpen, refreshToken, onLoadRule, onOpenChange, }: RuleLibraryPanelProps) {
  const isMobile = useIsMobile()
  const { data: rules = [], error, isFetching, isLoading, refetch, } = useQuery(getSavedRules, undefined, {
    enabled: isOpen,
    retry: 1,
    staleTime: 0,
  })
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null)
  const [isSlowLoad, setIsSlowLoad] = useState(false)
  const [pendingDeleteRule, setPendingDeleteRule] = useState<SavedRuleSummary | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [collapsedLocalFolders, setCollapsedLocalFolders] = useState<Set<string>>(() => new Set())
  const [selectedVersionCompareId, setSelectedVersionCompareId] = useState<string | null>(null)
  const [isVersionCompareOpen, setIsVersionCompareOpen] = useState(false)
  const [metadataFolder, setMetadataFolder] = useState("")
  const [metadataTags, setMetadataTags] = useState("")
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const savedRules = rules as SavedRuleSummary[]
  const filteredRules = useMemo(() => filterSavedRules(savedRules, searchQuery), [savedRules, searchQuery])
  const groupedLocalRules = useMemo(() => groupRulesByFolder(filteredRules), [filteredRules])
  const selectedRule = filteredRules.find((rule) => rule.id === selectedRuleId) ??
    filteredRules[0] ??
    null
  const { data: versions = [], refetch: refetchVersions, } = useQuery(getSavedRuleVersions, { ruleId: selectedRule?.id ?? null }, {
    enabled: isOpen && Boolean(selectedRule?.id),
    retry: 1,
    staleTime: 0,
  })
  const selectedRuleVersions = versions as SavedRuleVersionSummary[]
  const visibleSelectedRuleVersions = selectedRuleVersions
  const versionComparisonEntries = useMemo<VersionComparisonEntry[]>(() => selectedRule
    ? [
      {
        createdAt: selectedRule.updatedAt,
        description: selectedRule.description,
        folder: selectedRule.folder ?? null,
        id: CURRENT_VERSION_COMPARE_ID,
        source: selectedRule.source,
        tags: selectedRule.tags ?? [],
      },
      ...visibleSelectedRuleVersions
    ]
    : [], [selectedRule, visibleSelectedRuleVersions])
  const selectedBaseVersionCompare = versionComparisonEntries.find((entry) => entry.id === CURRENT_VERSION_COMPARE_ID) ?? null
  const selectedTargetVersionCompare = versionComparisonEntries.find((entry) => entry.id === selectedVersionCompareId) ?? null
  const selectedRuleMeta = useMemo(() => selectedRule ? getSavedRuleMeta(selectedRule.source) : null, [selectedRule])
  const selectedRuleLineCount = useMemo(() => selectedRule ? selectedRule.source.split(/\r?\n/).length : 0, [selectedRule])
  const selectedRuleTags = selectedRule?.tags?.length ? selectedRule.tags : selectedRuleMeta?.tags ?? []
  const hasRules = savedRules.length > 0
  const hasSearch = searchQuery.trim().length > 0
  const hasLocalFolderGroups = groupedLocalRules.length > 0
  useEffect(() => {
    if (isOpen) {
      setIsSlowLoad(false)
      if (activeSavedRuleId) {
        setSelectedRuleId(activeSavedRuleId)
      }
      void refetch()
    }
  }, [
    activeSavedRuleId,
    isOpen,
    refreshToken,
    refetch
  ])
  useEffect(() => {
    if (!isLoading || !isOpen) {
      setIsSlowLoad(false)
      return
    }
    const timeoutId = window.setTimeout(() => setIsSlowLoad(true), 2500)
    return () => window.clearTimeout(timeoutId)
  }, [isLoading, isOpen])
  useEffect(() => {
    if (selectedRuleId && !filteredRules.some((rule) => rule.id === selectedRuleId)) {
      setSelectedRuleId(null)
    }
  }, [filteredRules, selectedRuleId])
  useEffect(() => {
    setMetadataFolder(selectedRule?.folder ?? "")
    setMetadataTags((selectedRule?.tags ?? []).join(", "))
    setSelectedVersionCompareId(null)
    setIsVersionCompareOpen(false)
  }, [selectedRule?.id, selectedRule?.folder, selectedRule?.tags])
  useEffect(() => {
    if (!selectedRule) {
      return
    }
    const isValidTarget = !selectedVersionCompareId ||
      versionComparisonEntries.some((entry) => entry.id === selectedVersionCompareId)
    if (!isValidTarget) {
      setSelectedVersionCompareId(null)
    }
  }, [
    selectedVersionCompareId,
    selectedRule,
    versionComparisonEntries
  ])
  const handleSelectRule = useCallback((ruleId: string) => {
    setSelectedRuleId(ruleId)
  }, [])
  async function handleDeleteRule(rule: SavedRuleSummary) {
    await deleteRule({ id: rule.id })
    if (selectedRuleId === rule.id) {
      setSelectedRuleId(null)
    }
    await refetch()
    toast.success(`Deleted ${rule.name}.`)
  }
  async function handleDuplicateRule(rule: SavedRuleSummary) {
    try {
      const name = `${rule.name}_snapshot_${formatSnapshotDate(new Date())}`
      const saved = await saveRuleWithMetadata({
        description: rule.description,
        folder: rule.folder ?? null,
        name,
        source: rule.source,
        tags: rule.tags ?? [],
      })
      await refetch()
      await refetchVersions()
      setSelectedRuleId(saved.id)
      setLibraryError(null)
      toast.success(`Created snapshot ${saved.name}.`)
    }
    catch (error) {
      setLibraryError(getPublicErrorMessage(error, "Could not create rule snapshot."))
    }
  }
  async function handleSaveRuleMetadata(rule: SavedRuleSummary) {
    try {
      const saved = await saveRuleWithMetadata({
        description: rule.description,
        folder: metadataFolder,
        id: rule.id,
        name: rule.name,
        source: rule.source,
        tags: parseTagInput(metadataTags),
      })
      await refetch()
      await refetchVersions()
      setSelectedRuleId(saved.id)
      setLibraryError(null)
      toast.success(`Updated metadata for ${saved.name}.`)
    }
    catch (error) {
      setLibraryError(getPublicErrorMessage(error, "Could not update rule metadata."))
    }
  }
  async function handleRestoreRuleVersion(version: SavedRuleVersionSummary) {
    try {
      const restored = await restoreSavedRuleVersion({ versionId: version.id })
      await refetch()
      await refetchVersions()
      setSelectedRuleId(restored.id)
      setLibraryError(null)
      toast.success(`Restored ${restored.name} from ${formatDate(version.createdAt)}.`)
    }
    catch (error) {
      setLibraryError(getPublicErrorMessage(error, "Could not restore rule version."))
    }
  }
  function handleExportRule(rule: SavedRuleSummary) {
    downloadJson(`${toRuleFileName(rule.name)}.yaral-rule.json`, {
      exportedAt: new Date().toISOString(),
      rules: [toPortableRule(rule)],
      version: 1,
    })
    setLibraryError(null)
    toast.success(`Exported ${rule.name}.`)
  }
  function handleExportAllRules() {
    handleExportRules(savedRules, "yara-l-rule-library.json", "Exported")
  }
  function handleExportFilteredRules() {
    handleExportRules(filteredRules, "yara-l-rule-library-filtered.json", "Exported filtered")
  }
  function handleExportRules(rulesToExport: SavedRuleSummary[], fileName: string, messagePrefix: string) {
    downloadJson(fileName, {
      exportedAt: new Date().toISOString(),
      rules: rulesToExport.map(toPortableRule),
      version: 1,
    })
    setLibraryError(null)
    toast.success(`${messagePrefix} ${rulesToExport.length} saved rule${rulesToExport.length === 1 ? "" : "s"}.`)
  }
  function toggleLocalFolder(folder: string) {
    setCollapsedLocalFolders((current) => {
      const next = new Set(current)
      if (next.has(folder)) {
        next.delete(folder)
      }
      else {
        next.add(folder)
      }
      return next
    })
  }
  async function handleImportRules(file: File | null) {
    if (!file) {
      return
    }
    try {
      const portableRules = parseRuleImport(await file.text())
      const existingByName = new Map(savedRules.map((rule) => [rule.name, rule]))
      for (const rule of portableRules) {
        await saveRuleWithMetadata({
          description: rule.description,
          id: existingByName.get(rule.name)?.id ?? null,
          name: rule.name,
          source: rule.source,
          tags: rule.tags ?? [],
        })
      }
      await refetch()
      setLibraryError(null)
      toast.success(`Imported ${portableRules.length} rule${portableRules.length === 1 ? "" : "s"}.`)
    }
    catch (error) {
      setLibraryError(getPublicErrorMessage(error, "Could not import rules."))
    }
    finally {
      if (importInputRef.current) {
        importInputRef.current.value = ""
      }
    }
  }
  return (<>
    <DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/80" />
        <DialogPrimitive.Content className={`fixed z-50 flex min-h-0 flex-col overflow-hidden border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl outline-none ${isMobile ? "inset-0 rounded-none" : "inset-2 rounded-lg"}`}>
          <div className="relative shrink-0">
            <EditorPanelHeader className="h-auto min-h-14 items-start px-5 py-4 pr-14" title={<DialogPrimitive.Title asChild>
              <span className="font-heading text-base font-medium normal-case tracking-normal text-foreground">
                Rule Library
              </span>
            </DialogPrimitive.Title>} description={<DialogPrimitive.Description asChild>
              <span className="mt-0.5 block text-sm normal-case text-muted-foreground">
                Browse saved rules, folders, and version history.
              </span>
            </DialogPrimitive.Description>} actions={<>
              <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => {
                void handleImportRules(event.currentTarget.files?.[0] ?? null)
              }} />
              {hasSearch ? (<Badge variant="outline" className="font-mono text-[10px]">
                {filteredRules.length} shown
              </Badge>) : null}

              {(<>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {savedRules.length} saved
                </Badge>
                <Button type="button" variant="outline" size="icon-sm" title="Import rules" onClick={() => importInputRef.current?.click()}>
                  <ImportIcon />
                  <span className="sr-only">Import rules</span>
                </Button>
                <Button type="button" variant="outline" size="icon-sm" title="Export all rules" disabled={savedRules.length === 0} onClick={handleExportAllRules}>
                  <DownloadIcon />
                  <span className="sr-only">Export all rules</span>
                </Button>
              </>)}
              {hasSearch ? (<Button type="button" variant="outline" size="icon-sm" title="Export filtered rules" disabled={filteredRules.length === 0} onClick={handleExportFilteredRules}>
                <DownloadIcon />
                <span className="sr-only">Export filtered rules</span>
              </Button>) : null}

              <Button type="button" variant="outline" size="icon-sm" title="Refresh rules" disabled={isLoading || isFetching} onClick={() => void refetch()}>
                <RefreshCwIcon />
                <span className="sr-only">Refresh rules</span>
              </Button>
            </>} />
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon-sm" className="absolute right-4 top-4">
                <XIcon />
                <span className="sr-only">Close rule library</span>
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
            <div className="relative z-20 isolate flex max-h-72 min-h-0 min-w-0 flex-col border-b border-sidebar-border bg-sidebar [contain:layout_paint] lg:max-h-none lg:max-w-[24rem] lg:border-b-0 lg:border-r">
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
                <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <Input value={searchQuery} onChange={(event) => setSearchQuery(event.currentTarget.value)} className="h-8 min-w-0 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0" placeholder={"Search names, folders, tags"} />
                {hasSearch ? (<Button type="button" variant="ghost" size="icon-xs" title="Clear search" onClick={() => setSearchQuery("")}>
                  <XIcon />
                  <span className="sr-only">Clear search</span>
                </Button>) : null}
                {(isFetching) && !isLoading ? (<LoadingIndicator label="Refreshing" className="shrink-0 text-[11px]" markClassName="size-3" />) : null}
              </div>

              <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <div className="w-full min-w-0 max-w-full space-y-2 overflow-hidden p-3 pr-5">
                  {error ? (<Alert variant="destructive" className="text-xs">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    <AlertDescription>Internal server error.</AlertDescription>
                  </Alert>) : null}
                  {isSlowLoad && !error ? (<Alert variant="warning" className="text-xs">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    <AlertDescription>Still waiting for saved rules.</AlertDescription>
                  </Alert>) : null}
                  {libraryError ? (<Alert variant="destructive" className="text-xs">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    <AlertDescription>{libraryError}</AlertDescription>
                  </Alert>) : null}
                  {isLoading && !isSlowLoad ? (<div className="space-y-3 rounded-md border bg-sidebar-accent/35 p-3">
                    <LoadingIndicator label="Loading saved rules" className="text-xs" />
                    <div className="space-y-2">
                      <LoadingShimmer className="w-3/4" />
                      <LoadingShimmer className="w-1/2" />
                      <LoadingShimmer className="w-2/3" />
                    </div>
                  </div>) : null}
                  {!isLoading && !error && !hasRules ? (<EmptyState className="rounded-md border-sidebar-border bg-sidebar-accent/20 px-3 py-3" title="No saved rules yet." />) : null}
                  {!isLoading && !error && hasRules && filteredRules.length === 0 ? (<EmptyState className="rounded-md border-sidebar-border bg-sidebar-accent/20 px-3 py-3" title="No saved rules match the current search." />) : null}

                  {hasLocalFolderGroups ? (<div className="flex items-center justify-end gap-1">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setCollapsedLocalFolders(new Set())}>
                      Expand all
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setCollapsedLocalFolders(new Set(groupedLocalRules.map((group) => group.folder)))}>
                      Collapse all
                    </Button>
                  </div>) : null}
                  {groupedLocalRules.map((group) => (<section key={group.folder} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Button type="button" variant="ghost" size="sm" className="h-7 min-w-0 flex-1 justify-start gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-normal text-muted-foreground hover:text-foreground" aria-expanded={!collapsedLocalFolders.has(group.folder)} onClick={() => toggleLocalFolder(group.folder)} title={group.folder}>
                        <span className="min-w-0 truncate">{group.folder}</span>
                        {collapsedLocalFolders.has(group.folder) ? (<ChevronRightIcon className="ml-auto size-3.5 shrink-0" />) : (<ChevronDownIcon className="ml-auto size-3.5 shrink-0" />)}
                      </Button>
                      <Badge variant="outline" className="h-5 font-mono text-[10px]">
                        {group.rules.length}
                      </Badge>
                    </div>
                    {collapsedLocalFolders.has(group.folder) ? null : group.rules.map((rule) => (<Button key={rule.id} type="button" variant="outline" aria-current={selectedRule?.id === rule.id ? "true" : undefined} className={`box-border h-auto min-w-0 w-full max-w-full justify-start gap-2 overflow-hidden px-3 py-2 text-left hover:bg-sidebar-accent ${selectedRule?.id === rule.id
                      ? "border-primary/50 bg-sidebar-accent shadow-sm"
                      : "border-sidebar-border bg-sidebar-accent/35"}`} onClick={() => handleSelectRule(rule.id)} title={rule.name} onPointerDown={(event) => {
                        if (event.button === 0) {
                          handleSelectRule(rule.id)
                        }
                      }}>
                      <FileCodeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="grid w-0 min-w-0 flex-1 gap-0.5">
                        <span className="min-w-0 truncate text-sm font-medium" title={rule.name}>{rule.name}</span>
                        {rule.tags?.length ? (<span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={rule.tags.map((tag) => `#${tag}`).join(" · ")}>
                          {rule.tags.map((tag) => `#${tag}`).join(" · ")}
                        </span>) : null}
                      </span>
                    </Button>))}
                  </section>))}
                </div>
              </ScrollArea>
            </div>

            <div className="relative z-0 flex min-h-0 min-w-0 flex-col overflow-hidden">
              {selectedRule ? (<>
                <div className="flex min-w-0 items-start justify-between gap-4 border-b border-sidebar-border bg-sidebar p-5">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileCodeIcon className="size-4 shrink-0 text-muted-foreground" />
                      <h3 className="truncate text-lg font-semibold" title={selectedRule.name}>{selectedRule.name}</h3>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Updated {formatDate(selectedRule.updatedAt)}
                    </p>
                    {selectedRule.description ? (<p className="mt-2 max-w-3xl break-words text-sm text-foreground/75">
                      {selectedRule.description}
                    </p>) : null}
                    <div className="mt-3 flex min-w-0 flex-wrap gap-2 text-[11px] text-muted-foreground">
                      {selectedRuleMeta?.severity ? (<Badge variant="outline" className="font-mono text-[10px]">
                        {selectedRuleMeta.severity}
                      </Badge>) : null}
                      {selectedRule.folder ? (<Badge variant="outline" className="font-mono text-[10px]">
                        <span className="max-w-[14rem] truncate" title={selectedRule.folder}>{selectedRule.folder}</span>
                      </Badge>) : null}
                      {selectedRuleTags.map((tag) => (<Badge key={tag} variant="outline" className="max-w-[12rem] truncate font-mono text-[10px]" title={`#${tag}`}>
                        #{tag}
                      </Badge>))}
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {selectedRuleLineCount} lines
                      </Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button type="button" size="sm" className="h-8 text-xs" onClick={() => {
                      onLoadRule(selectedRule)
                      onOpenChange(false)
                    }}>
                      Open in Tab
                    </Button>
                    <Button type="button" variant="outline" size="icon-sm" title="Create snapshot" onClick={() => void handleDuplicateRule(selectedRule)}>
                      <CopyIcon />
                      <span className="sr-only">Create snapshot</span>
                    </Button>
                    <Button type="button" variant="outline" size="icon-sm" title="Export rule" onClick={() => handleExportRule(selectedRule)}>
                      <DownloadIcon />
                      <span className="sr-only">Export rule</span>
                    </Button>
                    <Button type="button" variant="destructive" size="icon-sm" title="Delete rule" onClick={() => setPendingDeleteRule(selectedRule)}>
                      <Trash2Icon />
                      <span className="sr-only">Delete rule</span>
                    </Button>
                  </div>
                </div>
                <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-2 border-b border-sidebar-border bg-sidebar-accent/20 p-2">
                  <div className="flex min-h-0 flex-wrap items-end gap-1.5">
                    <label className="grid min-w-28 flex-[0_1_9rem] gap-1 text-[11px] text-muted-foreground" htmlFor="rule-library-folder">
                      Folder
                      <Input id="rule-library-folder" aria-label="Folder" value={metadataFolder} onChange={(event) => setMetadataFolder(event.currentTarget.value)} className="h-7 w-full min-w-0 text-xs" placeholder="Optional folder" />
                    </label>
                    <label className="grid min-w-36 flex-[1_1_12rem] gap-1 text-[11px] text-muted-foreground" htmlFor="rule-library-tags">
                      Tags
                      <Input id="rule-library-tags" aria-label="Tags" value={metadataTags} onChange={(event) => setMetadataTags(event.currentTarget.value)} className="h-7 w-full min-w-0 font-mono text-xs" placeholder="tag_one, tag_two" />
                    </label>
                    <Button type="button" variant="outline" size="sm" className="h-7 min-h-7 text-xs" onClick={() => void handleSaveRuleMetadata(selectedRule)}>
                      Save
                    </Button>
                    <Button type="button" variant={isVersionCompareOpen ? "secondary" : "outline"} size="sm" className="h-7 min-h-7 text-xs" disabled={versionComparisonEntries.length <= 1} onClick={() => {
                      setIsVersionCompareOpen((current) => {
                        const next = !current
                        if (!next) {
                          setSelectedVersionCompareId(null)
                        }
                        else if (!selectedVersionCompareId) {
                          setSelectedVersionCompareId(visibleSelectedRuleVersions[0]?.id ?? null)
                        }
                        return next
                      })
                    }}>
                      Compare versions
                    </Button>
                    {isVersionCompareOpen ? (<label className="grid min-w-40 flex-[0_1_13rem] gap-1 text-[11px] text-muted-foreground" htmlFor="rule-history-target-compare">
                      Version
                      <Select value={selectedVersionCompareId ?? PREVIEW_VERSION_COMPARE_ID} onValueChange={(value) => setSelectedVersionCompareId(value === PREVIEW_VERSION_COMPARE_ID ? null : value)}>
                        <SelectTrigger id="rule-history-target-compare" className="h-7 w-full min-w-0 text-xs">
                          <SelectValue placeholder="Preview" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={PREVIEW_VERSION_COMPARE_ID}>
                            Preview
                          </SelectItem>
                          {visibleSelectedRuleVersions.map((entry) => (<SelectItem key={`target-${entry.id}`} value={entry.id}>
                            {formatVersionComparisonLabel(entry)}
                          </SelectItem>))}
                        </SelectContent>
                      </Select>
                    </label>) : null}
                    {isVersionCompareOpen ? (<Button type="button" variant="outline" size="icon-sm" className="mb-0" title="Restore selected version" disabled={!selectedVersionCompareId} onClick={() => {
                      const versionToRestore = visibleSelectedRuleVersions.find((version) => version.id === selectedVersionCompareId)
                      if (versionToRestore) {
                        void handleRestoreRuleVersion(versionToRestore)
                      }
                    }}>
                      <RotateCcwIcon />
                      <span className="sr-only">Restore</span>
                    </Button>) : null}
                  </div>
                  <div className="min-h-0 h-full overflow-hidden">
                    <div className="h-full min-h-0 bg-background">
                      {isVersionCompareOpen && selectedBaseVersionCompare && selectedTargetVersionCompare ? (<DiffEditor beforeMount={configureYaralLanguage} height="100%" language="yaral" modified={selectedTargetVersionCompare.source} original={selectedBaseVersionCompare.source} theme="yaral-dark" options={{
                        automaticLayout: true,
                        contextmenu: false,
                        diffCodeLens: false,
                        domReadOnly: true,
                        folding: false,
                        glyphMargin: false,
                        lineDecorationsWidth: 16,
                        lineNumbers: "on",
                        lineNumbersMinChars: 3,
                        minimap: { enabled: false },
                        originalEditable: false,
                        overviewRulerLanes: 0,
                        readOnly: true,
                        renderLineHighlight: "none",
                        renderSideBySide: true,
                        scrollBeyondLastLine: false,
                        scrollbar: {
                          horizontalScrollbarSize: 10,
                          verticalScrollbarSize: 10,
                          useShadows: false,
                        },
                        wordWrap: "off",
                      }} />) : (<Editor beforeMount={configureYaralLanguage} height="100%" language="yaral" theme="yaral-dark" value={selectedRule.source} options={{
                        automaticLayout: true,
                        contextmenu: false,
                        domReadOnly: true,
                        folding: false,
                        glyphMargin: false,
                        lineDecorationsWidth: 16,
                        lineNumbers: "on",
                        lineNumbersMinChars: 3,
                        minimap: { enabled: false },
                        overviewRulerLanes: 0,
                        readOnly: true,
                        renderLineHighlight: "none",
                        scrollBeyondLastLine: false,
                        scrollbar: {
                          horizontalScrollbarSize: 10,
                          verticalScrollbarSize: 10,
                          useShadows: false,
                        },
                        wordWrap: "off",
                      }} />)}
                    </div>
                  </div>
                </div>
              </>) :
                (<div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">
                      {hasRules
                        ? hasSearch
                          ? "No matching rule selected"
                          : "Select a saved rule"
                        : "No saved rules yet"}
                    </p>
                    <p className="text-xs">
                      {hasRules
                        ? hasSearch
                          ? "Adjust the search or pick another saved rule."
                          : "Pick a rule from the list to preview it here."
                        : "Save a rule from the editor and it will appear here."}
                    </p>
                  </div>
                </div>)}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
    <ConfirmDialog confirmLabel="Delete Rule" description={`Delete "${pendingDeleteRule?.name ?? "this rule"}" from the library? This cannot be undone.`} isDestructive isOpen={Boolean(pendingDeleteRule)} title="Delete saved rule?" onConfirm={() => {
      if (pendingDeleteRule) {
        void handleDeleteRule(pendingDeleteRule)
      }
    }} onOpenChange={(open) => {
      if (!open) {
        setPendingDeleteRule(null)
      }
    }} />



  </>)
}
function formatDate(value: Date | string) {
  return new Date(value).toLocaleString()
}
function saveRuleWithMetadata(args: SaveRuleMetadataArgs) {
  return saveRule(args as Parameters<typeof saveRule>[0]) as Promise<SavedRuleSummary>
}
function formatVersionComparisonLabel(entry: VersionComparisonEntry) {
  const label = entry.id === CURRENT_VERSION_COMPARE_ID ? "Current" : "Snapshot"
  return `${label} · ${formatDate(entry.createdAt)}`
}
function formatSnapshotDate(value: Date) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}
function filterSavedRules(rules: SavedRuleSummary[], query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    return rules
  }
  return rules.filter((rule) => {
    const meta = getSavedRuleMeta(rule.source)
    const haystack = [
      rule.name,
      rule.description ?? "",
      rule.folder ?? "",
      (rule.tags ?? []).join(" "),
      rule.source,
      meta.author ?? "",
      meta.severity ?? "",
      meta.tags.join(" ")
    ].join(" ").toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
function groupRulesByFolder(rules: SavedRuleSummary[]) {
  const groups = new Map<string, SavedRuleSummary[]>()
  for (const rule of rules) {
    const folder = rule.folder?.trim() || "Default"
    groups.set(folder, [...(groups.get(folder) ?? []), rule])
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
    .map(([folder, groupedRules]) => ({
      folder,
      rules: groupedRules,
    }))
}
function getSavedRuleMeta(source: string) {
  return getYaralRuleMetadata(source)
}
export type PortableRule = {
  description: string | null
  folder?: string | null
  name: string
  source: string
  tags?: string[]
}
const RULE_IMPORT_LIMITS = {
  maxFileChars: 5000000,
  maxRules: 500,
  maxRuleSourceChars: 250000,
} as const
function toPortableRule(rule: SavedRuleSummary): PortableRule {
  return {
    description: rule.description,
    folder: rule.folder ?? null,
    name: rule.name,
    source: rule.source,
    tags: rule.tags ?? [],
  }
}
export function parseRuleImport(text: string): PortableRule[] {
  if (text.length > RULE_IMPORT_LIMITS.maxFileChars) {
    throw new Error(`Rule import files must be ${RULE_IMPORT_LIMITS.maxFileChars.toLocaleString()} characters or fewer.`)
  }
  const parsed = JSON.parse(text)
  const candidates = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.rules)
      ? parsed.rules
      : null
  if (!candidates) {
    throw new Error("Rule import must be a JSON array or an object with a rules array.")
  }
  if (candidates.length > RULE_IMPORT_LIMITS.maxRules) {
    throw new Error(`Rule imports can contain at most ${RULE_IMPORT_LIMITS.maxRules.toLocaleString()} rules.`)
  }
  const rules = candidates.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`Imported rule ${index + 1} must be a JSON object.`)
    }
    if (typeof candidate.name !== "string" || !candidate.name.trim()) {
      throw new Error(`Imported rule ${index + 1} is missing a name.`)
    }
    if (typeof candidate.source !== "string" || !candidate.source.trim()) {
      throw new Error(`Imported rule ${index + 1} is missing source text.`)
    }
    if (candidate.source.length > RULE_IMPORT_LIMITS.maxRuleSourceChars) {
      throw new Error(`Imported rule ${index + 1} source must be ${RULE_IMPORT_LIMITS.maxRuleSourceChars.toLocaleString()} characters or fewer.`)
    }
    return {
      description: typeof candidate.description === "string" && candidate.description.trim()
        ? candidate.description.trim()
        : null,
      folder: typeof candidate.folder === "string" && candidate.folder.trim()
        ? candidate.folder.trim()
        : null,
      name: candidate.name.trim(),
      source: candidate.source,
      tags: normalizePortableTags(candidate.tags),
    }
  })
  if (rules.length === 0) {
    throw new Error("Rule import did not contain any rules.")
  }
  const seenNames = new Set<string>()
  for (const rule of rules) {
    if (seenNames.has(rule.name)) {
      throw new Error(`Imported rule "${rule.name}" appears more than once.`)
    }
    seenNames.add(rule.name)
  }
  return rules
}
function parseTagInput(value: string) {
  return [
    ...new Set(value
      .split(/[,;\s]+/)
      .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
      .filter(Boolean))
  ]
}
function normalizePortableTags(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }
  return [
    ...new Set(value
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
      .filter(Boolean))
  ]
}
function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
function toRuleFileName(name: string) {
  const fileName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return fileName || "saved-rule"
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
