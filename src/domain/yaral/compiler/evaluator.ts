import {
  getYaralApproximateFunctionMessage,
  getYaralFunctionRuntimeFidelity,
  isYaralUnsupportedRuntimeFunction,
} from "../functions"
import { collectVariableExpressions, walkExpression } from "./ast"
import {
  createDiagnostic,
  firstSourceRange,
  getYaralBlockingDiagnostics,
  type YaralDiagnosticProfile,
} from "./diagnostics"
import { getYaralRuntimeFunction } from "./runtime-functions"
import {
  createRepeatedEvaluationValue,
  compareEqual,
  createDataTableLookupEntry,
  evaluateBinaryValues,
  isRepeatedEvaluationValue,
  toComparisonValues,
  type DataTableLookupEntry,
} from "./runtime-operators"
import { stripYaralStringQuotes } from "./text"
import type {
  YaralCompiledRule,
  YaralDiagnostic,
  YaralEvaluationDataTable,
  YaralEvaluationEvent,
  YaralEvaluationMatch,
  YaralEvaluationResult,
  YaralEvaluationTrace,
  YaralExpression,
  YaralRuntimePlan,
} from "./types"

export type YaralEvaluationSuppressionState = {
  windows: Record<string, number>
}

export type YaralEvaluationOptions = {
  dataTables?: YaralEvaluationDataTable[]
  diagnosticProfile?: YaralDiagnosticProfile
  evaluationRange?: YaralEvaluationRange
  experimentalDiagnostics?: boolean
  matchKeyUniverse?: Record<string, unknown[]>
  nowMs?: () => number
  random?: () => number
  suppressionState?: YaralEvaluationSuppressionState
}

export type YaralEvaluationRange = {
  end: number | string
  start: number | string
}

type YaralEvaluationRuntimeSources = {
  nowMs: () => number
  random: () => number
}

type DataTableLookup = Record<string, DataTableLookupEntry>
type NormalizedEvaluationRange = {
  endMs: number
  startMs: number
}
type WindowBoundaryValues = {
  end: string
  start: string
}
type TimedEvent = {
  event: YaralEvaluationEvent
  eventVariable: string
  timestamp: number
}
type TimedWindow = {
  endMs: number
  events: TimedEvent[]
  startMs: number
}

const OUTCOME_ARRAY_AGGREGATE_LIMIT = 1_000
const HOP_WINDOW_STEP_DIVISOR = 10

export function evaluateYaralRule(
  rule: YaralCompiledRule,
  events: YaralEvaluationEvent[],
  options: YaralEvaluationOptions = {}
): YaralEvaluationResult {
  const diagnostics: YaralDiagnostic[] = []
  const traces: YaralEvaluationTrace[] = []
  const emptyResult = createEmptyResult(diagnostics, traces)
  const dataTables = createDataTableLookup(options.dataTables ?? [])
  const evaluationRange = normalizeEvaluationRange(options.evaluationRange)
  const runtimeSources = createRuntimeSources(options)
  const unsupportedFunctions = new Set<string>()

  if (getYaralBlockingDiagnostics(rule.diagnostics, {
    diagnosticProfile: options.diagnosticProfile ?? "strict",
  }).length > 0) {
    diagnostics.push(runtimeDiagnostic("Cannot evaluate a rule with blocking compiler diagnostics."))
    return emptyResult
  }
  if (!rule.plan) {
    diagnostics.push(runtimeDiagnostic("Cannot evaluate a rule without a runtime plan."))
    return emptyResult
  }
  if (rule.plan.match || rule.summary.ruleType === "multi_event") {
    const result = evaluateMultiEventRule(
      rule.plan,
      events,
      diagnostics,
      traces,
      dataTables,
      unsupportedFunctions,
      runtimeSources,
      evaluationRange,
      options.matchKeyUniverse,
      options.experimentalDiagnostics === true
    )
    return applySuppression(rule, result, options)
  }

  const matchingEvents: YaralEvaluationEvent[] = []
  const eventVariable = getEventVariableNames(rule.plan)[0]

  for (const event of events) {
    const context = createSingleEventContext(
      rule.plan,
      event,
      dataTables,
      diagnostics,
      unsupportedFunctions,
      runtimeSources
    )
    Object.assign(context.placeholders, evaluatePlaceholders(rule.plan, context))
    const predicateResults = rule.plan.eventPredicates.map((predicate) => {
      const value = evaluateExpression(predicate.expression, context)
      pushTrace(traces, {
        expression: predicate.expression,
        label: `events:${predicate.eventVariable ?? "unknown"}`,
        passed: Boolean(value),
        value,
      })
      return Boolean(value)
    })

    if (!predicateResults.every(Boolean)) {
      continue
    }
    matchingEvents.push(event)
  }

  if (matchingEvents.length === 0) {
    return emptyResult
  }

  if (eventVariable && !shouldEvaluateAsEventSet(rule.plan)) {
    const matches: YaralEvaluationMatch[] = []

    for (const event of matchingEvents) {
      const context = createSingleEventContext(
        rule.plan,
        event,
        dataTables,
        diagnostics,
        unsupportedFunctions,
        runtimeSources
      )
      const placeholders = evaluatePlaceholders(rule.plan, context)
      Object.assign(context.placeholders, placeholders)
      const outcomes = evaluateOutcomes(rule.plan, context)
      Object.assign(context.outcomes, outcomes)

      const conditionValue = rule.plan.condition
        ? evaluateExpression(rule.plan.condition, context)
        : true
      if (rule.plan.condition) {
        pushTrace(traces, {
          expression: rule.plan.condition,
          label: "condition",
          passed: Boolean(conditionValue),
          value: conditionValue,
        })
      }

      if (conditionValue) {
        matches.push({
          matchedEvents: context.events,
          outcomes,
          placeholders: { ...context.placeholders },
        })
      }
    }

    return applySuppression(
      rule,
      createMatchedResult(diagnostics, traces, matches),
      options
    )
  }

  const context =
    eventVariable && shouldEvaluateAsEventSet(rule.plan)
      ? createContext(
          { [eventVariable]: matchingEvents },
          dataTables,
          diagnostics,
          unsupportedFunctions,
          rule.plan,
          runtimeSources
        )
      : createSingleEventContext(
          rule.plan,
          matchingEvents[0] as YaralEvaluationEvent,
          dataTables,
          diagnostics,
          unsupportedFunctions,
          runtimeSources
        )
  const placeholders = evaluatePlaceholders(rule.plan, context)
  Object.assign(context.placeholders, placeholders)
  const outcomes = evaluateOutcomes(rule.plan, context)
  Object.assign(context.outcomes, outcomes)

  const conditionValue = rule.plan.condition
    ? evaluateExpression(rule.plan.condition, context)
    : true
  if (rule.plan.condition) {
    pushTrace(traces, {
      expression: rule.plan.condition,
      label: "condition",
      passed: Boolean(conditionValue),
      value: conditionValue,
    })
  }

  if (conditionValue) {
    return applySuppression(
      rule,
      createMatchedResult(diagnostics, traces, {
        matchedEvents: context.events,
        outcomes,
        placeholders,
      }),
      options
    )
  }

  return emptyResult
}

type EvaluationContext = {
  dataTables: DataTableLookup
  diagnostics: YaralDiagnostic[]
  events: Record<string, YaralEvaluationEvent[]>
  eventValues: Record<string, YaralEvaluationEvent | undefined>
  outcomes: Record<string, unknown>
  plan: YaralRuntimePlan | null
  placeholders: Record<string, unknown>
  runtimeSources: YaralEvaluationRuntimeSources
  unsupportedFunctions: Set<string>
  windowBoundaries: WindowBoundaryValues | null
}

const WILDCARD_MATCH_GROUP_KEY = "__yaral_wildcard_match_group__"

function evaluateMultiEventRule(
  plan: YaralRuntimePlan,
  events: YaralEvaluationEvent[],
  diagnostics: YaralDiagnostic[],
  traces: YaralEvaluationTrace[],
  dataTables: DataTableLookup,
  unsupportedFunctions: Set<string>,
  runtimeSources: YaralEvaluationRuntimeSources,
  evaluationRange: NormalizedEvaluationRange | null,
  matchKeyUniverse: Record<string, unknown[]> | undefined,
  experimentalDiagnostics: boolean
): YaralEvaluationResult {
  const requiredEventVariables = getRequiredConditionEventVariables(plan.condition)
  const candidates = getEventVariableNames(plan).map((eventVariable) => ({
    eventVariable,
    events: events.filter((event) =>
      plan.eventPredicates
        .filter((predicate) => predicateAppliesToSingleEventVariable(plan, predicate, eventVariable))
        .every((predicate) => {
          const context = createContext(
            { [eventVariable]: event },
            dataTables,
            diagnostics,
            unsupportedFunctions,
            plan,
            runtimeSources
          )
          Object.assign(context.placeholders, evaluatePlaceholders(plan, context))
          return Boolean(evaluateExpression(predicate.expression, context))
        })
    ),
  }))

  if (
    candidates.some(
      (candidate) =>
        candidate.events.length === 0 &&
        requiredEventVariables.has(candidate.eventVariable)
    )
  ) {
    return createEmptyResult(diagnostics, traces)
  }

  if (candidates.length === 1 && plan.match?.variables.length) {
    return evaluateSingleVariableMatchGroups(
      plan,
      candidates[0],
      diagnostics,
      traces,
      dataTables,
      unsupportedFunctions,
      runtimeSources,
      evaluationRange,
      matchKeyUniverse,
      experimentalDiagnostics
    )
  }

  if (plan.match?.variables.length) {
    return evaluateMultiVariableMatchGroups(
      plan,
      candidates,
      diagnostics,
      traces,
      dataTables,
      unsupportedFunctions,
      runtimeSources,
      evaluationRange,
      matchKeyUniverse,
      experimentalDiagnostics
    )
  }

  const matches: YaralEvaluationMatch[] = []

  for (const tuple of buildEventTuples(candidates)) {
    let context = createContext(
      tuple,
      dataTables,
      diagnostics,
      unsupportedFunctions,
      plan,
      runtimeSources
    )
    const placeholders = evaluatePlaceholders(plan, context)
    Object.assign(context.placeholders, placeholders)

    const crossFilteredContext = filterCrossEventPredicateEvents(plan, context, traces)
    if (!crossFilteredContext) {
      continue
    }
    context = crossFilteredContext
    Object.assign(context.placeholders, evaluatePlaceholders(plan, context))

    if (!joinsMatch(plan, context)) {
      continue
    }

    const outcomes = evaluateOutcomes(plan, context)
    Object.assign(context.outcomes, outcomes)
    const conditionValue = plan.condition ? evaluateExpression(plan.condition, context) : true
    if (plan.condition) {
      pushTrace(traces, {
        expression: plan.condition,
        label: "condition",
        passed: Boolean(conditionValue),
        value: conditionValue,
      })
    }

    if (conditionValue) {
      matches.push({
        matchedEvents: context.events,
        outcomes,
        placeholders,
      })
    }
  }

  return createMatchedResult(diagnostics, traces, matches)
}

