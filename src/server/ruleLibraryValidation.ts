import {
  compileYaralFile,
  getYaralBlockingDiagnostics,
  resolveYaralDiagnosticProfile,
} from "../domain/yaral/compiler"
import {
  validateDataTableRows,
  validateJsonValueSafety,
  validateUdmEvents,
} from "../domain/yaral/testing/input-validation"
import { YARAL_TEST_LIMITS } from "../domain/yaral/testing/limits"

export type RuleLibraryErrorFactory = (statusCode: number, message: string) => Error

export type RuleLibraryAuthContext = {
  user?: { id: string } | null
}

export const RULE_LIBRARY_LIMITS = {
  dataTableMaxBytes: 5_000_000,
  dataTableMaxCellLength: 4_096,
  dataTableMaxColumns: 10,
  dataTableMaxRows: 50,
  dataTableColumnNameMaxLength: 64,
  descriptionMaxLength: 2_000,
  expectedResultsMaxBytes: 1_000_000,
  fixtureEventMaxBytes: 1_000_000,
  fixtureMaxBytes: 5_000_000,
  fixtureMaxEvents: YARAL_TEST_LIMITS.testMaxEvents,
  folderMaxLength: 64,
  nameMaxLength: 128,
  ruleSourceMaxLength: YARAL_TEST_LIMITS.ruleSourceMaxLength,
  tagsInputMaxLength: 2_000,
  tagsMaxCount: 20,
  tagMaxLength: 32,
} as const

export type SaveRuleArgs = {
  description?: string | null
  folder?: string | null
  id?: string | null
  name?: string
  source?: string
  tags?: string[] | string | null
}

export type SaveUdmEventSetArgs = {
  description?: string | null
  events?: any
  expectedResults?: any | null
  id?: string | null
  name?: string
  savedRuleId?: string | null
}

export type SaveDataTableArgs = {
  description?: string | null
  id?: string | null
  name?: string
  rows?: any
}

export type DeleteArgs = {
  id?: string | null
}

export type RuleVersionArgs = {
  ruleId?: string | null
  versionId?: string | null
}

export type SavedRuleInput = {
  description: string | null
  folder: string | null
  name: string
  source: string
  tags: string[]
}

export type SavedRuleComparable = {
  description: string | null
  folder?: string | null
  name: string
  source: string
  tags?: string[] | null
}

export function requireAuthenticatedUserId(
  context: RuleLibraryAuthContext,
  createError: RuleLibraryErrorFactory
) {
  if (!context.user) {
    throw createError(401, "You must be logged in to use the rule library.")
  }
  return context.user.id
}

export type UdmEventSetInput = {
  description: string | null
  events: any
  expectedResults: any | null
  name: string
  savedRuleId: string | null
}

export type DataTableInput = {
  description: string | null
  name: string
  rows: any[]
}

export function normalizeSavedRule(
  args: SaveRuleArgs,
  createError: RuleLibraryErrorFactory
): SavedRuleInput {
  const name = args.name?.trim()
  const source = args.source?.trim()
  if (!name) {
    throw createError(400, "Rule name is required.")
  }
  if (!source) {
    throw createError(400, "Rule source is required.")
  }
  validateCommonTextFields(name, args.description, createError)
  const tags = normalizeRuleTags(args.tags, createError)
  const folder = normalizeRuleFolder(args.folder, createError)
  if (source.length > RULE_LIBRARY_LIMITS.ruleSourceMaxLength) {
    throw createError(
      400,
      `Rule source must be ${RULE_LIBRARY_LIMITS.ruleSourceMaxLength.toLocaleString()} characters or fewer.`
    )
  }
  validateSavedRuleSource(name, source, createError)

  return {
    description: args.description?.trim() || null,
    folder,
    name,
    source,
    tags,
  }
}

