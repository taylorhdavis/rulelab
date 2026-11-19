import { collectVariableExpressions } from "./ast"
import { getYaralBlockingDiagnostics, type YaralDiagnosticProfile } from "./diagnostics"
import {
  resolveYaralDiagnosticProfile,
  type YaralNamedDiagnosticProfile,
} from "./diagnosticProfiles"
import {
  getYaralRuleDataTableReferencesFromSections,
  type YaralDataTableReference,
} from "./metadata"
import { compileYaral } from "./parser"
import type {
  YaralDiagnostic,
  YaralMatchWindowType,
  YaralRuleType,
  YaralSectionName,
} from "./types"

export type YaralValidationResult = {
  dataTableReferences: YaralDataTableReference[]
  diagnostics: YaralDiagnostic[]
  eventVariables: YaralEventVariableSummary[]
  functionUses: YaralFunctionUseSummary[]
  isValid: boolean
  match: YaralMatchSummary | null
  outcomeVariables: YaralOutcomeVariableSummary[]
  placeholderVariables: YaralPlaceholderVariableSummary[]
  referencedFields: string[]
  ruleName: string | null
  ruleType: YaralRuleType
  sections: Array<{ name: YaralSectionName; present: boolean }>
  summary: {
    eventFilters: number
    matchWindow: string | null
    matchWindowType: YaralMatchWindowType | null
  }
}

export type YaralValidationOptions = {
  dataTables?: NonNullable<Parameters<typeof compileYaral>[1]>["dataTables"]
  diagnosticProfile?: YaralDiagnosticProfile
  experimentalDiagnostics?: boolean
  namedDiagnosticProfile?: YaralNamedDiagnosticProfile
  treatWarningsAsErrors?: boolean
}

export type YaralMatchSummary = {
  direction: "after" | "before" | null
  pivot: string | null
  variables: string[]
  window: string | null
  windowKeyword: string | null
  windowType: YaralMatchWindowType | null
}

export type YaralEventVariableSummary = {
  eventTypes: string[]
  fields: string[]
  filterCount: number
  logTypes: string[]
  name: string
}

export type YaralOutcomeVariableSummary = {
  name: string
  sources: string[]
}

export type YaralPlaceholderVariableSummary = {
  eventVariable: string | null
  eventVariables: string[]
  isJoin: boolean
  name: string
  sources: string[]
  source: string
}

export type YaralFunctionUseSummary = {
  count: number
  name: string
}

export function validateYaralRule(
  source: string,
  options: YaralValidationOptions = {}
): YaralValidationResult {
  const namedProfile = options.namedDiagnosticProfile
    ? resolveYaralDiagnosticProfile(options.namedDiagnosticProfile)
    : null
  let compiled = compileYaral(source, {
    ...namedProfile?.compile,
    approximateHelperDiagnostics: options.experimentalDiagnostics === true,
    dataTables: options.dataTables,
    experimentalDiagnostics: options.experimentalDiagnostics === true,
  })
  if (
    options.experimentalDiagnostics !== true &&
    compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    compiled = {
      ...compiled,
      diagnostics: appendExperimentalWarnings(source, options, compiled.diagnostics),
    }
  }
  const diagnostics = compiled.diagnostics
  const eventVariables = compiled.symbols.eventVariables.map((symbol) => ({
    eventTypes: symbol.eventTypes,
    fields: symbol.fields,
    filterCount: symbol.filterCount,
    logTypes: symbol.logTypes,
    name: symbol.name,
  }))
  const placeholderVariables = compiled.symbols.placeholderVariables
    .filter((symbol) => symbol.sources.length > 0)
    .map((symbol) => ({
      eventVariable: symbol.eventVariable,
      eventVariables: symbol.eventVariables,
      isJoin: symbol.isJoin,
      name: symbol.name,
      source: symbol.source,
      sources: symbol.sources,
    }))
  const placeholderSourcesByName = new Map(
    placeholderVariables.map((placeholder) => [placeholder.name, placeholder.sources])
  )
  const outcomeSourcesByName = new Map<string, string[]>()
  const outcomeVariables =
    compiled.plan?.outcomes.map((outcome) => {
      const sources = collectOutcomeSources(
        outcome.expression,
        placeholderSourcesByName,
        outcomeSourcesByName
      )
      outcomeSourcesByName.set(outcome.name, sources)
      return {
        name: outcome.name,
        sources,
      }
    }) ??
    compiled.symbols.outcomeVariables.map((symbol) => ({
      name: symbol.name,
      sources: [],
    }))
  const match = summarizeMatch(compiled.ast?.sections.find((section) => section.name === "match")?.match ?? null)

  return {
    dataTableReferences: getYaralRuleDataTableReferencesFromSections(compiled.ast?.sections ?? []),
    diagnostics,
    isValid: getYaralBlockingDiagnostics(diagnostics, {
      ...(namedProfile?.blocking ?? { diagnosticProfile: options.diagnosticProfile }),
      treatWarningsAsErrors: options.treatWarningsAsErrors,
    }).length === 0,
    eventVariables,
    functionUses: compiled.symbols.functions.map((symbol) => ({
      count: symbol.references.length,
      name: symbol.name,
    })),
    match,
    outcomeVariables,
    placeholderVariables,
    referencedFields: compiled.symbols.referencedFields,
    ruleName: compiled.summary.ruleName,
    ruleType: compiled.summary.ruleType,
    sections: compiled.summary.sections,
    summary: {
      eventFilters: compiled.summary.eventFilters,
      matchWindow: compiled.summary.matchWindow,
      matchWindowType: compiled.summary.matchWindowType,
    },
  }
}