function evaluateMultiVariableMatchGroups(
  plan: YaralRuntimePlan,
  candidates: Array<{ eventVariable: string; events: YaralEvaluationEvent[] }>,
  diagnostics: YaralDiagnostic[],
  traces: YaralEvaluationTrace[],
  dataTables: DataTableLookup,
  unsupportedFunctions: Set<string>,
  runtimeSources: YaralEvaluationRuntimeSources,
  evaluationRange: NormalizedEvaluationRange | null,
  matchKeyUniverse: Record<string, unknown[]> | undefined,
  experimentalDiagnostics: boolean
): YaralEvaluationResult {
  const requiredEventVariables = getRequiredConditionEventVariables(plan.condition)
  const groupedCandidates = candidates.map((candidate) => ({
    eventVariable: candidate.eventVariable,
    groups: candidate.events.length === 0 && !requiredEventVariables.has(candidate.eventVariable)
      ? createOptionalEmptyEventGroups(plan, candidate.eventVariable, matchKeyUniverse)
      : groupEventsByMatchVariables(
          plan,
          candidate,
          dataTables,
          diagnostics,
          unsupportedFunctions,
          runtimeSources
        ),
  }))

  const matches: YaralEvaluationMatch[] = []

  for (const groupTuple of buildGroupTuples(groupedCandidates)) {
    if (!groupKeysAreCompatible(groupTuple.map((entry) => entry.key))) {
      continue
    }
    const eventSets = Object.fromEntries(
      groupTuple.map((entry) => [entry.eventVariable, entry.events])
    )

    for (const windowedEventSets of getWindowedEventSets(
      plan,
      eventSets,
      requiredEventVariables,
      evaluationRange,
      diagnostics,
      experimentalDiagnostics
    )) {
      const groupPlaceholders = mergeMatchGroupKeys(groupTuple.map((entry) => entry.key))
      let context = createContext(
        windowedEventSets.events,
        dataTables,
        diagnostics,
        unsupportedFunctions,
        plan,
        runtimeSources,
        windowedEventSets.boundaries
      )

      const placeholders = evaluatePlaceholders(plan, context)
      Object.assign(context.placeholders, placeholders)
      Object.assign(context.placeholders, groupPlaceholders)

      const crossFilteredContext = filterCrossEventPredicateEvents(plan, context, traces)
      if (!crossFilteredContext) {
        continue
      }
      context = crossFilteredContext
      Object.assign(context.placeholders, evaluatePlaceholders(plan, context))
      Object.assign(context.placeholders, groupPlaceholders)

      if (!joinsMatch(plan, context)) {
        continue
      }

      const outcomes = evaluateOutcomes(plan, context)
      Object.assign(context.outcomes, outcomes)
      const conditionValue = plan.condition ? evaluateExpression(plan.condition, context) : true

      if (plan.condition) {
        pushTrace(traces, {
          expression: plan.condition,
          label: "condition",
          passed: Boolean(conditionValue),
          value: conditionValue,
        })
      }

      if (conditionValue) {
        matches.push({
          matchedEvents: context.events,
          outcomes,
          placeholders: { ...context.placeholders },
        })
      }
    }
  }

  return createMatchedResult(diagnostics, traces, matches)
}

function evaluateSingleVariableMatchGroups(
  plan: YaralRuntimePlan,
  candidate: { eventVariable: string; events: YaralEvaluationEvent[] },
  diagnostics: YaralDiagnostic[],
  traces: YaralEvaluationTrace[],
  dataTables: DataTableLookup,
  unsupportedFunctions: Set<string>,
  runtimeSources: YaralEvaluationRuntimeSources,
  evaluationRange: NormalizedEvaluationRange | null,
  matchKeyUniverse: Record<string, unknown[]> | undefined,
  experimentalDiagnostics: boolean
): YaralEvaluationResult {
  const groups = new Map<string, YaralEvaluationEvent[]>()

  for (const event of candidate.events) {
    if (!eventVariableHasMatchVariables(plan, candidate.eventVariable)) {
      groups.set(WILDCARD_MATCH_GROUP_KEY, [
        ...(groups.get(WILDCARD_MATCH_GROUP_KEY) ?? []),
        event,
      ])
      continue
    }
    const context = createContext(
      { [candidate.eventVariable]: event },
      dataTables,
      diagnostics,
      unsupportedFunctions,
      plan,
      runtimeSources
    )
    const placeholders = evaluatePlaceholders(plan, context)
    Object.assign(context.placeholders, placeholders)
    const keyValues = Object.fromEntries(
      plan.match?.variables.map((variable) => [variable, placeholders[variable]]) ?? []
    )
    if (!matchKeyValuesPassZeroFilter(plan, candidate.eventVariable, keyValues)) {
      continue
    }
    const key = JSON.stringify(keyValues)
    groups.set(key, [...(groups.get(key) ?? []), event])
  }

  if (groups.size === 0) {
    const universeGroups = createMatchKeyUniverseGroups(plan, candidate.eventVariable, matchKeyUniverse)
    for (const [key, events] of universeGroups) {
      groups.set(key, events)
    }
  }

  if (
    groups.size === 0 &&
    plan.match?.kind === "tumbling" &&
    plan.match.variables.length > 0 &&
    evaluationRange &&
    experimentalDiagnostics
  ) {
    pushRuntimeWarningOnce(
      diagnostics,
      "Tumbling absence tests with no observed match keys need `evaluationOptions.matchKeyUniverse` to synthesize empty buckets for never-seen keys."
    )
  }

  const matches: YaralEvaluationMatch[] = []

  for (const [key, events] of groups.entries()) {
    for (const windowedEventSets of getWindowedEventSets(
      plan,
      { [candidate.eventVariable]: events },
      getRequiredConditionEventVariables(plan.condition),
      evaluationRange,
      diagnostics,
      experimentalDiagnostics
    )) {
      const groupPlaceholders = parseMatchGroupKey(key)
      const context = createContext(
        windowedEventSets.events,
        dataTables,
        diagnostics,
        unsupportedFunctions,
        plan,
        runtimeSources,
        windowedEventSets.boundaries
      )
      const placeholders = evaluatePlaceholders(plan, context)
      Object.assign(context.placeholders, placeholders)
      Object.assign(context.placeholders, groupPlaceholders ?? {})

      const outcomes = evaluateOutcomes(plan, context)
      Object.assign(context.outcomes, outcomes)
      const conditionValue = plan.condition ? evaluateExpression(plan.condition, context) : true

      if (plan.condition) {
        pushTrace(traces, {
          expression: plan.condition,
          label: "condition",
          passed: Boolean(conditionValue),
          value: conditionValue,
        })
      }

      if (conditionValue) {
        matches.push({
          matchedEvents: context.events,
          outcomes,
          placeholders: { ...context.placeholders },
        })
      }
    }
  }

  return createMatchedResult(diagnostics, traces, matches)
}

function groupEventsByMatchVariables(
  plan: YaralRuntimePlan,
  candidate: { eventVariable: string; events: YaralEvaluationEvent[] },
  dataTables: DataTableLookup,
  diagnostics: YaralDiagnostic[],
  unsupportedFunctions: Set<string>,
  runtimeSources: YaralEvaluationRuntimeSources
) {
  const groups = new Map<string, YaralEvaluationEvent[]>()

  for (const event of candidate.events) {
    if (!eventVariableHasMatchVariables(plan, candidate.eventVariable)) {
      groups.set(WILDCARD_MATCH_GROUP_KEY, [
        ...(groups.get(WILDCARD_MATCH_GROUP_KEY) ?? []),
        event,
      ])
      continue
    }

    const context = createContext(
      { [candidate.eventVariable]: event },
      dataTables,
      diagnostics,
      unsupportedFunctions,
      plan,
      runtimeSources
    )
    Object.assign(context.placeholders, evaluatePlaceholders(plan, context))
    const keyValues = Object.fromEntries(
      plan.match?.variables
        .filter((variable) => matchVariableUsesEventVariable(plan, variable, candidate.eventVariable))
        .map((variable) => [
          variable,
          evaluateMatchVariable(plan, variable, candidate.eventVariable, context),
        ])
        .filter(([, value]) => value !== undefined && value !== null) ?? []
    )
    if (!matchKeyValuesPassZeroFilter(plan, candidate.eventVariable, keyValues)) {
      continue
    }
    const key = Object.keys(keyValues).length ? JSON.stringify(keyValues) : WILDCARD_MATCH_GROUP_KEY
    groups.set(key, [...(groups.get(key) ?? []), event])
  }

  return groups
}