export function hasSavedRuleChanged(
  existingRule: SavedRuleComparable,
  nextRule: SavedRuleInput
) {
  return (
    existingRule.name !== nextRule.name ||
    existingRule.description !== nextRule.description ||
    existingRule.source !== nextRule.source ||
    (existingRule.folder ?? null) !== nextRule.folder ||
    !arraysEqual(existingRule.tags ?? [], nextRule.tags)
  )
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function normalizeUdmEventSet(
  args: SaveUdmEventSetArgs,
  createError: RuleLibraryErrorFactory
): UdmEventSetInput {
  const name = args.name?.trim()
  if (!name) {
    throw createError(400, "Event set name is required.")
  }
  validateCommonTextFields(name, args.description, createError)
  if (!Array.isArray(args.events)) {
    throw createError(400, "UDM event set must contain a JSON array.")
  }
  if (args.events.length > RULE_LIBRARY_LIMITS.fixtureMaxEvents) {
    throw createError(
      400,
      `Test cases can contain at most ${RULE_LIBRARY_LIMITS.fixtureMaxEvents.toLocaleString()} events.`
    )
  }
  requireJsonByteLengthUnder(args.events, RULE_LIBRARY_LIMITS.fixtureMaxBytes, "UDM event set", createError)
  requireNoValidationError(validateJsonValueSafety(args.events, "UDM event set"), createError)
  args.events.forEach((event, index) => {
    requireJsonByteLengthUnder(
      event,
      RULE_LIBRARY_LIMITS.fixtureEventMaxBytes,
      `UDM event ${index + 1}`,
      createError
    )
  })
  if (args.expectedResults !== undefined && args.expectedResults !== null) {
    requireJsonByteLengthUnder(
      args.expectedResults,
      RULE_LIBRARY_LIMITS.expectedResultsMaxBytes,
      "Expected results",
      createError
    )
    requireNoValidationError(validateJsonValueSafety(args.expectedResults, "Expected results"), createError)
  }
  requireNoValidationError(validateUdmEvents(args.events), createError)

  return {
    description: args.description?.trim() || null,
    events: args.events,
    expectedResults: args.expectedResults ?? null,
    name,
    savedRuleId: args.savedRuleId?.trim() || null,
  }
}

export function normalizeDataTable(
  args: SaveDataTableArgs,
  createError: RuleLibraryErrorFactory
): DataTableInput {
  const name = args.name?.trim()
  if (!name) {
    throw createError(400, "Data table name is required.")
  }
  validateCommonTextFields(name, args.description, createError)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw createError(400, "Data table names must use letters, numbers, and underscores.")
  }
  if (!Array.isArray(args.rows)) {
    throw createError(400, "Data table rows must be a JSON array.")
  }
  if (args.rows.length > RULE_LIBRARY_LIMITS.dataTableMaxRows) {
    throw createError(
      400,
      `Data tables can contain at most ${RULE_LIBRARY_LIMITS.dataTableMaxRows.toLocaleString()} rows.`
    )
  }
  validateDataTableShape(args.rows, createError)
  requireJsonByteLengthUnder(args.rows, RULE_LIBRARY_LIMITS.dataTableMaxBytes, "Data table rows", createError)
  requireNoValidationError(validateJsonValueSafety(args.rows, "Data table rows"), createError)
  requireNoValidationError(validateDataTableRows(args.rows), createError)

  return {
    description: args.description?.trim() || null,
    name,
    rows: args.rows,
  }
}

function validateDataTableShape(
  rows: unknown[],
  createError: RuleLibraryErrorFactory
) {
  const columns = new Set<string>()
  for (const [rowIndex, row] of rows.entries()) {
    if (row !== null && typeof row === "object" && !Array.isArray(row)) {
      for (const [columnName, value] of Object.entries(row)) {
        columns.add(columnName)
        validateDataTableColumnName(columnName, rowIndex, createError)
        validateDataTableCellValue(value, rowIndex, columnName, createError)
      }
      continue
    }

    validateDataTableCellValue(row, rowIndex, "value", createError)
  }

  if (columns.size > RULE_LIBRARY_LIMITS.dataTableMaxColumns) {
    throw createError(
      400,
      `Data tables can contain at most ${RULE_LIBRARY_LIMITS.dataTableMaxColumns.toLocaleString()} columns.`
    )
  }
}

