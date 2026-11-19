import {
  CopyIcon,
  DatabaseIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { deleteDataTable, saveDataTable } from "wasp/client/operations"

import { useIsMobile } from "../../../hooks/use-mobile"
import { getPublicErrorMessage } from "../../../lib/public-errors"
import { validateDataTableRows } from "../../../domain/yaral/testing/input-validation"
import { Badge } from "../../../components/ui/badge"
import { Button } from "../../../components/ui/button"
import { ConfirmDialog } from "../../../components/ui/confirm-dialog"
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "../../../components/ui/dialog"
import { EditorPanelHeader } from "../../../components/editor-layout"
import { EmptyState } from "../../../components/ui/empty-state"
import { Input } from "../../../components/ui/input"
import { LoadingIndicator } from "../../../components/ui/loading-indicator"
import { ScrollArea } from "../../../components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table"

const DEFAULT_COLUMNS = ["value"]
const DEFAULT_ROWS = [
  { value: "powershell.exe" },
  { value: "cmd.exe" },
]
const DEFAULT_DATA_TABLE_NAME = "data_table"
const DATA_TABLE_SAVE_TIMEOUT_MS = 15000
const DATA_TABLE_COLUMN_NAME_MAX_LENGTH = 64
const DATA_TABLE_DESCRIPTION_MAX_LENGTH = 2_000
const DATA_TABLE_MAX_CELL_LENGTH = 4_096
const DATA_TABLE_MAX_COLUMNS = 10
const DATA_TABLE_MAX_ROWS = 50
const DATA_TABLE_NAME_MAX_LENGTH = 128

export type DataTableSummary = {
  createdAt: Date
  description: string | null
  id: string
  name: string
  rows: unknown
  updatedAt: Date
}

type DataTablesPanelProps = {
  dataTables: DataTableSummary[]
  error?: Error | null
  isOpen: boolean
  onDataTableDeleted?: (id: string) => void
  onDataTableSaved?: (table: DataTableSummary) => void
  onInsertReference?: (reference: string) => void
  onOpenChange: (open: boolean) => void
  onRefreshDataTables: () => Promise<unknown>
}

type DataTableGridRow = Record<string, string>

type DataTableColumnSummary = {
  coverage: number
  name: string
  types: string[]
}

export function DataTablesPanel({
  dataTables: dbDataTables,
  error,
  isOpen,
  onDataTableDeleted,
  onDataTableSaved,
  onInsertReference,
  onOpenChange,
  onRefreshDataTables,
}: DataTablesPanelProps) {
  const [localDataTables, setLocalDataTables] = useState<DataTableSummary[]>([])
  const dataTables = useMemo(
    () => mergeDataTables(dbDataTables, localDataTables),
    [dbDataTables, localDataTables]
  )
  const [selectedDataTableId, setSelectedDataTableId] = useState("new")
  const [dataTableName, setDataTableName] = useState(DEFAULT_DATA_TABLE_NAME)
  const [hasEditedDataTableName, setHasEditedDataTableName] = useState(false)
  const [dataTableDescription, setDataTableDescription] = useState("")
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS)
  const [rows, setRows] = useState<DataTableGridRow[]>(DEFAULT_ROWS)
  const [isSavingDataTable, setIsSavingDataTable] = useState(false)
  const [isManuallyRefreshingDataTables, setIsManuallyRefreshingDataTables] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [rowFilter, setRowFilter] = useState("")
  const [pendingDeleteTable, setPendingDeleteTable] = useState<DataTableSummary | null>(null)
  const isMobile = useIsMobile()
  const selectedTable = dataTables.find((table) => table.id === selectedDataTableId)
  const filteredTables = useMemo(
    () => filterDataTables(dataTables, searchQuery),
    [dataTables, searchQuery]
  )
  const visibleRows = useMemo(() => {
    const query = rowFilter.trim().toLowerCase()
    return rows
      .map((row, index) => ({ index, row }))
      .filter(({ row }) =>
        !query || columns.some((column) => row[column]?.toLowerCase().includes(query))
      )
  }, [columns, rowFilter, rows])
  const savedRows = useMemo(() => toSavedRows(columns, rows), [columns, rows])
  const columnSummaries = useMemo(
    () => summarizeDataTableColumns(columns, rows),
    [columns, rows]
  )
  const references = useMemo(
    () => getDataTableReferences(dataTableName || selectedTable?.name || "table_name", columns),
    [columns, dataTableName, selectedTable?.name]
  )
  const externalErrorMessage = error ? getPublicErrorMessage(error) : null

  useEffect(() => {
    if (selectedDataTableId !== "new" && !dataTables.some((table) => table.id === selectedDataTableId)) {
      handleLoadDataTable("new")
    }
  }, [dataTables, selectedDataTableId])

  useEffect(() => {
    if (
      selectedDataTableId === "new" &&
      !hasEditedDataTableName &&
      dataTables.some((table) => table.name === dataTableName)
    ) {
      setDataTableName(createUniqueTableName(dataTables))
    }
  }, [dataTableName, dataTables, hasEditedDataTableName, selectedDataTableId])

  useEffect(() => {
    if (isOpen && externalErrorMessage) {
      showDataTableError(externalErrorMessage)
    }
  }, [externalErrorMessage, isOpen])

  function showDataTableError(message: string) {
    toast.error(message)
  }

  function clearDataTableError() {
    // Errors are shown as toasts, so there is no persistent inline error state to clear.
  }

  function handleLoadDataTable(id: string) {
    setSelectedDataTableId(id)
    clearDataTableError()
    setRowFilter("")
    if (id === "new") {
      setDataTableName(createUniqueTableName(dataTables))
      setHasEditedDataTableName(false)
      setDataTableDescription("")
      setColumns(DEFAULT_COLUMNS)
      setRows(DEFAULT_ROWS)
      return
    }

    const table = dataTables.find((item) => item.id === id)
    if (!table) {
      return
    }
    const grid = toGridModel(table.rows)
    setDataTableName(table.name)
    setHasEditedDataTableName(false)
    setDataTableDescription(table.description ?? "")
    setColumns(grid.columns)
    setRows(grid.rows)
  }

  async function handleSaveDataTable() {
    const validationError = validateGrid(columns, rows)
    if (validationError) {
      showDataTableError(validationError)
      return
    }
    const normalizedDataTableName = dataTableName.trim()
    if (
      selectedDataTableId === "new" &&
      dataTables.some((table) => table.name === normalizedDataTableName)
    ) {
      showDataTableError(`A data table named "${normalizedDataTableName}" already exists.`)
      return
    }

    setIsSavingDataTable(true)
    try {
      const savedName = selectedTable?.name ?? normalizedDataTableName
      const saved = await withTimeout(
        saveDataTable({
          description: dataTableDescription,
          id: selectedDataTableId === "new" ? null : selectedDataTableId,
          name: savedName,
          rows: savedRows,
        }),
        DATA_TABLE_SAVE_TIMEOUT_MS,
        "Internal server error."
      )
      const grid = toGridModel(saved.rows)
      setLocalDataTables((current) =>
        mergeDataTables(current, [saved as DataTableSummary])
      )
      setSelectedDataTableId(saved.id)
      setDataTableName(saved.name)
      setDataTableDescription(saved.description ?? "")
      setColumns(grid.columns)
      setRows(grid.rows)
      clearDataTableError()
      toast.success(`Saved ${saved.name}.`)
      onDataTableSaved?.(saved as DataTableSummary)
    } catch (saveError) {
      showDataTableError(getPublicErrorMessage(saveError, "Could not save data table."))
    } finally {
      setIsSavingDataTable(false)
    }
  }

  async function handleDeleteDataTable(table: DataTableSummary) {
    try {
      await deleteDataTable({ id: table.id })
      setLocalDataTables((current) => current.filter((item) => item.id !== table.id))
      onDataTableDeleted?.(table.id)
      handleLoadDataTable("new")
      setPendingDeleteTable(null)
      clearDataTableError()
      toast.success(`Deleted ${table.name}.`)
    } catch (deleteError) {
      showDataTableError(getPublicErrorMessage(deleteError, "Could not delete data table."))
    }
  }

  function handleReference(reference: string) {
    onInsertReference?.(reference)
    void navigator.clipboard?.writeText(reference).catch(() => undefined)
    toast.success(`Inserted ${formatDataTableReferenceForDisplay(reference)}.`)
    clearDataTableError()
  }

  async function handleRefreshDataTables() {
    setIsManuallyRefreshingDataTables(true)
    try {
      await onRefreshDataTables()
      clearDataTableError()
    } catch (refreshError) {
      showDataTableError(getPublicErrorMessage(refreshError, "Could not refresh data tables."))
    } finally {
      setIsManuallyRefreshingDataTables(false)
    }
  }

  function handleAddColumn() {
    if (columns.length >= DATA_TABLE_MAX_COLUMNS) {
      showDataTableError(`Data tables can contain at most ${DATA_TABLE_MAX_COLUMNS.toLocaleString()} columns.`)
      return
    }
    const nextColumn = createUniqueColumnName(columns)
    setColumns((current) => [...current, nextColumn])
    setRows((current) => current.map((row) => ({ ...row, [nextColumn]: "" })))
    clearDataTableError()
  }

  function handleRenameColumn(index: number, nextName: string) {
    const previousName = columns[index]
    setColumns((current) =>
      current.map((column, columnIndex) => (columnIndex === index ? nextName : column))
    )
    setRows((currentRows) =>
      currentRows.map((row) => {
        const nextRow = { ...row }
        delete nextRow[previousName]
        nextRow[nextName] = row[previousName] ?? ""
        return nextRow
      })
    )
    clearDataTableError()
  }

  function handleDeleteColumn(index: number) {
    if (columns.length <= 1) {
      showDataTableError("Data tables must have at least one column.")
      return
    }
    const columnName = columns[index]
    setColumns((current) => current.filter((_column, columnIndex) => columnIndex !== index))
    setRows((currentRows) =>
      currentRows.map((row) => {
        const nextRow = { ...row }
        if (columnName) {
          delete nextRow[columnName]
        }
        return nextRow
      })
    )
    clearDataTableError()
  }

  function handleAddRow() {
    if (rows.length >= DATA_TABLE_MAX_ROWS) {
      showDataTableError(`Data tables can contain at most ${DATA_TABLE_MAX_ROWS.toLocaleString()} rows.`)
      return
    }
    setRows((current) => [...current, createEmptyRow(columns)])
    clearDataTableError()
  }

  function handleDeleteRow(index: number) {
    setRows((current) => current.filter((_row, rowIndex) => rowIndex !== index))
    clearDataTableError()
  }

  function handleUpdateCell(rowIndex: number, columnName: string, value: string) {
    setRows((current) =>
      current.map((row, index) =>
        index === rowIndex ? { ...row, [columnName]: value } : row
      )
    )
    clearDataTableError()
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogPortal>
          <DialogOverlay className="bg-black/20" />
          <DialogPrimitive.Content
            className={`fixed z-50 flex min-h-0 flex-col overflow-hidden border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl outline-none ${
              isMobile ? "inset-0 rounded-none" : "inset-2 rounded-lg"
            }`}
          >
            <div className="relative shrink-0">
              <EditorPanelHeader
                className="h-auto min-h-14 items-start px-5 py-4 pr-14"
                title={
                  <DialogTitle asChild>
                    <span className="font-heading text-base font-medium normal-case tracking-normal text-foreground">
                      Data Tables
                    </span>
                  </DialogTitle>
                }
                description={
                  <DialogDescription asChild>
                    <span className="mt-0.5 block text-sm normal-case text-muted-foreground">
                      Multicolumn reference tables for YARA-L table and table.column lookups.
                    </span>
                  </DialogDescription>
                }
                actions={
                  <>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {dataTables.length} saved
                  </Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    title="Refresh data tables"
                    disabled={isManuallyRefreshingDataTables}
                    onClick={() => void handleRefreshDataTables()}
                  >
                    {isManuallyRefreshingDataTables ? (
                      <LoadingIndicator markClassName="size-4" />
                    ) : (
                      <RefreshCwIcon />
                    )}
                    <span className="sr-only">Refresh data tables</span>
                  </Button>
                  </>
                }
              />
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-4 top-4"
                >
                  <XIcon />
                  <span className="sr-only">Close data tables</span>
                </Button>
              </DialogClose>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
              <div className="relative z-20 isolate flex max-h-72 min-h-0 min-w-0 flex-col overflow-hidden border-b border-sidebar-border bg-sidebar [contain:layout_paint] lg:max-h-none lg:max-w-[24rem] lg:border-b-0 lg:border-r">
                <div className="relative flex h-11 shrink-0 items-center border-b border-sidebar-border px-3">
                  <SearchIcon className="pointer-events-none absolute left-5 size-3.5 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.currentTarget.value)}
                    className="h-8 min-w-0 border-sidebar-border bg-sidebar-accent/30 pl-8 pr-8 text-sm shadow-none"
                    placeholder="Search data tables"
                  />
                  {searchQuery ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="absolute right-4"
                      title="Clear search"
                      onClick={() => setSearchQuery("")}
                    >
                      <XIcon />
                      <span className="sr-only">Clear search</span>
                    </Button>
                  ) : null}
                </div>
                <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden">
                  <div className="w-full min-w-0 max-w-full space-y-2 overflow-hidden p-3 pr-5">
                    <Button
                      type="button"
                      variant="outline"
                      className={`box-border h-auto min-w-0 w-full max-w-full justify-start gap-2 overflow-hidden px-3 py-2 text-left ${
                        selectedDataTableId === "new"
                          ? "border-primary/50 bg-sidebar-accent shadow-sm"
                          : "border-sidebar-border bg-sidebar-accent/35 hover:bg-sidebar-accent"
                      }`}
                      onClick={() => handleLoadDataTable("new")}
                    >
                      <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="grid w-0 min-w-0 flex-1 gap-0.5">
                        <span className="min-w-0 truncate text-sm font-medium">New data table</span>
                        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                          {DEFAULT_COLUMNS.length} column starter
                        </span>
                      </span>
                    </Button>
                    {filteredTables.map((table) => {
                      const grid = toGridModel(table.rows)
                      return (
                        <Button
                          key={table.id}
                          type="button"
                          variant="outline"
                          className={`box-border h-auto min-w-0 w-full max-w-full justify-start gap-2 overflow-hidden px-3 py-2 text-left ${
                            selectedDataTableId === table.id
                              ? "border-primary/50 bg-sidebar-accent shadow-sm"
                              : "border-sidebar-border bg-sidebar-accent/35 hover:bg-sidebar-accent"
                          }`}
                          onClick={() => handleLoadDataTable(table.id)}
                        >
                          <DatabaseIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="grid w-0 min-w-0 flex-1 gap-0.5">
                            <span className="min-w-0 truncate font-mono text-sm font-medium">{table.name}</span>
                            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                              {grid.rows.length} rows · {grid.columns.length} columns
                              {table.description ? ` · ${table.description}` : ""}
                            </span>
                          </span>
                        </Button>
                      )
                    })}
                    {filteredTables.length === 0 ? (
                      <EmptyState
                        className="rounded-md border-sidebar-border bg-sidebar-accent/20 px-3 py-3"
                        title={searchQuery.trim() ? "No saved tables match this search." : "No saved data tables yet."}
                      />
                    ) : null}
                  </div>
                </ScrollArea>
              </div>

              <div className="relative z-0 grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
                  <div className="grid shrink-0 gap-3 border-b border-sidebar-border bg-sidebar p-5">
                    <div className="flex min-w-0 items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" />
                          <h3 className="truncate text-lg font-semibold">
                            {dataTableName || "Data table"}
                          </h3>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {selectedTable
                            ? "Name locked after creation so table references keep working."
                            : "Create a reusable reference table for YARA-L lookups."}
                        </p>
                        <div className="mt-3 flex min-w-0 flex-wrap gap-2 text-[11px] text-muted-foreground">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {rows.length} rows
                          </Badge>
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {columns.length} columns
                          </Badge>
                          {selectedTable ? (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              saved
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="font-mono text-[10px]">
                              draft
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => void handleSaveDataTable()}
                          disabled={isSavingDataTable}
                        >
                          {isSavingDataTable ? (
                            <LoadingIndicator label="Saving" className="text-current" markClassName="size-4 border-current/40 bg-current/10 text-current" />
                          ) : (
                            <>
                              <SaveIcon />
                              Save
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          title="Delete data table"
                          disabled={!selectedTable}
                          onClick={() => selectedTable && setPendingDeleteTable(selectedTable)}
                        >
                          <Trash2Icon />
                          <span className="sr-only">Delete data table</span>
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/20 p-3 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:items-start">
                      <div className="grid gap-1">
                        <Input
                          value={dataTableName}
                          readOnly={Boolean(selectedTable)}
                          onChange={(event) => {
                            if (!selectedTable) {
                              setHasEditedDataTableName(true)
                              setDataTableName(event.currentTarget.value)
                            }
                          }}
                          className="h-8 w-full min-w-0 bg-sidebar font-mono text-xs read-only:bg-sidebar-accent/30 read-only:text-muted-foreground"
                          maxLength={DATA_TABLE_NAME_MAX_LENGTH}
                          placeholder="table_name"
                          title={
                            selectedTable
                              ? "Data table names are locked after creation."
                              : "Choose a unique name. It cannot be changed after save."
                          }
                        />
                      </div>
                      <Input
                        value={dataTableDescription}
                        onChange={(event) => setDataTableDescription(event.currentTarget.value)}
                        className="h-8 min-w-0 bg-sidebar text-xs"
                        maxLength={DATA_TABLE_DESCRIPTION_MAX_LENGTH}
                        placeholder="Description"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={handleAddColumn}
                        disabled={columns.length >= DATA_TABLE_MAX_COLUMNS}
                      >
                        <PlusIcon />
                        Add Column
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={handleAddRow}
                        disabled={rows.length >= DATA_TABLE_MAX_ROWS}
                      >
                        <PlusIcon />
                        Add Row
                      </Button>
                      <div className="relative ml-auto w-full min-w-0 md:w-72">
                        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={rowFilter}
                          onChange={(event) => setRowFilter(event.currentTarget.value)}
                          className="h-8 min-w-0 border-sidebar-border bg-sidebar pl-8 text-sm shadow-none"
                          placeholder="Filter rows"
                        />
                      </div>
                    </div>
                  </div>

                <div className="min-h-0 overflow-auto bg-background">
                  <Table className="min-w-full border-separate border-spacing-0 text-xs">
                    <TableHeader className="sticky top-0 z-10 bg-muted">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="sticky left-0 z-20 w-12 border-r bg-muted px-2 py-2 font-mono text-[11px] text-muted-foreground">
                          #
                        </TableHead>
                        {columns.map((column, index) => (
                          <TableHead key={`column-${index}`} className="min-w-48 border-r bg-muted p-1.5">
                            <div className="flex items-center gap-1.5">
                              <Input
                                value={column}
                                onChange={(event) => handleRenameColumn(index, event.currentTarget.value)}
                                maxLength={DATA_TABLE_COLUMN_NAME_MAX_LENGTH}
                                className="h-7 min-w-0 border-0 bg-background/80 font-mono text-xs shadow-none focus-visible:ring-1"
                                placeholder="column_name"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                title="Delete column"
                                onClick={() => handleDeleteColumn(index)}
                              >
                                <Trash2Icon />
                                <span className="sr-only">Delete column</span>
                              </Button>
                            </div>
                          </TableHead>
                        ))}
                        <TableHead className="w-12 bg-muted px-2 py-2" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleRows.map(({ index, row }) => (
                        <TableRow key={index} className="hover:bg-muted/30">
                          <TableCell className="sticky left-0 z-[1] border-r bg-background px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                            {index + 1}
                          </TableCell>
                          {columns.map((column, columnIndex) => (
                            <TableCell key={`${index}:column-${columnIndex}`} className="min-w-48 border-r p-1.5 align-top">
                              <Input
                                value={row[column] ?? ""}
                                onChange={(event) => handleUpdateCell(index, column, event.currentTarget.value)}
                                maxLength={DATA_TABLE_MAX_CELL_LENGTH}
                                className="h-8 min-w-0 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:bg-background focus-visible:ring-1"
                              />
                            </TableCell>
                          ))}
                          <TableCell className="p-1.5 align-top">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              title="Delete row"
                              onClick={() => handleDeleteRow(index)}
                            >
                              <Trash2Icon />
                              <span className="sr-only">Delete row</span>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {visibleRows.length === 0 ? (
                    <div className="flex h-40 items-center justify-center border-b text-xs text-muted-foreground">
                      No rows match the current filter.
                    </div>
                  ) : null}
                </div>

                <div className="grid shrink-0 grid-cols-1 gap-2 border-t border-sidebar-border bg-sidebar-accent/20 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 p-3">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {rows.length} rows
                    </Badge>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {columns.length} columns
                    </Badge>
                    {columnSummaries.map((column) => (
                      <Badge key={column.name} variant="outline" className="font-mono text-[10px]">
                        {column.name}:{column.coverage}/{rows.length}
                      </Badge>
                    ))}
                  </div>
                  <div className="grid gap-1.5 border-l border-sidebar-border p-3">
                    <div className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                      References
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-1.5">
                      {references.map((reference) => (
                        <Button
                          key={reference}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 justify-start font-mono text-xs"
                          onClick={() => handleReference(reference)}
                        >
                          <CopyIcon />
                          {formatDataTableReferenceForDisplay(reference)}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>

      <ConfirmDialog
        confirmLabel="Delete Table"
        description={
          pendingDeleteTable
            ? `Rules that reference ${pendingDeleteTable.name} will no longer find rows from this table.`
            : ""
        }
        isDestructive
        isOpen={Boolean(pendingDeleteTable)}
        title="Delete data table?"
        onConfirm={() => pendingDeleteTable && void handleDeleteDataTable(pendingDeleteTable)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteTable(null)
          }
        }}
      />
    </>
  )
}

function filterDataTables(dataTables: DataTableSummary[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return dataTables
  }
  return dataTables.filter((table) =>
    [table.name, table.description ?? ""].some((value) =>
      value.toLowerCase().includes(normalizedQuery)
    )
  )
}

function formatDataTableReferenceForDisplay(reference: string) {
  return reference.startsWith("%") ? reference.slice(1) : reference
}

function mergeDataTables(
  baseTables: DataTableSummary[],
  overlayTables: DataTableSummary[]
) {
  const byId = new Map(baseTables.map((table) => [table.id, table]))
  for (const table of overlayTables) {
    byId.set(table.id, table)
  }
  return [...byId.values()].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() ||
      left.name.localeCompare(right.name)
  )
}

function createUniqueTableName(dataTables: DataTableSummary[]) {
  const names = new Set(dataTables.map((table) => table.name))
  if (!names.has(DEFAULT_DATA_TABLE_NAME)) {
    return DEFAULT_DATA_TABLE_NAME
  }

  let index = 2
  let candidate = `${DEFAULT_DATA_TABLE_NAME}_${index}`
  while (names.has(candidate)) {
    index += 1
    candidate = `${DEFAULT_DATA_TABLE_NAME}_${index}`
  }
  return candidate
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

function toGridModel(rows: unknown): { columns: string[]; rows: DataTableGridRow[] } {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { columns: DEFAULT_COLUMNS, rows: [createEmptyRow(DEFAULT_COLUMNS)] }
  }

  const columnSet = new Set<string>()
  const gridRows = rows.map((row) => {
    if (!isRecord(row)) {
      columnSet.add("value")
      return { value: formatCellValue(row) }
    }
    for (const key of Object.keys(row)) {
      columnSet.add(key)
    }
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, formatCellValue(value)])
    )
  })
  const columns = [...columnSet].sort((left, right) => {
    if (left === "value") return -1
    if (right === "value") return 1
    return left.localeCompare(right)
  })
  return {
    columns: columns.length > 0 ? columns : DEFAULT_COLUMNS,
    rows: gridRows.map((row) => ({ ...createEmptyRow(columns), ...row })),
  }
}

function toSavedRows(columns: string[], rows: DataTableGridRow[]) {
  return rows
    .map((row) =>
      Object.fromEntries(
        columns.map((column) => [column.trim(), row[column] ?? ""])
      )
    )
    .filter((row) => Object.values(row).some((value) => String(value).trim().length > 0))
}

function validateGrid(columns: string[], rows: DataTableGridRow[]) {
  if (columns.length === 0) {
    return "Data tables must include at least one column."
  }
  if (columns.length > DATA_TABLE_MAX_COLUMNS) {
    return `Data tables can contain at most ${DATA_TABLE_MAX_COLUMNS.toLocaleString()} columns.`
  }
  if (rows.length > DATA_TABLE_MAX_ROWS) {
    return `Data tables can contain at most ${DATA_TABLE_MAX_ROWS.toLocaleString()} rows.`
  }
  const normalizedColumns = columns.map((column) => column.trim())
  const blankColumnIndex = normalizedColumns.findIndex((column) => !column)
  if (blankColumnIndex >= 0) {
    return `Column ${blankColumnIndex + 1} needs a name.`
  }
  const oversizedColumn = normalizedColumns.find(
    (column) => column.length > DATA_TABLE_COLUMN_NAME_MAX_LENGTH
  )
  if (oversizedColumn) {
    return `Column "${oversizedColumn.slice(0, 32)}..." must be ${DATA_TABLE_COLUMN_NAME_MAX_LENGTH} characters or fewer.`
  }
  const invalidColumn = normalizedColumns.find((column) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column))
  if (invalidColumn) {
    return `Column "${invalidColumn}" must use letters, numbers, and underscores.`
  }
  const duplicatedColumn = normalizedColumns.find(
    (column, index) => normalizedColumns.indexOf(column) !== index
  )
  if (duplicatedColumn) {
    return `Column "${duplicatedColumn}" is duplicated.`
  }
  const savedRows = toSavedRows(normalizedColumns, rows)
  if (savedRows.length === 0) {
    return "Data tables must include at least one non-empty row."
  }
  for (const [rowIndex, row] of savedRows.entries()) {
    for (const [column, value] of Object.entries(row)) {
      if (String(value).length > DATA_TABLE_MAX_CELL_LENGTH) {
        return `Row ${rowIndex + 1} column "${column}" must be ${DATA_TABLE_MAX_CELL_LENGTH.toLocaleString()} characters or fewer.`
      }
    }
  }
  return validateDataTableRows(savedRows)
}

function summarizeDataTableColumns(columns: string[], rows: DataTableGridRow[]): DataTableColumnSummary[] {
  return columns.map((column) => {
    const values = rows.map((row) => row[column]).filter((value) => value?.trim())
    return {
      coverage: values.length,
      name: column,
      types: ["string"],
    }
  })
}

function getDataTableReferences(tableName: string, columns: string[]) {
  const safeTableName = tableName || "table_name"
  const references = new Set<string>()
  if (columns.length === 1 && columns[0] === "value") {
    references.add(`%${safeTableName}`)
  }
  for (const column of columns) {
    if (column.trim()) {
      references.add(`%${safeTableName}.${column}`)
    }
  }
  return [...references].slice(0, 12)
}

function createUniqueColumnName(columns: string[]) {
  let index = columns.length + 1
  let candidate = `column_${index}`
  while (columns.includes(candidate)) {
    index += 1
    candidate = `column_${index}`
  }
  return candidate
}

function createEmptyRow(columns: string[]) {
  return Object.fromEntries(columns.map((column) => [column, ""]))
}

function formatCellValue(value: unknown) {
  if (value === null || value === undefined) {
    return ""
  }
  if (typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