function createOptionalEmptyEventGroups(
  plan: YaralRuntimePlan,
  eventVariable: string,
  matchKeyUniverse: Record<string, unknown[]> | undefined
) {
  const universeGroups = createMatchKeyUniverseGroups(plan, eventVariable, matchKeyUniverse)
  return universeGroups.size > 0 ? universeGroups : new Map([[WILDCARD_MATCH_GROUP_KEY, []]])
}

function createMatchKeyUniverseGroups(
  plan: YaralRuntimePlan,
  eventVariable: string,
  matchKeyUniverse: Record<string, unknown[]> | undefined
) {
  const variables = plan.match?.variables.filter((variable) =>
    matchVariableUsesEventVariable(plan, variable, eventVariable)
  ) ?? []
  if (variables.length === 0 || !matchKeyUniverse) {
    return new Map<string, YaralEvaluationEvent[]>()
  }

  const valuesByVariable = variables.map((variable) => ({
    values: matchKeyUniverse[variable] ?? [],
    variable,
  }))
  if (valuesByVariable.some((entry) => entry.values.length === 0)) {
    return new Map<string, YaralEvaluationEvent[]>()
  }

  const groups = new Map<string, YaralEvaluationEvent[]>()
  function visit(index: number, current: Record<string, unknown>) {
    const entry = valuesByVariable[index]
    if (!entry) {
      if (!matchKeyValuesPassZeroFilter(plan, eventVariable, current)) {
        return
      }
      groups.set(JSON.stringify(current), [])
      return
    }
    for (const value of entry.values) {
      visit(index + 1, { ...current, [entry.variable]: value })
    }
  }
  visit(0, {})
  return groups
}

function matchKeyValuesPassZeroFilter(
  plan: YaralRuntimePlan,
  eventVariable: string,
  keyValues: Record<string, unknown>
) {
  for (const [variable, value] of Object.entries(keyValues)) {
    if (
      shouldImplicitlyFilterZeroMatchVariable(plan, variable, eventVariable) &&
      isYaralZeroValue(value)
    ) {
      return false
    }
  }
  return true
}

function shouldImplicitlyFilterZeroMatchVariable(
  plan: YaralRuntimePlan,
  variable: string,
  eventVariable: string
) {
  if (plan.options.allowZeroValues) {
    return false
  }
  const placeholder = plan.placeholders.find(
    (entry) => entry.name === variable && entry.eventVariables.includes(eventVariable)
  )
  if (!placeholder) {
    return false
  }
  return !containsCallExpression(placeholder.expression)
}

function isYaralZeroValue(value: unknown) {
  return value === "" || value === 0 || value === false
}

function containsCallExpression(expression: YaralExpression) {
  let containsCall = false
  walkExpression(expression, (node) => {
    if (node.kind === "call") {
      containsCall = true
    }
  })
  return containsCall
}

function buildGroupTuples(
  groupedCandidates: Array<{
    eventVariable: string
    groups: Map<string, YaralEvaluationEvent[]>
  }>
) {
  const tuples: Array<Array<{ eventVariable: string; events: YaralEvaluationEvent[]; key: string }>> = []

  function visit(
    index: number,
    current: Array<{ eventVariable: string; events: YaralEvaluationEvent[]; key: string }>
  ) {
    const candidate = groupedCandidates[index]
    if (!candidate) {
      tuples.push(current)
      return
    }
    for (const [key, events] of candidate.groups.entries()) {
      visit(index + 1, [...current, { eventVariable: candidate.eventVariable, events, key }])
    }
  }

  visit(0, [])
  return tuples
}

function groupKeysAreCompatible(keys: string[]) {
  const merged = new Map<string, unknown>()
  for (const key of keys) {
    if (key === WILDCARD_MATCH_GROUP_KEY) {
      continue
    }
    const parsed = parseMatchGroupKey(key)
    if (!parsed) {
      return false
    }
    for (const [name, value] of Object.entries(parsed)) {
      const current = merged.get(name)
      if (current !== undefined && JSON.stringify(current) !== JSON.stringify(value)) {
        return false
      }
      merged.set(name, value)
    }
  }
  return true
}