function validateDataTableColumnName(
  columnName: string,
  rowIndex: number,
  createError: RuleLibraryErrorFactory
) {
  if (columnName.length > RULE_LIBRARY_LIMITS.dataTableColumnNameMaxLength) {
    throw createError(
      400,
      `Data table row ${rowIndex + 1} column "${columnName.slice(0, 32)}..." must be ${RULE_LIBRARY_LIMITS.dataTableColumnNameMaxLength} characters or fewer.`
    )
  }
}

function validateDataTableCellValue(
  value: unknown,
  rowIndex: number,
  columnName: string,
  createError: RuleLibraryErrorFactory
) {
  if (
    value !== null &&
    !["boolean", "number", "string"].includes(typeof value)
  ) {
    throw createError(
      400,
      `Data table row ${rowIndex + 1} column "${columnName}" must be a string, number, boolean, or null.`
    )
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw createError(
      400,
      `Data table row ${rowIndex + 1} column "${columnName}" must be a finite number.`
    )
  }
  if (
    typeof value === "string" &&
    value.length > RULE_LIBRARY_LIMITS.dataTableMaxCellLength
  ) {
    throw createError(
      400,
      `Data table row ${rowIndex + 1} column "${columnName}" must be ${RULE_LIBRARY_LIMITS.dataTableMaxCellLength.toLocaleString()} characters or fewer.`
    )
  }
}

export function requireDeleteId(
  args: DeleteArgs,
  message: string,
  createError: RuleLibraryErrorFactory
): asserts args is DeleteArgs & { id: string } {
  if (!args.id) {
    throw createError(400, message)
  }
}

export function requireUnchangedImmutableName(
  label: string,
  savedName: string | null | undefined,
  nextName: string,
  createError: RuleLibraryErrorFactory
) {
  if (savedName && savedName !== nextName) {
    throw createError(400, `${label} names cannot be changed after creation.`)
  }
}

function validateSavedRuleSource(
  name: string,
  source: string,
  createError: RuleLibraryErrorFactory
) {
  const profile = resolveYaralDiagnosticProfile("strict-save")
  const compiled = compileYaralFile(source, profile.compile)
  const blockingDiagnostics = getYaralBlockingDiagnostics(compiled.diagnostics, profile.blocking)
  if (blockingDiagnostics.length > 0) {
    throw createError(
      400,
      `Rule source has compiler errors or warnings: ${formatRuleSourceDiagnostics(blockingDiagnostics)}`
    )
  }

  if (compiled.rules.length !== 1) {
    throw createError(400, "Saved rule source must contain exactly one YARA-L rule.")
  }

  const compiledName = compiled.rules[0]?.summary.ruleName ?? compiled.rules[0]?.ast?.name ?? null
  if (!compiledName) {
    throw createError(400, "Rule source must include a YARA-L rule declaration.")
  }
  if (compiledName !== name) {
    throw createError(400, `Rule name must match the YARA-L rule declaration "${compiledName}".`)
  }
}

function validateCommonTextFields(
  name: string,
  description: string | null | undefined,
  createError: RuleLibraryErrorFactory
) {
  if (name.length > RULE_LIBRARY_LIMITS.nameMaxLength) {
    throw createError(
      400,
      `Name must be ${RULE_LIBRARY_LIMITS.nameMaxLength.toLocaleString()} characters or fewer.`
    )
  }
  if (hasControlCharacters(name)) {
    throw createError(400, "Name cannot contain control characters.")
  }
  const normalizedDescription = description?.trim()
  if (
    normalizedDescription &&
    normalizedDescription.length > RULE_LIBRARY_LIMITS.descriptionMaxLength
  ) {
    throw createError(
      400,
      `Description must be ${RULE_LIBRARY_LIMITS.descriptionMaxLength.toLocaleString()} characters or fewer.`
    )
  }
  if (normalizedDescription && hasUnsafeDescriptionControlCharacters(normalizedDescription)) {
    throw createError(400, "Description cannot contain unsafe control characters.")
  }
}