function appendExperimentalWarnings(
  source: string,
  options: YaralValidationOptions,
  diagnostics: YaralDiagnostic[]
) {
  const seen = new Set(diagnostics.map(getDiagnosticKey))
  const experimentalDiagnostics = compileYaral(source, {
    approximateHelperDiagnostics: true,
    dataTables: options.dataTables,
    experimentalDiagnostics: true,
  }).diagnostics.filter((diagnostic) => diagnostic.severity === "warning")

  return [
    ...diagnostics,
    ...experimentalDiagnostics.filter((diagnostic) => {
      const key = getDiagnosticKey(diagnostic)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    }),
  ]
}

function getDiagnosticKey(diagnostic: YaralDiagnostic) {
  return [
    diagnostic.line,
    diagnostic.column,
    diagnostic.endLine,
    diagnostic.endColumn,
    diagnostic.severity,
    diagnostic.message,
  ].join(":")
}

function summarizeMatch(
  match: NonNullable<ReturnType<typeof compileYaral>["ast"]>["sections"][number]["match"] | null
): YaralMatchSummary | null {
  if (!match) {
    return null
  }
  return {
    direction: match.windowDirection,
    pivot: match.pivot ? formatVariable(match.pivot) : null,
    variables: match.variables.map(formatVariable),
    window: match.duration?.value ?? null,
    windowKeyword: match.windowToken?.value ?? null,
    windowType: match.windowKind,
  }
}

function formatVariable(variable: { name: string; path: string }) {
  return `$${variable.name}${variable.path ? `.${variable.path}` : ""}`
}

function collectOutcomeSources(
  expression: NonNullable<ReturnType<typeof compileYaral>["plan"]>["outcomes"][number]["expression"],
  placeholderSourcesByName: Map<string, string[]>,
  outcomeSourcesByName: Map<string, string[]>
) {
  const sources = new Set<string>()

  for (const variable of collectVariableExpressions(expression)) {
    if (variable.path.length > 0) {
      sources.add(`$${variable.name}.${variable.path}`)
      continue
    }

    const placeholderSources = placeholderSourcesByName.get(variable.name)
    if (placeholderSources) {
      placeholderSources.forEach((source) => sources.add(source))
      continue
    }

    const outcomeSources = outcomeSourcesByName.get(variable.name)
    if (outcomeSources) {
      outcomeSources.forEach((source) => sources.add(source))
      continue
    }

    sources.add(`$${variable.name}`)
  }

  return [...sources].sort()
}