function parseMatchGroupKey(key: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(key)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function mergeMatchGroupKeys(keys: string[]) {
  const merged: Record<string, unknown> = {}
  for (const key of keys) {
    if (key === WILDCARD_MATCH_GROUP_KEY) {
      continue
    }
    Object.assign(merged, parseMatchGroupKey(key) ?? {})
  }
  return merged
}

function eventVariableHasMatchVariables(plan: YaralRuntimePlan, eventVariable: string) {
  return plan.match?.variables.some((variable) =>
    matchVariableUsesEventVariable(plan, variable, eventVariable)
  ) ?? false
}

function matchVariableUsesEventVariable(
  plan: YaralRuntimePlan,
  variable: string,
  eventVariable: string
) {
  return plan.placeholders.some(
    (placeholder) =>
      placeholder.name === variable && placeholder.eventVariables.includes(eventVariable)
  )
}

function filterCrossEventPredicateEvents(
  plan: YaralRuntimePlan,
  context: EvaluationContext,
  traces: YaralEvaluationTrace[]
) {
  const predicates = plan.eventPredicates.filter(
    (predicate) => getPredicateEventVariableCount(predicate.expression, plan) > 1
  )
  if (predicates.length === 0) {
    return context
  }

  const eventVariables = [
    ...new Set(predicates.flatMap((predicate) => getPredicateEventVariables(predicate.expression, plan))),
  ]
  const candidates = eventVariables.map((eventVariable) => ({
    eventVariable,
    events: context.events[eventVariable] ?? [],
  }))
  const retainedEvents = new Map<string, Set<YaralEvaluationEvent>>(
    eventVariables.map((eventVariable) => [eventVariable, new Set<YaralEvaluationEvent>()])
  )
  const predicatePasses = new Map(predicates.map((predicate) => [predicate, false]))

  if (!candidates.some((candidate) => candidate.events.length === 0)) {
    for (const tuple of buildEventTuples(candidates)) {
      const tupleContext = createChildContext(tuple, context)
      const results = predicates.map((predicate) => ({
        passed: Boolean(evaluateExpression(predicate.expression, tupleContext)),
        predicate,
      }))
      const passedAllPredicates = results.every((result) => result.passed)
      if (!passedAllPredicates) {
        continue
      }
      for (const result of results) {
        predicatePasses.set(result.predicate, true)
      }
      for (const eventVariable of eventVariables) {
        const value = tuple[eventVariable]
        const events = Array.isArray(value) ? value : value ? [value] : []
        for (const event of events) {
          retainedEvents.get(eventVariable)?.add(event)
        }
      }
    }
  }

  for (const predicate of predicates) {
    const passed = Boolean(predicatePasses.get(predicate))
    pushTrace(traces, {
      expression: predicate.expression,
      label: "events:cross",
      passed,
      value: passed,
    })
  }

  if ([...retainedEvents.values()].some((events) => events.size === 0)) {
    return null
  }

  return createChildContext(
    Object.fromEntries(
      Object.entries(context.events).map(([eventVariable, events]) => {
        const retained = retainedEvents.get(eventVariable)
        return [
          eventVariable,
          retained ? events.filter((event) => retained.has(event)) : events,
        ]
      })
    ),
    context
  )
}

function predicateAppliesToSingleEventVariable(
  plan: YaralRuntimePlan,
  predicate: YaralRuntimePlan["eventPredicates"][number],
  eventVariable: string
) {
  const eventVariables = getPredicateEventVariables(predicate.expression, plan)
  if (eventVariables.length > 1) {
    return false
  }
  if (eventVariables.length === 1) {
    return eventVariables[0] === eventVariable
  }
  return predicate.eventVariable === eventVariable
}

function createChildContext(
  eventValues: Record<string, YaralEvaluationEvent | YaralEvaluationEvent[]>,
  parent: EvaluationContext
) {
  const child = createContext(
    eventValues,
    parent.dataTables,
    parent.diagnostics,
    parent.unsupportedFunctions,
    parent.plan,
    parent.runtimeSources,
    parent.windowBoundaries
  )
  Object.assign(child.placeholders, parent.placeholders)
  Object.assign(child.outcomes, parent.outcomes)
  return child
}

const predicateEventVariableCache = new WeakMap<YaralRuntimePlan, WeakMap<YaralExpression, string[]>>()

function getPredicateEventVariableCount(expression: YaralExpression, plan: YaralRuntimePlan | null = null) {
  return getPredicateEventVariables(expression, plan).length
}

function getPredicateEventVariables(
  expression: YaralExpression,
  plan: YaralRuntimePlan | null = null
) {
  if (plan) {
    let planCache = predicateEventVariableCache.get(plan)
    if (!planCache) {
      planCache = new WeakMap()
      predicateEventVariableCache.set(plan, planCache)
    }
    const cached = planCache.get(expression)
    if (cached) {
      return cached
    }
    const eventVariables = getUncachedPredicateEventVariables(expression, plan)
    planCache.set(expression, eventVariables)
    return eventVariables
  }
  return getUncachedPredicateEventVariables(expression, null)
}

function getUncachedPredicateEventVariables(
  expression: YaralExpression,
  plan: YaralRuntimePlan | null
) {
  return [
    ...new Set(
      collectVariableExpressions(expression)
        .filter((variable) => variable.kind === "variable")
        .flatMap((variable) => {
          if (variable.path.length > 0) {
            return [variable.name]
          }
          return plan?.placeholders
            .filter((placeholder) => placeholder.name === variable.name)
            .flatMap((placeholder) => placeholder.eventVariables) ?? []
        })
    ),
  ]
}

function evaluateMatchVariable(
  plan: YaralRuntimePlan,
  variable: string,
  eventVariable: string,
  context: EvaluationContext
) {
  const placeholder = plan.placeholders.find(
    (item) => item.name === variable && item.eventVariables.includes(eventVariable)
  )
  return placeholder ? evaluateExpression(placeholder.expression, context) : undefined
}

function getWindowedEventSets(
  plan: YaralRuntimePlan,
  eventSets: Record<string, YaralEvaluationEvent[]>,
  requiredEventVariables: Set<string>,
  evaluationRange: NormalizedEvaluationRange | null,
  diagnostics: YaralDiagnostic[],
  experimentalDiagnostics: boolean
): Array<{ boundaries: WindowBoundaryValues | null; events: Record<string, YaralEvaluationEvent[]> }> {
  const effectiveRequiredEventVariables = new Set(
    [...requiredEventVariables].filter((eventVariable) => eventVariable in eventSets)
  )

  if (!plan.match?.durationMinutes || !plan.match.kind) {
    return hasRequiredEvents(eventSets, effectiveRequiredEventVariables)
      ? [{ boundaries: null, events: eventSets }]
      : []
  }

  const durationMs = plan.match.durationMinutes * 60 * 1000
  const timedEvents = Object.entries(eventSets).flatMap(([eventVariable, events]) =>
    events.map((event) => ({
      event,
      eventVariable,
      timestamp: getEventTimestampMs(event),
    }))
  )

  if (timedEvents.length === 0) {
    if (plan.match.kind === "tumbling" && evaluationRange) {
      return buildWindowedEventSets(
        buildTumblingWindows([], durationMs, evaluationRange),
        eventSets,
        effectiveRequiredEventVariables
      )
    }
    return hasRequiredEvents(eventSets, effectiveRequiredEventVariables)
      ? [{ boundaries: null, events: eventSets }]
      : []
  }

  const concreteTimedEvents = timedEvents.filter(
    (event): event is { event: YaralEvaluationEvent; eventVariable: string; timestamp: number } =>
      event.timestamp !== null
  )
  if (concreteTimedEvents.length === 0) {
    if (experimentalDiagnostics) {
      pushRuntimeWarningOnce(
        diagnostics,
        "No events in this local match-window test have parseable timestamps; RuleLab fell back to non-windowed grouping."
      )
    }
    return hasRequiredEvents(eventSets, effectiveRequiredEventVariables)
      ? [{ boundaries: null, events: eventSets }]
      : []
  }
  if (experimentalDiagnostics && concreteTimedEvents.length < timedEvents.length) {
    pushRuntimeWarningOnce(
      diagnostics,
      "Some events in this local match-window test do not have parseable timestamps and were excluded from timestamp-window evaluation."
    )
  }
  const windows =
    plan.match.kind === "sliding" && plan.match.pivotEvent
      ? buildSlidingWindows(
          concreteTimedEvents,
          plan.match.pivotEvent,
          plan.match.pivotDirection,
          durationMs
        )
      : plan.match.kind === "tumbling"
        ? buildTumblingWindows(concreteTimedEvents, durationMs, evaluationRange)
        : buildHopWindows(concreteTimedEvents, durationMs, evaluationRange)

  return buildWindowedEventSets(
    windows,
    eventSets,
    effectiveRequiredEventVariables,
    {
      preserveSameEventWindows: planUsesWindowBoundaries(plan),
      pruneStrictSubsets: plan.match.kind !== "sliding",
    }
  )
}

function buildWindowedEventSets(
  windows: TimedWindow[],
  eventSets: Record<string, YaralEvaluationEvent[]>,
  effectiveRequiredEventVariables: Set<string>,
  options: { preserveSameEventWindows?: boolean; pruneStrictSubsets?: boolean } = {}
) {
  const uniqueWindows = new Map<string, { boundaries: WindowBoundaryValues; events: Record<string, YaralEvaluationEvent[]> }>()
  const candidateWindows = options.pruneStrictSubsets === false ? windows : removeStrictSubsetWindows(windows)
  for (const window of candidateWindows) {
    const nextEventSets = fillMissingEventSetKeys(
      groupTimedEventsByVariable(window.events),
      eventSets
    )
    if (!hasRequiredEvents(nextEventSets, effectiveRequiredEventVariables)) {
      continue
    }
    const key = options.preserveSameEventWindows
      ? JSON.stringify({ events: nextEventSets, windowEnd: window.endMs, windowStart: window.startMs })
      : JSON.stringify({ events: nextEventSets })
    uniqueWindows.set(key, {
      boundaries: createWindowBoundaryValues(window.startMs, window.endMs),
      events: nextEventSets,
    })
  }

  return [...uniqueWindows.values()]
}

function removeStrictSubsetWindows(windows: TimedWindow[]) {
  const windowSets = windows.map((window) => new Set(window.events))
  return windows.filter((window, index) =>
    window.events.length === 0 ||
    !windowSets.some((otherSet, otherIndex) =>
      otherIndex !== index &&
      otherSet.size > window.events.length &&
      window.events.every((event) => otherSet.has(event))
    )
  )
}

function buildHopWindows(
  events: TimedEvent[],
  durationMs: number,
  evaluationRange: NormalizedEvaluationRange | null = null
) {
  const sortedEvents = [...events].sort((left, right) => left.timestamp - right.timestamp)
  if (sortedEvents.length === 0) {
    return []
  }

  const stepMs = Math.max(1, Math.floor(durationMs / HOP_WINDOW_STEP_DIVISOR))
  const firstTimestamp = sortedEvents[0]?.timestamp ?? 0
  const lastTimestamp = sortedEvents.at(-1)?.timestamp ?? firstTimestamp
  const anchorMs = evaluationRange?.startMs ?? 0
  const firstStart = alignWindowStart(
    evaluationRange?.startMs ?? firstTimestamp - durationMs,
    anchorMs,
    stepMs
  )
  const lastStart = evaluationRange?.endMs
    ? evaluationRange.endMs
    : alignWindowStart(lastTimestamp, anchorMs, stepMs)
  const windows: TimedWindow[] = []

  for (let startMs = firstStart; startMs <= lastStart; startMs += stepMs) {
    const endMs = startMs + durationMs
    const windowEvents = sortedEvents.filter(
      (event) => event.timestamp >= startMs && event.timestamp <= endMs
    )
    if (windowEvents.length > 0) {
      windows.push({ endMs, events: windowEvents, startMs })
    }
  }

  return windows
}

function alignWindowStart(timestampMs: number, anchorMs: number, stepMs: number) {
  return anchorMs + Math.floor((timestampMs - anchorMs) / stepMs) * stepMs
}

function planUsesWindowBoundaries(plan: YaralRuntimePlan) {
  let usesBoundary = false
  const inspect = (expression: YaralExpression | null) => {
    if (!expression || usesBoundary) {
      return
    }
    walkExpression(expression, (node) => {
      if (
        node.kind === "identifier" &&
        (node.name === "window_start" || node.name === "window_end")
      ) {
        usesBoundary = true
      }
    })
  }

  inspect(plan.condition)
  for (const outcome of plan.outcomes) {
    inspect(outcome.expression)
  }
  return usesBoundary
}

function buildSlidingWindows(
  events: TimedEvent[],
  pivotEventVariable: string,
  pivotDirection: "after" | "before" | null,
  durationMs: number
) {
  const pivots = events.filter((event) => event.eventVariable === pivotEventVariable)
  return pivots.map((pivot) => {
    const start =
      pivotDirection === "before" ? pivot.timestamp - durationMs : pivot.timestamp
    const end =
      pivotDirection === "before" ? pivot.timestamp : pivot.timestamp + durationMs
    return {
      endMs: end,
      events: events.filter((event) => event.timestamp >= start && event.timestamp <= end),
      startMs: start,
    }
  })
}

function buildTumblingWindows(
  events: TimedEvent[],
  durationMs: number,
  evaluationRange: NormalizedEvaluationRange | null = null
) {
  const buckets = new Map<number, typeof events>()
  for (const event of events) {
    const bucket = Math.floor(event.timestamp / durationMs)
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), event])
  }
  if (evaluationRange) {
    const startBucket = Math.floor(evaluationRange.startMs / durationMs)
    const endBucket = Math.ceil(evaluationRange.endMs / durationMs) - 1
    for (let bucket = startBucket; bucket <= endBucket; bucket += 1) {
      if (!buckets.has(bucket)) {
        buckets.set(bucket, [])
      }
    }
  }
  return [...buckets.entries()].map(([bucket, events]) => ({
    endMs: (bucket + 1) * durationMs,
    events,
    startMs: bucket * durationMs,
  }))
}

function groupTimedEventsByVariable(
  events: Array<{ event: YaralEvaluationEvent; eventVariable: string }>
) {
  const result: Record<string, YaralEvaluationEvent[]> = {}
  for (const event of events) {
    result[event.eventVariable] = [...(result[event.eventVariable] ?? []), event.event]
  }
  return result
}