function normalizeRuleFolder(
  folder: string | null | undefined,
  createError: RuleLibraryErrorFactory
) {
  const normalizedFolder = folder?.trim() || null
  if (
    normalizedFolder &&
    normalizedFolder.length > RULE_LIBRARY_LIMITS.folderMaxLength
  ) {
    throw createError(
      400,
      `Folder must be ${RULE_LIBRARY_LIMITS.folderMaxLength.toLocaleString()} characters or fewer.`
    )
  }
  if (normalizedFolder && hasControlCharacters(normalizedFolder)) {
    throw createError(400, "Folder cannot contain control characters.")
  }
  return normalizedFolder
}

function normalizeRuleTags(
  tags: SaveRuleArgs["tags"],
  createError: RuleLibraryErrorFactory
) {
  if (tags === null || tags === undefined) {
    return []
  }

  if (typeof tags === "string" && tags.length > RULE_LIBRARY_LIMITS.tagsInputMaxLength) {
    throw createError(
      400,
      `Rule tags input must be ${RULE_LIBRARY_LIMITS.tagsInputMaxLength.toLocaleString()} characters or fewer.`
    )
  }

  if (!Array.isArray(tags) && typeof tags !== "string") {
    throw createError(400, "Rule tags must be a list or comma-separated text.")
  }

  const rawTags = Array.isArray(tags) ? tags : tags.split(/[,;\s]+/)
  if (rawTags.length > RULE_LIBRARY_LIMITS.tagsMaxCount) {
    throw createError(
      400,
      `Rules can have at most ${RULE_LIBRARY_LIMITS.tagsMaxCount.toLocaleString()} tags.`
    )
  }

  const normalizedTags = [
    ...new Set(
      rawTags
        .map((tag) => {
          if (typeof tag !== "string") {
            throw createError(400, "Rule tags must be text.")
          }
          return tag
        })
        .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean)
    ),
  ]

  if (normalizedTags.length > RULE_LIBRARY_LIMITS.tagsMaxCount) {
    throw createError(
      400,
      `Rules can have at most ${RULE_LIBRARY_LIMITS.tagsMaxCount.toLocaleString()} tags.`
    )
  }

  for (const tag of normalizedTags) {
    if (tag.length > RULE_LIBRARY_LIMITS.tagMaxLength) {
      throw createError(
        400,
        `Rule tags must be ${RULE_LIBRARY_LIMITS.tagMaxLength.toLocaleString()} characters or fewer.`
      )
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(tag)) {
      throw createError(400, "Rule tags must use letters, numbers, underscores, or hyphens.")
    }
  }

  return normalizedTags
}

function requireJsonByteLengthUnder(
  value: unknown,
  maxBytes: number,
  label: string,
  createError: RuleLibraryErrorFactory
) {
  let json: string
  try {
    json = JSON.stringify(value)
  } catch {
    throw createError(400, `${label} must be JSON serializable.`)
  }
  if (new TextEncoder().encode(json).byteLength > maxBytes) {
    throw createError(400, `${label} must be ${maxBytes.toLocaleString()} bytes or fewer.`)
  }
}

function hasControlCharacters(value: string) {
  return /[\u0000-\u001f\u007f]/.test(value)
}

function hasUnsafeDescriptionControlCharacters(value: string) {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
}

function requireNoValidationError(
  message: string | null,
  createError: RuleLibraryErrorFactory
) {
  if (message) {
    throw createError(400, message)
  }
}

function formatRuleSourceDiagnostics(
  diagnostics: Array<{ column: number; line: number; message: string }>
) {
  return diagnostics
    .slice(0, 3)
    .map((diagnostic) => `line ${diagnostic.line}, column ${diagnostic.column}: ${diagnostic.message}`)
    .join("; ")
}