function fillMissingEventSetKeys(
  grouped: Record<string, YaralEvaluationEvent[]>,
  source: Record<string, YaralEvaluationEvent[]>
) {
  return Object.fromEntries(
    Object.keys(source).map((eventVariable) => [
      eventVariable,
      grouped[eventVariable] ?? [],
    ])
  )
}

function createWindowBoundaryValues(startMs: number, endMs: number): WindowBoundaryValues {
  return {
    end: new Date(endMs).toISOString(),
    start: new Date(startMs).toISOString(),
  }
}

function hasRequiredEvents(
  eventSets: Record<string, YaralEvaluationEvent[]>,
  requiredEventVariables: Set<string>
) {
  return [...requiredEventVariables].every(
    (eventVariable) => (eventSets[eventVariable]?.length ?? 0) > 0
  )
}

function getEventTimestampMs(event: YaralEvaluationEvent) {
  const value =
    getEventField(event, "metadata.event_timestamp") ??
    getEventField(event, "metadata.collected_timestamp") ??
    getEventField(event, "metadata.ingested_timestamp") ??
    getEventField(event, "event_timestamp") ??
    getEventField(event, "timestamp")

  if (Array.isArray(value)) {
    for (const item of value) {
      const timestamp = getTimestampMs(item)
      if (timestamp !== null) {
        return timestamp
      }
    }
    return null
  }
  return getTimestampMs(value)
}

function getTimestampMs(value: unknown) {
  if (typeof value === "number") {
    return value > 10_000_000_000 ? value : value * 1000
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (value && typeof value === "object") {
    const seconds = (value as Record<string, unknown>).seconds
    const nanos = (value as Record<string, unknown>).nanos
    if (typeof seconds === "number") {
      return seconds * 1000 + (typeof nanos === "number" ? nanos / 1_000_000 : 0)
    }
    if (typeof seconds === "string") {
      const parsedSeconds = Number(seconds)
      return Number.isFinite(parsedSeconds)
        ? parsedSeconds * 1000 + (typeof nanos === "number" ? nanos / 1_000_000 : 0)
        : null
    }
  }
  return null
}

function createSingleEventContext(
  plan: YaralRuntimePlan,
  event: YaralEvaluationEvent,
  dataTables: DataTableLookup = {},
  diagnostics: YaralDiagnostic[] = [],
  unsupportedFunctions = new Set<string>(),
  runtimeSources: YaralEvaluationRuntimeSources = createRuntimeSources()
): EvaluationContext {
  const eventVariables = [
    ...new Set([
      ...plan.eventPredicates
        .map((predicate) => predicate.eventVariable)
        .filter((name): name is string => Boolean(name)),
      ...plan.placeholders.flatMap((placeholder) => placeholder.eventVariables),
    ]),
  ]

  return createContext(
    Object.fromEntries(eventVariables.map((name) => [name, event])),
    dataTables,
    diagnostics,
    unsupportedFunctions,
    plan,
    runtimeSources
  )
}

function createContext(
  eventValues: Record<string, YaralEvaluationEvent | YaralEvaluationEvent[]>,
  dataTables: DataTableLookup = {},
  diagnostics: YaralDiagnostic[] = [],
  unsupportedFunctions = new Set<string>(),
  plan: YaralRuntimePlan | null = null,
  runtimeSources: YaralEvaluationRuntimeSources = createRuntimeSources(),
  windowBoundaries: WindowBoundaryValues | null = null
): EvaluationContext {
  return {
    dataTables,
    diagnostics,
    events: Object.fromEntries(
      Object.entries(eventValues).map(([name, event]) => [
        name,
        Array.isArray(event) ? event : [event],
      ])
    ),
    eventValues: Object.fromEntries(
      Object.entries(eventValues).map(([name, event]) => [
        name,
        Array.isArray(event) ? event[0] : event,
      ])
    ),
    outcomes: {},
    plan,
    placeholders: {},
    runtimeSources,
    unsupportedFunctions,
    windowBoundaries,
  }
}

function createRuntimeSources(
  options: Pick<YaralEvaluationOptions, "nowMs" | "random"> = {}
): YaralEvaluationRuntimeSources {
  return {
    nowMs: options.nowMs ?? (() => Date.now()),
    random: options.random ?? (() => Math.random()),
  }
}

function normalizeEvaluationRange(
  range: YaralEvaluationRange | undefined
): NormalizedEvaluationRange | null {
  if (!range) {
    return null
  }
  const startMs = parseEvaluationRangeBoundary(range.start)
  const endMs = parseEvaluationRangeBoundary(range.end)
  if (startMs === null || endMs === null || endMs <= startMs) {
    return null
  }
  return { endMs, startMs }
}

function parseEvaluationRangeBoundary(value: number | string) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function shouldEvaluateAsEventSet(plan: YaralRuntimePlan) {
  return plan.outcomes.some((outcome) => outcome.aggregate) || containsCountCondition(plan.condition)
}

function containsCountCondition(expression: YaralExpression | null): boolean {
  if (!expression) {
    return false
  }
  if (expression.kind === "countVariable") {
    return true
  }
  if (expression.kind === "array") {
    return expression.elements.some(containsCountCondition)
  }
  if (expression.kind === "binary") {
    return containsCountCondition(expression.left) || containsCountCondition(expression.right)
  }
  if (expression.kind === "call") {
    return expression.args.some(containsCountCondition)
  }
  if (expression.kind === "group") {
    return containsCountCondition(expression.expression)
  }
  if (expression.kind === "of") {
    return (
      expression.variables.some((variable) => variable.kind === "countVariable") ||
      expression.expressions.some(containsCountCondition)
    )
  }
  if (expression.kind === "unary") {
    return containsCountCondition(expression.argument)
  }
  return false
}

function evaluatePlaceholders(plan: YaralRuntimePlan, context: EvaluationContext) {
  const values: Record<string, unknown> = {}
  for (const placeholder of plan.placeholders) {
    const value = evaluateExpression(placeholder.expression, context)
    if (hasPlaceholderValue(value) || !hasPlaceholderValue(values[placeholder.name])) {
      values[placeholder.name] = value
    }
  }
  return values
}

function hasPlaceholderValue(value: unknown) {
  return value !== undefined && value !== null && value !== ""
}

function evaluateOutcomes(plan: YaralRuntimePlan, context: EvaluationContext) {
  const values: Record<string, unknown> = {}
  for (const outcome of plan.outcomes) {
    values[outcome.name] = outcome.aggregate
      ? evaluateAggregateExpression(outcome.expression, context, plan)
      : evaluateExpression(outcome.expression, context)
    context.outcomes[outcome.name] = values[outcome.name]
  }
  return values
}

function evaluateAggregateExpression(
  expression: YaralExpression,
  context: EvaluationContext,
  plan: YaralRuntimePlan
): unknown {
  if (expression.kind === "array") {
    return expression.elements.map((element) => evaluateAggregateExpression(element, context, plan))
  }
  if (expression.kind === "binary") {
    if (expression.operator.toLowerCase() === "and") {
      return Boolean(evaluateAggregateExpression(expression.left, context, plan)) &&
        Boolean(evaluateAggregateExpression(expression.right, context, plan))
    }
    if (expression.operator.toLowerCase() === "or") {
      return Boolean(evaluateAggregateExpression(expression.left, context, plan)) ||
        Boolean(evaluateAggregateExpression(expression.right, context, plan))
    }
    const left = evaluateAggregateExpression(expression.left, context, plan)
    const right = evaluateAggregateExpression(expression.right, context, plan)
    return evaluateBinaryValues(expression.operator, left, right, Boolean(expression.nocase))
  }
  if (expression.kind === "group") {
    return evaluateAggregateExpression(expression.expression, context, plan)
  }
  if (expression.kind === "of") {
    const matches = expression.expressions.filter((element) =>
      Boolean(evaluateAggregateExpression(element, context, plan))
    ).length
    if (expression.quantifier === "all") {
      return matches === expression.expressions.length
    }
    if (expression.quantifier === "any") {
      return matches > 0
    }
    return matches >= expression.quantifier
  }
  if (expression.kind === "repeated") {
    return createRepeatedEvaluationValue(
      expression.quantifier,
      evaluateAggregateExpression(expression.argument, context, plan)
    )
  }
  if (expression.kind === "unary") {
    const value = evaluateAggregateExpression(expression.argument, context, plan)
    return expression.operator === "!" || expression.operator.toLowerCase() === "not"
      ? !value
      : value
  }
  if (expression.kind === "call") {
    const callee = expression.callee.toLowerCase()
    if (callee.startsWith("window.")) {
      return evaluateWindowAggregate(callee, expression.args, context, plan)
    }
    if (callee === "count" || callee === "count_distinct") {
      const values = expression.args.flatMap((arg) => collectAggregateValues(arg, context, plan))
      return callee === "count_distinct" ? distinctValues(values).length : values.length
    }
    if (callee === "array" || callee === "array_distinct") {
      const values = expression.args.flatMap((arg) => collectAggregateValues(arg, context, plan))
      const arrayValues = callee === "array_distinct" ? distinctValues(values) : values
      return arrayValues.slice(0, OUTCOME_ARRAY_AGGREGATE_LIMIT)
    }
    if (["avg", "max", "min", "stdev", "stddev", "sum"].includes(callee)) {
      const values = expression.args.flatMap((arg) => collectAggregateValues(arg, context, plan))
      return evaluateNumericAggregate(callee, values)
    }

    if (isYaralUnsupportedRuntimeFunction(expression.callee)) {
      reportUnsupportedRuntimeFunction(expression.callee, expression, context)
      return null
    }
    reportApproximateRuntimeFunction(expression.callee, expression, context)

    const runtimeFunction = getYaralRuntimeFunction(expression.callee)
    if (runtimeFunction) {
      return runtimeFunction(
        expression.args.map((arg) => evaluateAggregateExpression(arg, context, plan)),
        { nocase: Boolean(expression.nocase), runtimeSources: context.runtimeSources }
      )
    }
  }

  return evaluateExpression(expression, context)
}

function evaluateNumericAggregate(callee: string, values: unknown[]) {
  const numbers = values.map(toNumber).filter((value) => Number.isFinite(value))
  if (numbers.length === 0) {
    return 0
  }

  switch (callee) {
    case "avg":
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    case "max":
      return Math.max(...numbers)
    case "min":
      return Math.min(...numbers)
    case "stdev":
    case "stddev": {
      const average = numbers.reduce((sum, value) => sum + value, 0) / numbers.length
      const variance =
        numbers.reduce((sum, value) => sum + (value - average) ** 2, 0) / numbers.length
      return Math.sqrt(variance)
    }
    case "variance": {
      const average = numbers.reduce((sum, value) => sum + value, 0) / numbers.length
      return numbers.reduce((sum, value) => sum + (value - average) ** 2, 0) / numbers.length
    }
    case "sum":
      return numbers.reduce((sum, value) => sum + value, 0)
    default:
      return 0
  }
}

function distinctValues(values: unknown[]) {
  const seen = new Set<string>()
  const result: unknown[] = []
  for (const value of values) {
    const key = stableOutcomeValueKey(value)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(value)
  }
  return result
}

function stableOutcomeValueKey(value: unknown): string {
  if (value === null) {
    return "null:null"
  }
  if (Array.isArray(value)) {
    return `array:${JSON.stringify(value.map(stableOutcomeValueKey))}`
  }
  if (typeof value === "object") {
    return `object:${JSON.stringify(sortRecordForOutcomeKey(value as Record<string, unknown>))}`
  }
  return `${typeof value}:${String(value)}`
}

function sortRecordForOutcomeKey(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeOutcomeKeyValue(item)])
  )
}

function normalizeOutcomeKeyValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeOutcomeKeyValue)
  }
  if (value && typeof value === "object") {
    return sortRecordForOutcomeKey(value as Record<string, unknown>)
  }
  return value
}

function evaluateWindowAggregate(
  callee: string,
  args: YaralExpression[],
  context: EvaluationContext,
  plan: YaralRuntimePlan
) {
  const values = collectAggregateValues(args[0], context, plan)
  const numericValues = getWindowNumericValues(values, shouldIgnoreWindowZeroValues(args, context))

  switch (callee) {
    case "window.avg":
      return evaluateNumericAggregate("avg", numericValues)
    case "window.median":
      return median(numericValues)
    case "window.mode":
      return mode(values)
    case "window.range": {
      const numbers = numericValues.map(toNumber).filter((value) => Number.isFinite(value))
      return numbers.length ? Math.max(...numbers) - Math.min(...numbers) : 0
    }
    case "window.stddev":
      return evaluateNumericAggregate("stddev", values)
    case "window.variance":
      return evaluateNumericAggregate("variance", values)
    case "window.first":
      return firstOrLastWindowValue(args, context, plan, "first")
    case "window.last":
      return firstOrLastWindowValue(args, context, plan, "last")
    default:
      return null
  }
}

function shouldIgnoreWindowZeroValues(args: YaralExpression[], context: EvaluationContext) {
  const expression = args[1]
  return expression ? Boolean(evaluateExpression(expression, context)) : false
}

function getWindowNumericValues(values: unknown[], ignoreZeroValues: boolean) {
  if (!ignoreZeroValues) {
    return values
  }
  return values.filter((value) => toNumber(value) !== 0)
}

function median(values: unknown[]) {
  const numbers = values.map(toNumber).filter((value) => Number.isFinite(value)).sort((left, right) => left - right)
  if (numbers.length === 0) {
    return 0
  }
  const middle = Math.floor(numbers.length / 2)
  if (numbers.length % 2 === 1) {
    return numbers[middle] ?? 0
  }
  return ((numbers[middle - 1] ?? 0) + (numbers[middle] ?? 0)) / 2
}

function mode(values: unknown[]) {
  const counts = new Map<string, { count: number; value: unknown }>()
  for (const value of values) {
    const key = JSON.stringify(value)
    const previous = counts.get(key)
    counts.set(key, { count: (previous?.count ?? 0) + 1, value })
  }
  return [...counts.values()].sort((left, right) => right.count - left.count)[0]?.value ?? null
}

function firstOrLastWindowValue(
  args: YaralExpression[],
  context: EvaluationContext,
  plan: YaralRuntimePlan,
  direction: "first" | "last"
) {
  const sortExpression = args[0]
  const valueExpression = args[1] ?? args[0]
  const eventVariable =
    getSingleAggregateEventVariable(valueExpression, plan) ??
    getSingleAggregateEventVariable(sortExpression, plan)
  if (eventVariable) {
    const pairs = (context.events[eventVariable] ?? []).flatMap((event, index) => {
      const eventContext = createContext(
        { [eventVariable]: event },
        context.dataTables,
        context.diagnostics,
        context.unsupportedFunctions,
        plan,
        context.runtimeSources,
        context.windowBoundaries
      )
      const values = evaluateAggregateEventValues(valueExpression, eventVariable, eventContext, plan)
      const orderValues = evaluateAggregateEventValues(sortExpression, eventVariable, eventContext, plan)
      const order = toSortableWindowValue(orderValues[0] ?? index)
      return values.map((value) => ({ order, value }))
    })
    pairs.sort((left, right) => left.order - right.order)
    return direction === "first" ? pairs[0]?.value ?? null : pairs[pairs.length - 1]?.value ?? null
  }

  const values = collectAggregateValues(valueExpression, context, plan)
  const orderValues = collectAggregateValues(sortExpression, context, plan)
  const pairs = values.map((value, index) => ({
    order: toSortableWindowValue(orderValues[index] ?? index),
    value,
  }))
  pairs.sort((left, right) => left.order - right.order)
  return direction === "first" ? pairs[0]?.value ?? null : pairs[pairs.length - 1]?.value ?? null
}

function getSingleAggregateEventVariable(expression: YaralExpression | undefined, plan: YaralRuntimePlan) {
  if (!expression) {
    return null
  }
  if (expression.kind === "variable" && expression.path.length > 0) {
    return expression.name
  }
  if (expression.kind === "variable" && expression.path.length === 0) {
    const placeholder = plan.placeholders.find((item) => item.name === expression.name)
    return placeholder?.eventVariables.length === 1
      ? placeholder.eventVariables[0] ?? null
      : null
  }
  const eventVariables = getExpressionEventVariables(expression)
  return eventVariables.length === 1 ? eventVariables[0] ?? null : null
}

function evaluateAggregateEventValues(
  expression: YaralExpression,
  eventVariable: string,
  context: EvaluationContext,
  plan: YaralRuntimePlan
) {
  if (expression.kind === "variable" && expression.path.length === 0) {
    const placeholder = plan.placeholders.find(
      (item) => item.name === expression.name && item.eventVariables.includes(eventVariable)
    )
    if (placeholder) {
      return toResolvedValues(evaluateExpression(placeholder.expression, context))
        .filter((value) => value !== undefined && value !== null)
    }
  }

  return toResolvedValues(evaluateExpression(expression, context))
    .filter((value) => value !== undefined && value !== null)
}

function toSortableWindowValue(value: unknown) {
  if (typeof value === "number") {
    return value
  }
  const date = new Date(String(value ?? ""))
  if (!Number.isNaN(date.getTime())) {
    return date.getTime()
  }
  return toNumber(value)
}

function collectAggregateValues(
  expression: YaralExpression,
  context: EvaluationContext,
  plan: YaralRuntimePlan
) {
  if (expression.kind === "variable" && expression.path.length > 0) {
    return (context.events[expression.name] ?? [])
      .flatMap((event) => toResolvedValues(getEventField(event, expression.path)))
      .filter((value) => value !== undefined && value !== null)
  }
  if (expression.kind === "variable" && expression.path.length === 0) {
    const placeholder = plan.placeholders.find((item) => item.name === expression.name)
    if (placeholder && placeholder.eventVariables.length === 1) {
      const eventVariable = placeholder.eventVariables[0]
      return (context.events[eventVariable] ?? [])
        .map((event) =>
          evaluateExpression(
            placeholder.expression,
            createContext(
              { [eventVariable]: event },
              context.dataTables,
              context.diagnostics,
              context.unsupportedFunctions,
              plan,
              context.runtimeSources
            )
          )
        )
        .filter((value) => value !== undefined && value !== null)
    }
  }
  const eventVariables = getExpressionEventVariables(expression)
  if (eventVariables.length === 1) {
    const eventVariable = eventVariables[0]
    return (context.events[eventVariable] ?? [])
      .map((event) =>
        evaluateExpression(
          expression,
          createContext(
            { [eventVariable]: event },
            context.dataTables,
            context.diagnostics,
            context.unsupportedFunctions,
            plan,
            context.runtimeSources
          )
        )
      )
      .flatMap((value) => toResolvedValues(value))
      .filter((value) => value !== undefined && value !== null)
  }

  return [evaluateExpression(expression, context)].filter(
    (value) => value !== undefined && value !== null
  )
}

function getExpressionEventVariables(expression: YaralExpression) {
  const variables = new Set<string>()

  function visit(expression: YaralExpression) {
    switch (expression.kind) {
      case "array":
        expression.elements.forEach(visit)
        break
      case "binary":
        visit(expression.left)
        visit(expression.right)
        break
      case "call":
        expression.args.forEach(visit)
        break
      case "group":
        visit(expression.expression)
        break
      case "repeated":
        visit(expression.argument)
        break
      case "unary":
        visit(expression.argument)
        break
      case "variable":
        if (expression.path.length > 0) {
          variables.add(expression.name)
        }
        break
    }
  }

  visit(expression)
  return [...variables]
}

function getEventVariableNames(plan: YaralRuntimePlan) {
  return [
    ...new Set([
      ...plan.eventPredicates
        .map((predicate) => predicate.eventVariable)
        .filter((name): name is string => Boolean(name)),
      ...plan.placeholders.flatMap((placeholder) => placeholder.eventVariables),
    ]),
  ].sort()
}

function buildEventTuples(
  candidates: Array<{ eventVariable: string; events: YaralEvaluationEvent[] }>
) {
  const tuples: Array<Record<string, YaralEvaluationEvent | YaralEvaluationEvent[]>> = []

  function visit(
    index: number,
    current: Record<string, YaralEvaluationEvent | YaralEvaluationEvent[]>
  ) {
    const candidate = candidates[index]
    if (!candidate) {
      tuples.push({ ...current })
      return
    }

    if (candidate.events.length === 0) {
      current[candidate.eventVariable] = []
      visit(index + 1, current)
      delete current[candidate.eventVariable]
      return
    }

    for (const event of candidate.events) {
      current[candidate.eventVariable] = event
      visit(index + 1, current)
    }
    delete current[candidate.eventVariable]
  }

  visit(0, {})
  return tuples
}

function getRequiredConditionEventVariables(expression: YaralExpression | null) {
  function collect(expression: YaralExpression | null, negated: boolean): Set<string> {
    const required = new Set<string>()
    if (!expression) {
      return required
    }

    switch (expression.kind) {
      case "array":
        expression.elements.forEach((element) => addAll(required, collect(element, negated)))
        break
      case "binary": {
        const operator = expression.operator.toLowerCase()
        const left = collect(expression.left, negated)
        const right = collect(expression.right, negated)
        if (!negated && operator === "or") {
          return intersectSets(left, right)
        }
        addAll(required, left)
        addAll(required, right)
        break
      }
      case "call":
        expression.args.forEach((arg) => addAll(required, collect(arg, negated)))
        break
      case "countVariable":
        if (!negated) {
          required.add(expression.name)
        }
        break
      case "group":
        addAll(required, collect(expression.expression, negated))
        break
      case "of":
        if (!negated) {
          const expressionSets = expression.expressions.map((element) => collect(element, negated))
          if (expression.quantifier === "all") {
            expressionSets.forEach((set) => addAll(required, set))
          } else if (expression.quantifier === "any") {
            return intersectMany(expressionSets)
          }
        }
        break
      case "repeated":
        addAll(required, collect(expression.argument, negated))
        break
      case "unary":
        addAll(required, collect(
          expression.argument,
          expression.operator === "!" || expression.operator.toLowerCase() === "not"
            ? !negated
            : negated
        ))
        break
      case "variable":
        if (!negated && expression.path.length === 0) {
          required.add(expression.name)
        }
        break
      default:
        break
    }
    return required
  }

  return collect(expression, false)
}

function addAll(target: Set<string>, source: Set<string>) {
  for (const item of source) {
    target.add(item)
  }
}

function intersectSets(left: Set<string>, right: Set<string>) {
  return new Set([...left].filter((item) => right.has(item)))
}

function intersectMany(sets: Set<string>[]) {
  const [first, ...rest] = sets
  if (!first) {
    return new Set<string>()
  }
  return new Set([...first].filter((item) => rest.every((set) => set.has(item))))
}

function joinsMatch(plan: YaralRuntimePlan, context: EvaluationContext) {
  for (const join of plan.joins) {
    const activeEventVariables = join.eventVariables.filter(
      (eventVariable) => (context.events[eventVariable]?.length ?? 0) > 0
    )
    if (activeEventVariables.length <= 1) {
      continue
    }

    const values = activeEventVariables.map((eventVariable) => {
      const placeholder = plan.placeholders.find(
        (item) => item.name === join.placeholder && item.eventVariables.includes(eventVariable)
      )
      return placeholder ? evaluateExpression(placeholder.expression, context) : undefined
    })

    const [first, ...rest] = values
    if (first === undefined || rest.some((value) => !compareEqual(value, first))) {
      return false
    }
    context.placeholders[join.placeholder] = first
  }

  return true
}

function evaluateExpression(expression: YaralExpression, context: EvaluationContext): unknown {
  switch (expression.kind) {
    case "array":
      return expression.elements.map((element) => evaluateExpression(element, context))
    case "assignment":
      return evaluateBinaryExpression(
        expression.operator,
        expression.left,
        expression.right,
        context,
        Boolean(expression.nocase)
      )
    case "binary":
      return evaluateBinaryExpression(
        expression.operator,
        expression.left,
        expression.right,
        context,
        Boolean(expression.nocase)
      )
    case "call":
      return evaluateCall(expression, context)
    case "countVariable":
      return evaluateCountVariable(expression.name, context)
    case "group":
      return evaluateExpression(expression.expression, context)
    case "identifier":
      if (expression.name === "window_start") {
        return context.windowBoundaries?.start ?? null
      }
      if (expression.name === "window_end") {
        return context.windowBoundaries?.end ?? null
      }
      return expression.name
    case "literal":
      return evaluateLiteral(expression.literalKind, expression.value)
    case "of":
      return evaluateOfExpression(expression, context)
    case "referenceList":
      return context.dataTables[expression.name] ?? []
    case "repeated":
      return createRepeatedEvaluationValue(
        expression.quantifier,
        evaluateExpression(expression.argument, context)
      )
    case "unary": {
      const value = evaluateExpression(expression.argument, context)
      return expression.operator === "!" || expression.operator.toLowerCase() === "not"
        ? !value
        : value
    }
    case "variable":
      if (expression.path.length > 0) {
        return getEventField(context.eventValues[expression.name], expression.path)
      }
      if (Object.hasOwn(context.outcomes, expression.name)) {
        return context.outcomes[expression.name]
      }
      const scopedPlaceholder = context.plan?.placeholders.find(
        (placeholder) =>
          placeholder.name === expression.name &&
          placeholder.eventVariables.every((eventVariable) =>
            Object.hasOwn(context.eventValues, eventVariable)
          )
      )
      if (scopedPlaceholder) {
        return evaluateExpression(scopedPlaceholder.expression, context)
      }
      if (Object.hasOwn(context.placeholders, expression.name)) {
        return context.placeholders[expression.name]
      }
      return Boolean(context.events[expression.name]?.length)
  }
}

function evaluateBinaryExpression(
  operator: string,
  leftExpression: YaralExpression,
  rightExpression: YaralExpression,
  context: EvaluationContext,
  nocase = false
) {
  if (operator.toLowerCase() === "and") {
    return Boolean(evaluateExpression(leftExpression, context)) &&
      Boolean(evaluateExpression(rightExpression, context))
  }
  if (operator.toLowerCase() === "or") {
    return Boolean(evaluateExpression(leftExpression, context)) ||
      Boolean(evaluateExpression(rightExpression, context))
  }

  const left = evaluateExpression(leftExpression, context)
  const right = evaluateExpression(rightExpression, context)

  return evaluateBinaryValues(operator, left, right, nocase, rightExpression)
}

function evaluateCall(
  expression: Extract<YaralExpression, { kind: "call" }>,
  context: EvaluationContext
) {
  const callee = expression.callee
  const args = expression.args
  const nocase = Boolean(expression.nocase)
  if (isYaralUnsupportedRuntimeFunction(callee)) {
    reportUnsupportedRuntimeFunction(callee, expression, context)
    return null
  }
  reportApproximateRuntimeFunction(callee, expression, context)

  const values = args.map((arg) => evaluateExpression(arg, context))
  const runtimeFunction = getYaralRuntimeFunction(callee)
  if (runtimeFunction) {
    return runtimeFunction(values, { nocase, runtimeSources: context.runtimeSources })
  }

  return null
}

function reportApproximateRuntimeFunction(
  callee: string,
  expression: YaralExpression,
  context: EvaluationContext
) {
  if (getYaralFunctionRuntimeFidelity(callee) !== "approximate") {
    return
  }

  const message = getYaralApproximateFunctionMessage(callee)
  if (context.diagnostics.some((diagnostic) => diagnostic.message === message)) {
    return
  }

  context.diagnostics.push(createDiagnostic(expression.range, message, "warning"))
}

function reportUnsupportedRuntimeFunction(
  callee: string,
  expression: YaralExpression,
  context: EvaluationContext
) {
  const normalizedCallee = callee.toLowerCase()
  if (context.unsupportedFunctions.has(normalizedCallee)) {
    return
  }

  context.unsupportedFunctions.add(normalizedCallee)
  context.diagnostics.push(
    createDiagnostic(
      expression.range,
      `Function \`${callee}\` is recognized by the compiler but is not supported by local rule tests yet.`
    )
  )
}

function evaluateOfExpression(
  expression: Extract<YaralExpression, { kind: "of" }>,
  context: EvaluationContext
) {
  const matches = expression.expressions.filter((element) => Boolean(evaluateExpression(element, context))).length

  if (expression.quantifier === "all") {
    return matches === expression.expressions.length
  }
  if (expression.quantifier === "any") {
    return matches > 0
  }
  return matches >= expression.quantifier
}

function evaluateCountVariable(name: string, context: EvaluationContext) {
  const eventCount = context.events[name]?.length
  if (eventCount !== undefined) {
    return eventCount
  }

  const placeholder = context.plan?.placeholders.find((item) => item.name === name)
  if (!placeholder || placeholder.eventVariables.length !== 1) {
    return 0
  }

  const eventVariable = placeholder.eventVariables[0]
  return new Set(
    (context.events[eventVariable] ?? [])
      .flatMap((event) =>
        toResolvedValues(
          evaluateExpression(
            placeholder.expression,
            createContext(
              { [eventVariable]: event },
              context.dataTables,
              context.diagnostics,
              context.unsupportedFunctions,
              context.plan,
              context.runtimeSources
            )
          )
        )
      )
      .filter((value) => value !== undefined && value !== null)
      .map((value) => JSON.stringify(value))
  ).size
}

function evaluateLiteral(kind: string, value: string) {
  switch (kind) {
    case "boolean":
      return value.toLowerCase() === "true"
    case "null":
      return null
    case "number":
      return Number(value)
    case "string":
      return stripYaralStringQuotes(value)
    case "regex":
      return value
    default:
      return value
  }
}

function getEventField(event: YaralEvaluationEvent | undefined, path: string): unknown {
  if (!event) {
    return undefined
  }

  const values = resolvePathValues(event, parseEvaluationPath(path))
  if (values.length === 0) {
    return undefined
  }
  return values.length === 1 ? values[0] : values
}

function parseEvaluationPath(path: string) {
  const segments: string[] = []
  let current = ""
  for (let index = 0; index < path.length; index += 1) {
    const char = path[index]
    if (char === ".") {
      if (current) {
        segments.push(current)
        current = ""
      }
      continue
    }
    if (char === "[") {
      if (current) {
        segments.push(current)
        current = ""
      }
      const closeIndex = path.indexOf("]", index)
      if (closeIndex === -1) {
        break
      }
      const bracketValue = path.slice(index + 1, closeIndex).trim()
      const quoted = bracketValue.match(/^["'](.+)["']$/)?.[1]
      if (quoted) {
        segments.push(unescapePathSegment(quoted))
      }
      index = closeIndex
      continue
    }
    current += char
  }
  if (current) {
    segments.push(current)
  }
  return segments.filter(Boolean)
}

function unescapePathSegment(value: string) {
  return value.replace(/\\(["'\\])/g, "$1")
}

function resolvePathValues(value: unknown, path: string[]): unknown[] {
  if (path.length === 0) {
    return value === undefined || value === null ? [] : [value]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => resolvePathValues(item, path))
  }
  if (!value || typeof value !== "object") {
    return []
  }

  const [segment, ...rest] = path
  return resolvePathValues((value as Record<string, unknown>)[segment ?? ""], rest)
}

function toResolvedValues(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value]
}

function createDataTableLookup(dataTables: YaralEvaluationDataTable[]) {
  const lookup: DataTableLookup = {}
  for (const table of dataTables) {
    lookup[table.name] = createDataTableLookupEntry(table.rows.flatMap(extractDataTableLookupValues))

    for (const column of getDataTableColumns(table.rows)) {
      lookup[`${table.name}.${column}`] = createDataTableLookupEntry(
        table.rows.flatMap((row) => extractDataTableColumnValues(row, column))
      )
    }
  }
  return lookup
}

function extractDataTableLookupValues(row: unknown): unknown[] {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return [row]
  }

  return [...new Set(collectDataTableScalarValues(row))]
}

function collectDataTableScalarValues(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return []
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectDataTableScalarValues)
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectDataTableScalarValues)
  }
  return [value]
}

function getDataTableColumns(rows: unknown[]) {
  const columns = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue
    }
    collectDataTableColumnPaths(row, "", columns)
  }
  return columns
}

function collectDataTableColumnPaths(value: unknown, prefix: string, columns: Set<string>) {
  if (!value || typeof value !== "object") {
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDataTableColumnPaths(item, prefix, columns)
    }
    return
  }

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    columns.add(path)
    collectDataTableColumnPaths(child, path, columns)
  }
}

function extractDataTableColumnValues(row: unknown, column: string): unknown[] {
  return extractDataTablePathValues(row, column.split("."))
}

function extractDataTablePathValues(value: unknown, path: string[]): unknown[] {
  if (path.length === 0) {
    return collectDataTableScalarValues(value)
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractDataTablePathValues(item, path))
  }
  if (!value || typeof value !== "object") {
    return []
  }
  const [segment, ...rest] = path
  return extractDataTablePathValues((value as Record<string, unknown>)[segment], rest)
}

function toArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function toNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value)
}

function createEmptyResult(
  diagnostics: YaralDiagnostic[],
  traces: YaralEvaluationTrace[]
): YaralEvaluationResult {
  return {
    diagnostics,
    matched: false,
    matches: [],
    matchedEvents: {},
    outcomes: {},
    placeholders: {},
    traces,
  }
}

function createMatchedResult(
  diagnostics: YaralDiagnostic[],
  traces: YaralEvaluationTrace[],
  matchOrMatches: YaralEvaluationMatch | YaralEvaluationMatch[]
): YaralEvaluationResult {
  const matches = Array.isArray(matchOrMatches) ? matchOrMatches : [matchOrMatches]
  if (matches.length === 0) {
    return createEmptyResult(diagnostics, traces)
  }

  const firstMatch = matches[0] as YaralEvaluationMatch
  return {
    diagnostics,
    matched: true,
    matches,
    matchedEvents: firstMatch.matchedEvents,
    outcomes: firstMatch.outcomes,
    placeholders: firstMatch.placeholders,
    traces,
  }
}

function pushTrace(
  traces: YaralEvaluationTrace[],
  trace: Pick<YaralEvaluationTrace, "expression" | "label" | "passed" | "value">
) {
  traces.push({
    ...trace,
    expressionKind: trace.expression.kind,
    id: getTraceId(trace.label, trace.expression),
    section: getTraceSection(trace.label),
    sourceRange: trace.expression.range,
  })
}

function getTraceId(label: string, expression: YaralExpression) {
  const range = expression.range
  return [
    label,
    expression.kind,
    range.line,
    range.column,
    range.endLine,
    range.endColumn,
  ].join(":")
}

function getTraceSection(label: string): YaralEvaluationTrace["section"] {
  const section = label.split(":", 1)[0]
  if (
    section === "events" ||
    section === "match" ||
    section === "outcome" ||
    section === "condition" ||
    section === "meta" ||
    section === "options"
  ) {
    return section
  }
  return "runtime"
}

function applySuppression(
  rule: YaralCompiledRule,
  result: YaralEvaluationResult,
  options: YaralEvaluationOptions
): YaralEvaluationResult {
  const windowMinutes = rule.plan?.options.suppressionWindowMinutes
  if (!result.matched || !windowMinutes || !options.suppressionState) {
    return result
  }

  const windowMs = windowMinutes * 60 * 1000
  const keptMatches: YaralEvaluationMatch[] = []

  const timedMatches = result.matches
    .map((match, index) => ({ index, match, timestamp: getMatchTimestampMs(match) }))
    .sort((left, right) => {
      if (left.timestamp === null && right.timestamp === null) {
        return left.index - right.index
      }
      if (left.timestamp === null) {
        return 1
      }
      if (right.timestamp === null) {
        return -1
      }
      return left.timestamp - right.timestamp || left.index - right.index
    })

  for (const { match, timestamp } of timedMatches) {
    if (timestamp === null) {
      keptMatches.push(match)
      continue
    }

    const key = getSuppressionKey(rule, match)
    const suppressUntil = options.suppressionState.windows[key]
    if (typeof suppressUntil === "number" && timestamp <= suppressUntil) {
      continue
    }

    options.suppressionState.windows[key] = timestamp + windowMs
    keptMatches.push(match)
  }

  return createMatchedResult(result.diagnostics, result.traces, keptMatches)
}

function getSuppressionKey(rule: YaralCompiledRule, match: YaralEvaluationMatch) {
  const ruleName = rule.summary.ruleName ?? "anonymous_rule"
  const matchVariables = rule.plan?.match?.variables ?? []
  if (matchVariables.length > 0) {
    const scopedPlaceholders = Object.fromEntries(
      matchVariables.map((name) => [name, match.placeholders[name] ?? null])
    )
    return `${ruleName}:match:${JSON.stringify(sortJson(scopedPlaceholders))}`
  }

  if (Object.hasOwn(match.outcomes, "suppression_key")) {
    return `${ruleName}:single:${JSON.stringify(sortJson(match.outcomes.suppression_key))}`
  }

  return `${ruleName}:single:global`
}

function getMatchTimestampMs(match: YaralEvaluationMatch) {
  const timestamps = Object.values(match.matchedEvents)
    .flat()
    .map(getEventTimestampMs)
    .filter((timestamp): timestamp is number => timestamp !== null)
  return timestamps.length > 0 ? Math.min(...timestamps) : null
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson)
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)])
    )
  }
  return value
}

function pushRuntimeWarningOnce(diagnostics: YaralDiagnostic[], message: string) {
  if (diagnostics.some((diagnostic) => diagnostic.severity === "warning" && diagnostic.message === message)) {
    return
  }
  diagnostics.push(runtimeDiagnostic(message, "warning"))
}

function runtimeDiagnostic(
  message: string,
  severity: YaralDiagnostic["severity"] = "error"
): YaralDiagnostic {
  return createDiagnostic(firstSourceRange(), message, severity)
}
