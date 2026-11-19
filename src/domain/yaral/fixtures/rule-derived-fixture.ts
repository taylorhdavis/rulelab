import {
  collectBinaryExpressions,
  collectCallExpressions,
  collectVariableExpressions,
  compileYaralFile,
  parseYaralDurationMinutes,
} from "../compiler"
import { getUdmFieldAllowedValues } from "../../udm/field-values"
import type {
  YaralCompiledRule,
  YaralEvaluationDataTable,
  YaralExpression,
} from "../compiler"

export const MAX_FIXTURE_BUILDER_EVENTS = 100
export const MAX_RULE_DERIVED_EVENTS_PER_VARIABLE = 12
export const MAX_CUSTOM_FIXTURE_EVENTS_PER_ADD = 100

export type RuleDerivedConstraint = {
  allowDuplicate?: boolean
  allowVariation?: boolean
  mergeWithExisting?: boolean
  path: string
  replaceExisting?: boolean
  value: string | number | boolean
  variable: string
}

type RuleDerivedVariableField = {
  path: string
  variable: string
}

export type RuleDerivedGeneration = {
  constraints: RuleDerivedConstraint[]
  dataTables: YaralEvaluationDataTable[]
  events: unknown[]
  eventVariableCount: number
  ruleName: string | null
}

type RuleDerivedMatchWindow = {
  durationMs: number
  kind: "hop" | "sliding" | "tumbling"
  pivot: string | null
  direction: "after" | "before" | null
}

type RuleDerivedReferenceDataTableOptions = {
  includeDirectReferenceLists?: boolean
  includeHelperReferenceLists?: boolean
}

type RuleDerivedConstraintOptions = {
  includeCountSubstringOutcomes?: boolean
  includeDirectReferenceLists?: boolean
  includeHelperPatterns?: boolean
  includeHelperReferenceLists?: boolean
}

export type UdmTimestamp = {
  nanos: number
  seconds: number
}

export function createUdmTimestamp(timestampMs: number): UdmTimestamp {
  return {
    nanos: Math.floor(timestampMs % 1000) * 1_000_000,
    seconds: Math.floor(timestampMs / 1000),
  }
}

export function generateRuleDerivedTestEvents(ruleText: string): RuleDerivedGeneration {
  const model = buildRuleDerivedModel(ruleText)
  const constraints = model.constraints
  const grouped = new Map<string, RuleDerivedConstraint[]>()
  const eventVariables = model.eventVariables
  const eventCounts = model.eventCounts
  const varyingFields = model.varyingFields
  const matchWindow = model.matchWindow
  for (const constraint of constraints) {
    const fields = grouped.get(constraint.variable) ?? []
    fields.push(constraint)
    grouped.set(constraint.variable, fields)
  }
  for (const variable of eventVariables) {
    if (!grouped.has(variable)) {
      grouped.set(variable, [])
    }
  }
  if (!grouped.size) {
    return {
      constraints,
      dataTables: model.dataTables,
      eventVariableCount: 0,
      events: [],
      ruleName: extractRuleName(ruleText),
    }
  }

  const startTime = getRuleDerivedBaseTimestamp(ruleText)
  let eventIndex = 0
  const groupedEntries: Array<[string, RuleDerivedConstraint[]]> = []
  const groupedVariables = new Set<string>()
  for (const variable of eventVariables) {
    if (!grouped.has(variable)) continue
    groupedEntries.push([variable, grouped.get(variable) ?? []])
    groupedVariables.add(variable)
  }
  for (const entry of grouped.entries()) {
    if (groupedVariables.has(entry[0])) continue
    groupedEntries.push(entry)
  }
  const positives = groupedEntries.flatMap(([variable, fields], variableIndex) => {
    const count = getRuleDerivedPositiveEventCount({
      eventCounts,
      variable,
    })
    return Array.from({ length: count }, (_, occurrence) => {
      const timestamp = createUdmTimestamp(
        getRuleDerivedPositiveTimestamp({
          eventIndex,
          matchWindow,
          occurrence,
          startTime,
          variable,
          variableIndex,
        })
      )
      const event = createRuleDerivedEvent({
        fields,
        label: `Rule-derived positive: $${variable}${count > 1 ? ` #${occurrence + 1}` : ""}`,
        occurrence,
        timestamp,
        varyingFields: varyingFields.get(variable) ?? new Set(),
      })
      eventIndex += 1
      return event
    })
  })
  const shouldGenerateNearMisses =
    groupedEntries.length > 1 ||
    [...eventCounts.values()].some((count) => count > 1)
  const nearMisses = shouldGenerateNearMisses
    ? groupedEntries.map(([variable, fields], index) =>
        createRuleDerivedNearMissEvent({
          fields,
          label: `Rule-derived near miss: $${variable}`,
          timestamp: createUdmTimestamp(getRuleDerivedNearMissTimestamp({ index, matchWindow, startTime })),
        })
      )
    : []

  const events = [...positives, ...nearMisses].slice(0, MAX_FIXTURE_BUILDER_EVENTS)
  return {
    constraints,
    dataTables: model.dataTables,
    eventVariableCount: eventVariables.length,
    events,
    ruleName: model.ruleName,
  }
}

function getRuleDerivedPositiveEventCount({
  eventCounts,
  variable,
}: {
  eventCounts: Map<string, number>
  variable: string
}) {
  const explicitCount = eventCounts.get(variable)
  if (explicitCount) {
    return Math.min(MAX_RULE_DERIVED_EVENTS_PER_VARIABLE, explicitCount)
  }
  return 1
}

function getRuleDerivedBaseTimestamp(ruleText: string) {
  const stripped = stripYaralComments(ruleText)
  const hasTimestampDayHelper = /timestamp\.get_day_of_week\(/i.test(stripped)
  const hasTimestampHourHelper = /timestamp\.get_hour\(/i.test(stripped)
  if (!hasTimestampDayHelper && !hasTimestampHourHelper) {
    return Date.UTC(2026, 0, 1, 9, 0, 0)
  }

  const dayOfWeekComparisons = [...stripped.matchAll(
    /(?:\b0?([1-7])\s*={1,2}\s*timestamp\.get_day_of_week\(|timestamp\.get_day_of_week\([^)]*\)\s*={1,2}\s*0?([1-7])\b)/gi
  )]
  const requestedDay = dayOfWeekComparisons
    .map((match) => Number(match[1] ?? match[2]))
    .find((day) => Number.isInteger(day) && day >= 1 && day <= 7)

  const dayOffset = requestedDay ? requestedDay - 1 : 0
  const hour = hasTimestampHourHelper ? 1 : 9
  return Date.UTC(2026, 0, 4 + dayOffset, hour, 0, 0)
}

export function createCustomFixtureEvents({
  count,
  startIndex,
  startTime,
}: {
  count: number
  startIndex: number
  startTime: number
}) {
  return Array.from({ length: Math.min(MAX_CUSTOM_FIXTURE_EVENTS_PER_ADD, count) }, (_, index) => {
    const eventNumber = startIndex + index + 1
    return createRuleDerivedEvent({
      fields: [
        { path: "metadata.event_type", value: "GENERIC_EVENT", variable: "custom" },
        { path: "principal.hostname", value: `WORKSTATION-${eventNumber}`, variable: "custom" },
        { path: "principal.user.userid", value: `user${eventNumber}`, variable: "custom" },
      ],
      label: `Custom test event #${eventNumber}`,
      timestamp: createUdmTimestamp(startTime + index * 60_000),
    })
  })
}

function buildRuleDerivedModel(ruleText: string) {
  const compiled = compileYaralFile(ruleText)
  const rule = compiled.rules.find((rule) => rule.symbols.eventVariables.length > 0) ?? compiled.rules[0] ?? null
  const compiledRuleName = compiled.rules[0]?.summary.ruleName ?? compiled.rules[0]?.ast?.name ?? null
  if (!rule) {
    const countModel = extractRuleDerivedCountModel(ruleText, { includeRawEventCounts: true })
    const fallbackConstraints = extractRuleDerivedConstraints(ruleText)
    return {
      constraints: fallbackConstraints,
      dataTables: extractRuleDerivedReferenceDataTables(ruleText, fallbackConstraints),
      eventCounts: countModel.eventCounts,
      eventVariables: orderRuleDerivedEventVariables(extractRuleEventVariables(ruleText), ruleText, [], {
        allowTextTimestampFallback: true,
      }),
      matchWindow: extractRuleMatchWindow(ruleText),
      ruleName: compiledRuleName ?? extractRuleName(ruleText),
      varyingFields: countModel.varyingFields,
    }
  }

  const countModel = extractRuleDerivedCountModel(ruleText)
  const compiledConstraints = extractCompiledRuleDerivedConstraints(rule)
  const fallbackConstraints = extractRuleDerivedConstraints(ruleText, {
    includeCountSubstringOutcomes: false,
    includeDirectReferenceLists: false,
    includeHelperPatterns: false,
    includeHelperReferenceLists: false,
  })
  const constraints = mergeRuleDerivedConstraints(compiledConstraints, fallbackConstraints)
  const dataTables = mergeRuleDerivedDataTables(
    extractCompiledRuleDerivedReferenceDataTables(rule, constraints),
    extractRuleDerivedReferenceDataTables(ruleText, constraints, {
      includeDirectReferenceLists: false,
      includeHelperReferenceLists: false,
    })
  )
  const compiledVaryingFields = extractCompiledRuleVaryingFields(rule, ruleText)
  mergeVaryingFields(compiledVaryingFields, countModel.varyingFields)
  const eventCounts = mergeRuleDerivedEventCounts(extractCompiledRuleEventCounts(rule), countModel.eventCounts)
  keepCountedMatchFieldsStable({
    eventCounts,
    matchSection: extractRuleSection(stripYaralComments(ruleText), "match"),
    placeholderFields: extractRulePlaceholderSourceFields(stripYaralComments(ruleText)),
    varyingFields: compiledVaryingFields,
  })
  return {
    constraints,
    dataTables,
    eventCounts,
    eventVariables: orderRuleDerivedEventVariables(
      rule.symbols.eventVariables.map((variable) => variable.name),
      ruleText,
      extractCompiledRuleEventOrderingEdges(rule)
    ),
    matchWindow: extractCompiledRuleMatchWindow(rule),
    ruleName: rule.summary.ruleName ?? rule.ast?.name ?? extractRuleName(ruleText),
    varyingFields: compiledVaryingFields,
  }
}

function orderRuleDerivedEventVariables(
  eventVariables: string[],
  ruleText: string,
  compiledEdges: Array<[string, string]> = [],
  options: { allowTextTimestampFallback?: boolean } = {}
) {
  const ordered = [...eventVariables]
  const indexByName = new Map(ordered.map((name, index) => [name, index]))
  const edges: Array<[string, string]> = [...compiledEdges]
  const eventsSection = extractRuleSection(stripYaralComments(ruleText), "events")
  const timestampPattern =
    /\$(\w+)\.metadata\.event_timestamp(?:\.seconds)?\s*([<>]=?)\s*\$(\w+)\.metadata\.event_timestamp(?:\.seconds)?/g

  if (options.allowTextTimestampFallback && !compiledEdges.length) {
    for (const match of eventsSection.matchAll(timestampPattern)) {
      const left = match[1]
      const operator = match[2]
      const right = match[3]
      if (!left || !right || !indexByName.has(left) || !indexByName.has(right)) {
        continue
      }
      edges.push(operator.startsWith("<") ? [left, right] : [right, left])
    }
  }

  for (let pass = 0; pass < ordered.length; pass += 1) {
    let moved = false
    for (const [before, after] of edges) {
      const beforeIndex = ordered.indexOf(before)
      const afterIndex = ordered.indexOf(after)
      if (beforeIndex === -1 || afterIndex === -1 || beforeIndex < afterIndex) {
        continue
      }
      ordered.splice(beforeIndex, 1)
      ordered.splice(afterIndex, 0, before)
      moved = true
    }
    if (!moved) {
      break
    }
  }

  return ordered
}

function extractCompiledRuleEventOrderingEdges(rule: YaralCompiledRule): Array<[string, string]> {
  const edges: Array<[string, string]> = []
  for (const predicate of rule.plan?.eventPredicates ?? []) {
    for (const binary of collectBinaryExpressions(predicate.expression)) {
      if (![">", ">=", "<", "<="].includes(binary.operator)) {
        continue
      }
      const left = getRuleDerivedExpressionVariableReference(binary.left)
      const right = getRuleDerivedExpressionVariableReference(binary.right)
      if (
        !left ||
        !right ||
        !isRuleDerivedTimestampLikePath(left.path) ||
        !isRuleDerivedTimestampLikePath(right.path)
      ) {
        continue
      }
      edges.push(binary.operator.startsWith("<") ? [left.name, right.name] : [right.name, left.name])
    }
  }
  return edges
}

function extractCompiledRuleDerivedConstraints(rule: YaralCompiledRule) {
  const constraints: RuleDerivedConstraint[] = []
  const seen = new Set<string>()
  const placeholderFields = extractCompiledRulePlaceholderSourceFields(rule)

  for (const predicate of rule.plan?.eventPredicates ?? []) {
    collectCompiledExpressionConstraints({
      constraints,
      expression: predicate.expression,
      placeholderFields,
      seen,
    })
  }

  for (const placeholder of rule.plan?.placeholders ?? []) {
    const value = defaultRulePlaceholderValue(placeholder.name)
    for (const variable of collectVariableExpressions(placeholder.expression)) {
      if (variable.kind === "variable" && variable.path) {
        addRuleDerivedConstraint({
          allowVariation: true,
          constraints,
          path: normalizeRuleDerivedPath(variable.path),
          seen,
          value,
          variable: variable.name,
        })
      }
    }
  }

  collectCompiledCountSubstringOutcomeConstraints({ constraints, rule, seen })

  return constraints
}

type RuleCountSubstringOutcomeField = {
  path: string
  substring: string
  variable: string
}

function collectCompiledCountSubstringOutcomeConstraints({
  constraints,
  rule,
  seen,
}: {
  constraints: RuleDerivedConstraint[]
  rule: YaralCompiledRule
  seen: Set<string>
}) {
  const outcomeExpressions = new Map((rule.plan?.outcomes ?? []).map((outcome) => [outcome.name, outcome.expression]))
  const countFields = new Map<string, RuleCountSubstringOutcomeField>()
  const deltaOutcomes = new Map<string, { left: string; right: string }>()

  for (const [name, expression] of outcomeExpressions.entries()) {
    const countField = getCompiledCountSubstringOutcomeField(expression)
    if (countField) {
      countFields.set(name, countField)
      continue
    }
    const delta = getCompiledAbsDeltaOutcome(expression)
    if (delta) {
      deltaOutcomes.set(name, delta)
    }
  }

  const condition = rule.plan?.condition
  if (!condition) {
    return
  }

  for (const binary of collectBinaryExpressions(condition)) {
    if (![">", ">="].includes(binary.operator) || binary.right.kind !== "literal" || binary.right.literalKind !== "number") {
      continue
    }
    const threshold = Number(binary.right.value)
    if (!Number.isInteger(threshold)) {
      continue
    }
    const directDelta = getCompiledAbsDeltaOutcome(binary.left)
    const outcomeName = getRuleDerivedOutcomeReferenceName(binary.left)
    const delta = directDelta ?? deltaOutcomes.get(outcomeName ?? "")
    if (!delta) {
      continue
    }
    const left = countFields.get(delta.left)
    const right = countFields.get(delta.right)
    if (!left || !right) {
      continue
    }
    upsertRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: left.path,
      seen,
      value: Array.from({ length: threshold + 2 }, (_, index) => `${left.substring}${index + 1}`).join(" "),
      variable: left.variable,
    })
    upsertRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: right.path,
      seen,
      value: right.substring,
      variable: right.variable,
    })
  }
}

function getCompiledCountSubstringOutcomeField(
  expression: YaralExpression
): RuleCountSubstringOutcomeField | null {
  if (expression.kind !== "call" || expression.callee.toLowerCase() !== "max") {
    return null
  }
  const countCall = expression.args[0]
  if (
    countCall?.kind !== "call" ||
    countCall.callee.toLowerCase() !== "strings.count_substrings" ||
    countCall.args[0]?.kind !== "variable" ||
    !countCall.args[0].path ||
    countCall.args[1]?.kind !== "literal" ||
    countCall.args[1].literalKind !== "string"
  ) {
    return null
  }
  return {
    path: normalizeRuleDerivedPath(countCall.args[0].path),
    substring: stripRuleStringLiteral(countCall.args[1].value),
    variable: countCall.args[0].name,
  }
}

function getCompiledAbsDeltaOutcome(expression: YaralExpression) {
  if (expression.kind !== "call" || expression.callee.toLowerCase() !== "math.abs") {
    return null
  }
  const delta = expression.args[0]
  if (delta?.kind !== "binary" || delta.operator !== "-") {
    return null
  }
  const left = getRuleDerivedOutcomeReferenceName(delta.left)
  const right = getRuleDerivedOutcomeReferenceName(delta.right)
  return left && right ? { left, right } : null
}

function getRuleDerivedOutcomeReferenceName(expression: YaralExpression) {
  return expression.kind === "variable" && !expression.path ? expression.name : null
}

function collectCompiledExpressionConstraints({
  constraints,
  expression,
  placeholderFields,
  seen,
}: {
  constraints: RuleDerivedConstraint[]
  expression: YaralExpression
  placeholderFields: Map<string, RuleDerivedVariableField[]>
  seen: Set<string>
}) {
  if (expression.kind === "binary") {
    if (expression.operator.toLowerCase() === "or") {
      collectCompiledExpressionConstraints({ constraints, expression: expression.left, placeholderFields, seen })
      return
    }
    collectCompiledBinaryConstraint({ constraints, expression, placeholderFields, seen })
    collectCompiledExpressionConstraints({ constraints, expression: expression.left, placeholderFields, seen })
    collectCompiledExpressionConstraints({ constraints, expression: expression.right, placeholderFields, seen })
    return
  }
  if (expression.kind === "assignment") {
    collectCompiledBinaryConstraint({ constraints, expression, placeholderFields, seen })
    collectCompiledExpressionConstraints({ constraints, expression: expression.left, placeholderFields, seen })
    collectCompiledExpressionConstraints({ constraints, expression: expression.right, placeholderFields, seen })
    return
  }
  if (expression.kind === "call") {
    collectCompiledCallConstraint({ constraints, expression, seen })
    for (const arg of expression.args) {
      collectCompiledExpressionConstraints({ constraints, expression: arg, placeholderFields, seen })
    }
    return
  }
  if (expression.kind === "group") {
    collectCompiledExpressionConstraints({ constraints, expression: expression.expression, placeholderFields, seen })
    return
  }
  if (expression.kind === "unary") {
    if (expression.operator.toLowerCase() === "not") {
      if (collectNegatedCompiledConstraints({ constraints, expression: expression.argument, seen })) {
        return
      }
    }
    collectCompiledExpressionConstraints({ constraints, expression: expression.argument, placeholderFields, seen })
    return
  }
  if (expression.kind === "array") {
    for (const element of expression.elements) {
      collectCompiledExpressionConstraints({ constraints, expression: element, placeholderFields, seen })
    }
  }
}

function extractCompiledRulePlaceholderSourceFields(rule: YaralCompiledRule) {
  const fields = new Map<string, RuleDerivedVariableField[]>()
  for (const placeholder of rule.plan?.placeholders ?? []) {
    for (const variable of collectVariableExpressions(placeholder.expression)) {
      if (variable.kind !== "variable" || !variable.path) {
        continue
      }
      const entries = fields.get(placeholder.name) ?? []
      entries.push({
        path: normalizeRuleDerivedPath(variable.path),
        variable: variable.name,
      })
      fields.set(placeholder.name, entries)
    }
  }
  return fields
}

function collectNegatedCompiledConstraints({
  constraints,
  expression,
  seen,
}: {
  constraints: RuleDerivedConstraint[]
  expression: YaralExpression
  seen: Set<string>
}): boolean {
  if (expression.kind === "group") {
    return collectNegatedCompiledConstraints({ constraints, expression: expression.expression, seen })
  }
  if (expression.kind === "binary" && ["and", "or"].includes(expression.operator.toLowerCase())) {
    const left = collectNegatedCompiledConstraints({ constraints, expression: expression.left, seen })
    const right = collectNegatedCompiledConstraints({ constraints, expression: expression.right, seen })
    return left || right
  }
  if (expression.kind === "binary") {
    return collectNegatedCompiledBinaryConstraint({ constraints, expression, seen })
  }
  if (expression.kind !== "call") {
    return false
  }

  const [first] = expression.args
  const firstReference = first ? getRuleDerivedExpressionVariableReference(first) : null
  if (!firstReference) {
    return false
  }
  if (expression.callee === "re.regex" || expression.callee === "net.ip_in_range_cidr") {
    const existing = constraints.find((constraint) =>
      constraint.variable === firstReference.name &&
      constraint.path === normalizeRuleDerivedPath(firstReference.path) &&
      !constraint.replaceExisting
    )
    if (existing) {
      return true
    }
    addRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: normalizeRuleDerivedPath(firstReference.path),
      replaceExisting: true,
      seen,
      value: defaultRuleNonMatchingValue(firstReference.path),
      variable: firstReference.name,
    })
    return true
  }
  if (expression.callee === "strings.contains") {
    const path = normalizeRuleDerivedPath(firstReference.path)
    if (hasPositiveRuleDerivedConstraint(constraints, firstReference.name, path)) {
      return true
    }
    addRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path,
      replaceExisting: true,
      seen,
      value: defaultRuleNonMatchingValue(firstReference.path),
      variable: firstReference.name,
    })
    return true
  }
  return false
}

function collectNegatedCompiledBinaryConstraint({
  constraints,
  expression,
  seen,
}: {
  constraints: RuleDerivedConstraint[]
  expression: Extract<YaralExpression, { kind: "binary" }>
  seen: Set<string>
}) {
  const left = expression.left
  const right = expression.right
  const equality = expression.operator === "=" || expression.operator === "=="
  if (!equality) {
    return false
  }
  if (left.kind === "variable" && left.path && right.kind === "literal") {
    const path = normalizeRuleDerivedPath(left.path)
    if (hasPositiveRuleDerivedConstraint(constraints, left.name, path)) {
      return true
    }
    upsertRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path,
      replaceExisting: true,
      seen,
      value:
        right.literalKind === "regex"
          ? defaultRuleNonMatchingValue(left.path)
          : sampleValueForInequality(left.path, sampleValueFromLiteral(right)),
      variable: left.name,
    })
    return true
  }
  if (right.kind === "variable" && right.path && left.kind === "literal") {
    const path = normalizeRuleDerivedPath(right.path)
    if (hasPositiveRuleDerivedConstraint(constraints, right.name, path)) {
      return true
    }
    upsertRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path,
      replaceExisting: true,
      seen,
      value:
        left.literalKind === "regex"
          ? defaultRuleNonMatchingValue(right.path)
          : sampleValueForInequality(right.path, sampleValueFromLiteral(left)),
      variable: right.name,
    })
    return true
  }
  return false
}

function hasPositiveRuleDerivedConstraint(
  constraints: RuleDerivedConstraint[],
  variable: string,
  path: string
) {
  return constraints.some((constraint) =>
    constraint.variable === variable &&
    constraint.path === path &&
    !constraint.replaceExisting
  )
}

function collectCompiledBinaryConstraint({
  constraints,
  expression,
  placeholderFields,
  seen,
}: {
  constraints: RuleDerivedConstraint[]
  expression: Extract<YaralExpression, { kind: "assignment" | "binary" }>
  placeholderFields: Map<string, RuleDerivedVariableField[]>
  seen: Set<string>
}) {
  const left = expression.left
  const right = expression.right
  const equality = expression.operator === "=" || expression.operator === "=="
  if (equality && left.kind === "variable" && left.path && right.kind === "literal") {
    addCompiledExactLiteralConstraint({
      constraints,
      allowVariation: right.literalKind === "regex",
      path: normalizeRuleDerivedPath(left.path),
      seen,
      value: sampleValueFromLiteral(right),
      variable: left.name,
    })
  }
  if (equality && left.kind === "variable" && !left.path && right.kind === "literal") {
    for (const field of placeholderFields.get(left.name) ?? []) {
      addCompiledExactLiteralConstraint({
        constraints,
        allowVariation: right.literalKind === "regex",
        path: field.path,
        seen,
        value: sampleValueFromLiteral(right),
        variable: field.variable,
      })
    }
  }
  if (equality && right.kind === "variable" && right.path && left.kind === "literal") {
    addCompiledExactLiteralConstraint({
      constraints,
      allowVariation: left.literalKind === "regex",
      path: normalizeRuleDerivedPath(right.path),
      seen,
      value: sampleValueFromLiteral(left),
      variable: right.name,
    })
  }
  if (equality && right.kind === "variable" && !right.path && left.kind === "literal") {
    for (const field of placeholderFields.get(right.name) ?? []) {
      addCompiledExactLiteralConstraint({
        constraints,
        allowVariation: left.literalKind === "regex",
        path: field.path,
        seen,
        value: sampleValueFromLiteral(left),
        variable: field.variable,
      })
    }
  }
  if (equality && left.kind === "variable" && left.path && right.kind === "variable" && right.path) {
    const leftPath = normalizeRuleDerivedPath(left.path)
    const rightPath = normalizeRuleDerivedPath(right.path)
    const value =
      getRuleDerivedConstraintValue(constraints, left.name, leftPath) ??
      getRuleDerivedConstraintValue(constraints, right.name, rightPath) ??
      defaultRuleJoinValue(leftPath, rightPath)
    addRuleDerivedConstraint({
      constraints,
      path: leftPath,
      seen,
      value,
      variable: left.name,
    })
    addRuleDerivedConstraint({
      constraints,
      path: rightPath,
      seen,
      value,
      variable: right.name,
    })
  }
  if (expression.operator === "!=" && left.kind === "variable" && left.path && right.kind === "variable" && right.path) {
    const leftPath = normalizeRuleDerivedPath(left.path)
    const rightPath = normalizeRuleDerivedPath(right.path)
    const [leftValue, rightValue] = defaultRuleDistinctValues(leftPath, rightPath)
    addRuleDerivedConstraint({
      constraints,
      path: leftPath,
      replaceExisting: true,
      seen,
      value: leftValue,
      variable: left.name,
    })
    addRuleDerivedConstraint({
      constraints,
      path: rightPath,
      replaceExisting: true,
      seen,
      value: rightValue,
      variable: right.name,
    })
  }
  if (expression.operator === "!=" && left.kind === "variable" && !left.path && right.kind === "variable" && !right.path) {
    const leftFields = placeholderFields.get(left.name) ?? []
    const rightFields = placeholderFields.get(right.name) ?? []
    const [leftValue, rightValue] = defaultRuleDistinctValues(left.name, right.name)
    for (const field of leftFields) {
      upsertRuleDerivedConstraint({
        allowVariation: true,
        constraints,
        path: field.path,
        seen,
        value: leftValue,
        variable: field.variable,
      })
    }
    for (const field of rightFields) {
      upsertRuleDerivedConstraint({
        allowVariation: true,
        constraints,
        path: field.path,
        seen,
        value: rightValue,
        variable: field.variable,
      })
    }
  }
  if (expression.operator === "!=" && left.kind === "variable" && left.path && right.kind === "literal") {
    addRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: normalizeRuleDerivedPath(left.path),
      replaceExisting: true,
      seen,
      value:
        right.literalKind === "regex"
          ? defaultRuleNonMatchingValue(left.path)
          : sampleValueForInequality(left.path, sampleValueFromLiteral(right)),
      variable: left.name,
    })
  }
  if (expression.operator === "!=" && right.kind === "variable" && right.path && left.kind === "literal") {
    addRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: normalizeRuleDerivedPath(right.path),
      replaceExisting: true,
      seen,
      value:
        left.literalKind === "regex"
          ? defaultRuleNonMatchingValue(right.path)
          : sampleValueForInequality(right.path, sampleValueFromLiteral(left)),
      variable: right.name,
    })
  }
  if (
    left.kind === "variable" &&
    left.path &&
    right.kind === "variable" &&
    right.path &&
    [">", ">=", "<", "<="].includes(expression.operator) &&
    (isRuleDerivedTimestampLikePath(left.path) || isRuleDerivedTimestampLikePath(right.path))
  ) {
    const leftPath = normalizeRuleDerivedPath(left.path)
    const rightPath = normalizeRuleDerivedPath(right.path)
    const leftBeforeRight = expression.operator.startsWith("<")
    addRuleDerivedConstraint({
      constraints,
      path: leftPath,
      seen,
      value: leftBeforeRight ? 1_600_000_000 : 1_600_000_100,
      variable: left.name,
    })
    addRuleDerivedConstraint({
      constraints,
      path: rightPath,
      seen,
      value: leftBeforeRight ? 1_600_000_100 : 1_600_000_000,
      variable: right.name,
    })
  }
  if (
    left.kind === "variable" &&
    left.path &&
    right.kind === "literal" &&
    right.literalKind === "number" &&
    [">", ">=", "<", "<="].includes(expression.operator)
  ) {
    const threshold = Number(right.value)
    if (Number.isFinite(threshold)) {
      addRuleDerivedConstraint({
        constraints,
        path: normalizeRuleDerivedPath(left.path),
        seen,
        value: expression.operator.includes(">") ? threshold + 1 : threshold - 1,
        variable: left.name,
      })
    }
  }
  if (expression.kind === "binary") {
    collectCompiledReferenceListEqualityConstraint({
      constraints,
      expression,
      placeholderFields,
      seen,
    })
    collectCompiledHelperReferenceListConstraint({ constraints, expression, seen })
    collectCompiledMembershipConstraint({ constraints, expression, placeholderFields, seen })
  }
}

function isRuleDerivedTimestampLikePath(path: string) {
  return /(?:^|\.)[a-z_]*time(?:stamp)?(?:\.seconds)?$/i.test(path)
}

function collectCompiledMembershipConstraint({
  constraints,
  expression,
  placeholderFields,
  seen,
}: {
  constraints: RuleDerivedConstraint[]
  expression: Extract<YaralExpression, { kind: "binary" }>
  placeholderFields: Map<string, RuleDerivedVariableField[]>
  seen: Set<string>
}) {
  const operator = expression.operator.toLowerCase()
  if (!["in", "in cidr", "in regex", "not in", "not in cidr", "not in regex"].includes(operator)) {
    return
  }

  const fields = getCompiledConstraintFieldsForExpression(expression.left, placeholderFields)
  if (!fields.length || (expression.right.kind !== "array" && expression.right.kind !== "referenceList")) {
    return
  }

  for (const field of fields) {
    const constraint = getCompiledMembershipConstraint({
      expression: expression.right,
      operator,
      path: field.path,
    })
    if (!constraint) {
      continue
    }
    addRuleDerivedConstraint({
      allowVariation: constraint.allowVariation,
      constraints,
      path: field.path,
      replaceExisting: constraint.replaceExisting,
      seen,
      value: constraint.value,
      variable: field.variable,
    })
  }
}

function collectCompiledReferenceListEqualityConstraint({
  constraints,
  expression,
  placeholderFields,
  seen,
}: {
  constraints: RuleDerivedConstraint[]
  expression: Extract<YaralExpression, { kind: "binary" }>
  placeholderFields: Map<string, RuleDerivedVariableField[]>
  seen: Set<string>
}) {
  if (!["=", "=="].includes(expression.operator) || expression.right.kind !== "referenceList") {
    return
  }
  const fields = getCompiledConstraintFieldsForExpression(expression.left, placeholderFields)
  for (const field of fields) {
    const reference = parseRuleDerivedReferenceName(expression.right.name)
    addRuleDerivedConstraint({
      constraints,
      path: field.path,
      seen,
      value: sampleValueForReferenceListPath(field.path, reference.tableName, reference.columnName),
      variable: field.variable,
    })
  }
}

function collectCompiledHelperReferenceListConstraint({
  constraints,
  expression,
  seen,
}: {
  constraints: RuleDerivedConstraint[]
  expression: Extract<YaralExpression, { kind: "binary" }>
  seen: Set<string>
}) {
  if (!["in", "in regex"].includes(expression.operator.toLowerCase())) {
    return
  }
  if (expression.right.kind !== "referenceList" || expression.left.kind !== "call") {
    return
  }

  const helper = getCompiledReferenceListHelper(expression.left, expression.right, constraints)
  if (!helper) {
    return
  }

  addRuleDerivedConstraint({
    allowVariation: helper.allowVariation,
    constraints,
    path: helper.field.path,
    seen,
    value: helper.sourceValue,
    variable: helper.field.variable,
  })
}

function getCompiledConstraintFieldsForExpression(
  expression: YaralExpression,
  placeholderFields: Map<string, RuleDerivedVariableField[]>
): RuleDerivedVariableField[] {
  const reference = getRuleDerivedExpressionConstraintReference(expression)
  if (!reference) {
    return []
  }
  if (reference.path) {
    return [{ path: normalizeRuleDerivedPath(reference.path), variable: reference.name }]
  }
  return placeholderFields.get(reference.name) ?? []
}

function getRuleDerivedExpressionConstraintReference(
  expression: YaralExpression
): { name: string; path: string } | null {
  if (expression.kind === "variable") {
    return { name: expression.name, path: expression.path }
  }
  if (expression.kind === "group") {
    return getRuleDerivedExpressionConstraintReference(expression.expression)
  }
  if (expression.kind === "call") {
    const callee = expression.callee.toLowerCase()
    if (
      [
        "cast.as_string",
        "strings.to_lower",
        "strings.to_upper",
        "strings.trim",
        "strings.ltrim",
        "strings.rtrim",
      ].includes(callee)
    ) {
      return expression.args[0] ? getRuleDerivedExpressionConstraintReference(expression.args[0]) : null
    }
  }
  return null
}

function getCompiledMembershipConstraint({
  expression,
  operator,
  path,
}: {
  expression: Extract<YaralExpression, { kind: "array" | "referenceList" }>
  operator: string
  path: string
}): {
  allowVariation?: boolean
  replaceExisting?: boolean
  value: string | number | boolean
} | null {
  const replaceExisting = operator.startsWith("not ")
  if (expression.kind === "referenceList") {
    const reference = parseRuleDerivedReferenceName(expression.name)
    return {
      allowVariation: operator.endsWith("regex"),
      replaceExisting,
      value: replaceExisting
        ? defaultRuleNonMatchingValue(path)
        : operator.endsWith("regex")
          ? sampleValueForReferenceListPath(path, reference.tableName, reference.columnName)
          : getReferenceListConstraintValue(path, reference.tableName, reference.columnName),
    }
  }

  const literal = expression.elements.find(
    (element): element is Extract<YaralExpression, { kind: "literal" }> =>
      element.kind === "literal"
  )
  if (!literal) {
    return null
  }

  if (operator.endsWith("regex")) {
    return {
      allowVariation: true,
      replaceExisting,
      value: replaceExisting
        ? defaultRuleNonMatchingValue(path)
        : sampleValueFromRegexPatternForPath(path, literal.value),
    }
  }
  if (operator.endsWith("cidr")) {
    return {
      replaceExisting,
      value: replaceExisting
        ? defaultRuleNonMatchingValue(path)
        : sampleIpFromCidr(unescapeQuotedRuleString(literal.value.replace(/^"|"$/g, ""))),
    }
  }

  const literalValue = sampleValueFromLiteral(literal)
  return {
    replaceExisting,
    value: replaceExisting ? sampleValueForInequality(path, literalValue) : literalValue,
  }
}

function getReferenceListConstraintValue(path: string, tableName: string, columnName?: string) {
  return columnName
    ? defaultRulePlaceholderValue(columnName)
    : defaultRuleJoinValue(path)
}

function getCompiledReferenceListHelper(
  call: Extract<YaralExpression, { kind: "call" }>,
  referenceList: Extract<YaralExpression, { kind: "referenceList" }>,
  constraints: RuleDerivedConstraint[]
): {
  allowVariation?: boolean
  field: RuleDerivedVariableField
  reference: { columnName?: string; tableName: string }
  rowValue: string | number | boolean
  sourceValue: string | number | boolean
} | null {
  const callee = call.callee.toLowerCase()
  const [sourceExpression, patternExpression, replacementExpression] = call.args
  const sourceReference = sourceExpression
    ? getRuleDerivedExpressionConstraintReference(sourceExpression)
    : null
  if (!sourceReference?.path) {
    return null
  }

  const field = {
    path: normalizeRuleDerivedPath(sourceReference.path),
    variable: sourceReference.name,
  }
  const reference = parseRuleDerivedReferenceName(referenceList.name)

  if (
    callee === "re.replace" &&
    patternExpression?.kind === "literal" &&
    replacementExpression?.kind === "literal"
  ) {
    const sourceValue =
      getRuleDerivedConstraintValue(constraints, field.variable, field.path) ??
      defaultRuleJoinValue(field.path)
    return {
      field,
      reference,
      rowValue: applySimpleRuleDerivedReplace(
        sourceValue,
        patternExpression.value,
        unescapeQuotedRuleString(replacementExpression.value.replace(/^"|"$/g, ""))
      ),
      sourceValue,
    }
  }

  if (callee === "re.capture" && patternExpression?.kind === "literal") {
    const capturedValue = sampleValueForCaptureReferenceList(
      field.path,
      reference.tableName,
      reference.columnName
    )
    return {
      allowVariation: true,
      field,
      reference,
      rowValue: capturedValue,
      sourceValue: sampleSourceForCapturePattern(patternExpression.value, capturedValue),
    }
  }

  return null
}

function addCompiledExactLiteralConstraint({
  allowVariation,
  constraints,
  path,
  seen,
  value,
  variable,
}: {
  allowVariation: boolean
  constraints: RuleDerivedConstraint[]
  path: string
  seen: Set<string>
  value: string | number | boolean
  variable: string
}) {
  const existing = constraints.find((constraint) =>
    constraint.variable === variable && constraint.path === path
  )
  if (existing?.replaceExisting && (allowVariation || path.toLowerCase().includes("user_agent"))) {
    upsertRuleDerivedConstraint({
      allowVariation,
      constraints,
      mergeWithExisting: allowVariation,
      path,
      replaceExisting: true,
      seen,
      value,
      variable,
    })
    return
  }
  addRuleDerivedConstraint({
    allowVariation,
    constraints,
    mergeWithExisting: allowVariation,
    path,
    seen,
    value,
    variable,
  })
}

function collectCompiledCallConstraint({
  constraints,
  expression,
  seen,
}: {
  constraints: RuleDerivedConstraint[]
  expression: Extract<YaralExpression, { kind: "call" }>
  seen: Set<string>
}) {
  const [first, second] = expression.args
  const firstReference = first ? getRuleDerivedExpressionVariableReference(first) : null
  if (!firstReference || !second) {
    return
  }
  if (expression.callee === "strings.contains" && second.kind === "literal") {
    addRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      mergeWithExisting: true,
      path: normalizeRuleDerivedPath(firstReference.path),
      seen,
      value: sampleValueFromLiteral(second),
      variable: firstReference.name,
    })
  }
  if (expression.callee === "re.regex" && second.kind === "literal") {
    addRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      mergeWithExisting: true,
      path: normalizeRuleDerivedPath(firstReference.path),
      seen,
      value: sampleValueFromRegexPatternForPath(firstReference.path, second.value),
      variable: firstReference.name,
    })
  }
  if (expression.callee === "net.ip_in_range_cidr" && second.kind === "literal") {
    addRuleDerivedConstraint({
      constraints,
      path: normalizeRuleDerivedPath(firstReference.path),
      seen,
      value: sampleIpFromCidr(unescapeQuotedRuleString(second.value.replace(/^"|"$/g, ""))),
      variable: firstReference.name,
    })
  }
}

function getRuleDerivedExpressionVariableReference(
  expression: YaralExpression
): { name: string; path: string } | null {
  if (expression.kind === "variable" && expression.path) {
    return { name: expression.name, path: expression.path }
  }
  if (expression.kind === "group") {
    return getRuleDerivedExpressionVariableReference(expression.expression)
  }
  if (expression.kind === "call") {
    const callee = expression.callee.toLowerCase()
    if (
      [
        "cast.as_string",
        "strings.to_lower",
        "strings.to_upper",
        "strings.trim",
        "strings.ltrim",
        "strings.rtrim",
      ].includes(callee)
    ) {
      return expression.args[0] ? getRuleDerivedExpressionVariableReference(expression.args[0]) : null
    }
  }
  return null
}

function sampleValueFromLiteral(literal: Extract<YaralExpression, { kind: "literal" }>) {
  switch (literal.literalKind) {
    case "boolean":
      return literal.value.toLowerCase() === "true"
    case "number":
      return Number(literal.value)
    case "regex":
      return sampleValueFromRegexPattern(literal.value)
    case "string":
      return unescapeQuotedRuleString(literal.value.replace(/^"|"$/g, ""))
    default:
      return literal.value
  }
}

function extractCompiledRuleEventCounts(rule: YaralCompiledRule) {
  if (!rule.plan?.condition) {
    return null
  }
  const counts = new Map<string, number>()
  collectCompiledCountConstraints(rule.plan.condition, counts)
  for (const placeholder of rule.plan.placeholders ?? []) {
    const count = counts.get(placeholder.name)
    if (!count) {
      continue
    }
    for (const eventVariable of placeholder.eventVariables) {
      counts.set(eventVariable, Math.max(counts.get(eventVariable) ?? 0, count))
    }
  }
  return counts
}

function mergeRuleDerivedEventCounts(
  primary: Map<string, number> | null,
  secondary: Map<string, number>
) {
  const merged = new Map<string, number>(primary ?? [])
  for (const [variable, count] of secondary.entries()) {
    merged.set(variable, Math.max(merged.get(variable) ?? 0, count))
  }
  return merged
}

function extractCompiledRuleVaryingFields(rule: YaralCompiledRule, ruleText: string) {
  const fields = new Map<string, Set<string>>()
  for (const outcome of rule.plan?.outcomes ?? []) {
    collectCompiledVaryingFields(outcome.expression, fields)
  }
  mergeVaryingFields(fields, extractRuleVaryingFields(ruleText))
  return fields
}

function collectCompiledVaryingFields(expression: YaralExpression, fields: Map<string, Set<string>>) {
  for (const call of collectCallExpressions(expression)) {
    const callee = call.callee.toLowerCase()
    const first = call.args[0]
    if (
      callee === "count_distinct" &&
      first?.kind === "variable" &&
      first.path
    ) {
      addVaryingField(fields, first.name, normalizeRuleDerivedPath(first.path))
    }
  }
}

function mergeVaryingFields(target: Map<string, Set<string>>, source: Map<string, Set<string>>) {
  for (const [variable, paths] of source.entries()) {
    for (const path of paths) {
      addVaryingField(target, variable, path)
    }
  }
}

function collectCompiledCountConstraints(expression: YaralExpression, counts: Map<string, number>) {
  for (const binary of collectBinaryExpressions(expression)) {
    if (
      binary.left.kind === "countVariable" &&
      binary.right.kind === "literal" &&
      binary.right.literalKind === "number" &&
      [">", ">=", "=", "=="].includes(binary.operator)
    ) {
      const count = Number(binary.right.value)
      if (Number.isInteger(count) && count > 0) {
        counts.set(binary.left.name, Math.min(MAX_RULE_DERIVED_EVENTS_PER_VARIABLE, binary.operator === ">" ? count + 1 : count))
      }
    }
  }
}

function extractCompiledRuleMatchWindow(rule: YaralCompiledRule): RuleDerivedMatchWindow | null {
  if (rule.diagnostics.some((diagnostic) => diagnostic.message.includes("`match:`"))) {
    return null
  }
  const match = rule.plan?.match
  if (!match?.durationMinutes) {
    return null
  }
  return {
    direction: match.pivotDirection,
    durationMs: Math.max(60_000, match.durationMinutes * 60_000),
    kind: match.kind ?? "hop",
    pivot: match.pivotEvent,
  }
}

function extractCompiledRuleDerivedReferenceDataTables(
  rule: YaralCompiledRule,
  constraints: RuleDerivedConstraint[]
): YaralEvaluationDataTable[] {
  const rows = new Map<string, unknown[]>()
  const placeholderFields = extractCompiledRulePlaceholderSourceFields(rule)

  for (const predicate of rule.plan?.eventPredicates ?? []) {
    collectCompiledReferenceDataTableRows(predicate.expression, constraints, placeholderFields, rows)
  }
  for (const outcome of rule.plan?.outcomes ?? []) {
    collectCompiledReferenceDataTableRows(outcome.expression, constraints, placeholderFields, rows)
  }

  return toRuleDerivedDataTables(rows)
}

function collectCompiledReferenceDataTableRows(
  expression: YaralExpression,
  constraints: RuleDerivedConstraint[],
  placeholderFields: Map<string, RuleDerivedVariableField[]>,
  rows: Map<string, unknown[]>
) {
  if (expression.kind === "unary" && expression.operator.toLowerCase() === "not") {
    return
  }
  if (expression.kind === "binary") {
    if (expression.operator.toLowerCase() === "or") {
      collectCompiledReferenceDataTableRows(expression.left, constraints, placeholderFields, rows)
      return
    }
    collectCompiledReferenceDataTableRow(expression, constraints, placeholderFields, rows)
    collectCompiledReferenceDataTableRows(expression.left, constraints, placeholderFields, rows)
    collectCompiledReferenceDataTableRows(expression.right, constraints, placeholderFields, rows)
    return
  }
  if (expression.kind === "call") {
    for (const arg of expression.args) {
      collectCompiledReferenceDataTableRows(arg, constraints, placeholderFields, rows)
    }
    return
  }
  if (expression.kind === "group") {
    collectCompiledReferenceDataTableRows(expression.expression, constraints, placeholderFields, rows)
    return
  }
  if (expression.kind === "array") {
    for (const element of expression.elements) {
      collectCompiledReferenceDataTableRows(element, constraints, placeholderFields, rows)
    }
  }
}

function collectCompiledReferenceDataTableRow(
  expression: Extract<YaralExpression, { kind: "binary" }>,
  constraints: RuleDerivedConstraint[],
  placeholderFields: Map<string, RuleDerivedVariableField[]>,
  rows: Map<string, unknown[]>
) {
  if (!["=", "==", "in", "in regex", "in cidr"].includes(expression.operator.toLowerCase())) {
    return
  }
  if (expression.right.kind !== "referenceList") {
    return
  }
  if (expression.left.kind === "call") {
    const helper = getCompiledReferenceListHelper(expression.left, expression.right, constraints)
    if (helper) {
      addRuleDerivedReferenceRow(
        rows,
        helper.reference.tableName,
        helper.rowValue,
        helper.reference.columnName
      )
    }
    return
  }
  const fields = getCompiledConstraintFieldsForExpression(expression.left, placeholderFields)
  const placeholderReference = getRuleDerivedExpressionConstraintReference(expression.left)
  const reference = parseRuleDerivedReferenceName(expression.right.name)
  for (const field of fields) {
    const value = expression.operator.toLowerCase().endsWith("regex")
      ? sampleRegexForReferenceList(reference.tableName)
      : getRuleDerivedConstraintValue(constraints, field.variable, field.path) ??
        (placeholderReference?.path
          ? sampleValueForReferenceListPath(field.path, reference.tableName, reference.columnName)
          : defaultRulePlaceholderValue(placeholderReference?.name ?? field.path))
    addRuleDerivedReferenceRow(rows, reference.tableName, value, reference.columnName)
  }
}

function mergeRuleDerivedDataTables(
  primary: YaralEvaluationDataTable[],
  secondary: YaralEvaluationDataTable[]
) {
  const rows = new Map<string, unknown[]>()
  for (const table of [...primary, ...secondary]) {
    rows.set(table.name, [...(rows.get(table.name) ?? []), ...table.rows])
  }
  return toRuleDerivedDataTables(rows)
}

function toRuleDerivedDataTables(rows: Map<string, unknown[]>): YaralEvaluationDataTable[] {
  return Array.from(rows.entries()).map(([name, tableRows]) => ({
    name,
    rows: [...new Set(tableRows.map((row) => JSON.stringify(row)))].map((row) => JSON.parse(row)),
  }))
}

function mergeRuleDerivedConstraints(
  primary: RuleDerivedConstraint[],
  fallback: RuleDerivedConstraint[]
) {
  const merged: RuleDerivedConstraint[] = []
  const seen = new Set<string>()
  for (const constraint of [...primary, ...fallback]) {
    if (constraint.replaceExisting) {
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        const existing = merged[index]
        if (existing?.variable === constraint.variable && existing.path === constraint.path) {
          merged.splice(index, 1)
        }
      }
      seen.delete(`${constraint.variable}.${constraint.path}`)
    }
    addRuleDerivedConstraint({
      allowDuplicate: constraint.allowDuplicate,
      allowVariation: constraint.allowVariation,
      constraints: merged,
      mergeWithExisting: constraint.mergeWithExisting,
      path: constraint.path,
      replaceExisting: constraint.replaceExisting,
      seen,
      value: constraint.value,
      variable: constraint.variable,
    })
  }
  return merged
}

function extractRuleDerivedConstraints(
  ruleText: string,
  options: RuleDerivedConstraintOptions = {}
): RuleDerivedConstraint[] {
  const includeDirectReferenceLists = options.includeDirectReferenceLists ?? true
  const includeHelperReferenceLists = options.includeHelperReferenceLists ?? true
  const includeCountSubstringOutcomes = options.includeCountSubstringOutcomes ?? true
  const includeHelperPatterns = options.includeHelperPatterns ?? true
  const stripped = stripYaralComments(ruleText)
  const constraints: RuleDerivedConstraint[] = []
  const seen = new Set<string>()
  const placeholderValues = extractRulePlaceholderValues(stripped)

  collectRuleLiteralConstraints({
    constraints,
    pattern: /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*={1,2}\s*"((?:\\.|[^"\\])*)"/g,
    seen,
    text: stripped,
    valueForMatch: (match) => unescapeQuotedRuleString(match[3] ?? ""),
  })
  collectRuleLiteralConstraints({
    constraints,
    pattern: /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*={1,2}\s*(-?\d+(?:\.\d+)?)/g,
    seen,
    text: stripped,
    valueForMatch: (match) => Number(match[3]),
  })
  collectRuleLiteralConstraints({
    constraints,
    pattern: /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*={1,2}\s*(true|false)\b/gi,
    seen,
    text: stripped,
    valueForMatch: (match) => (match[3] ?? "").toLowerCase() === "true",
  })
  collectRuleLiteralConstraints({
    allowVariation: true,
    constraints,
    pattern: /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*={1,2}\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`)/gi,
    seen,
    text: stripped,
    valueForMatch: (match) => sampleValueFromRegexPatternForPath(match[2] ?? "", match[3] ?? ""),
  })
  collectRuleNotEqualLiteralConstraints({
    constraints,
    pattern: /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*!=\s*"((?:\\.|[^"\\])*)"/g,
    seen,
    text: stripped,
    valueForMatch: (match) =>
      sampleValueForInequality(match[2] ?? "", unescapeQuotedRuleString(match[3] ?? "")),
  })
  collectRuleNotEqualLiteralConstraints({
    constraints,
    pattern: /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*!=\s*(-?\d+(?:\.\d+)?)/g,
    seen,
    text: stripped,
    valueForMatch: (match) => sampleValueForInequality(match[2] ?? "", Number(match[3])),
  })
  collectRuleNotEqualLiteralConstraints({
    constraints,
    pattern: /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*!=\s*(true|false)\b/gi,
    seen,
    text: stripped,
    valueForMatch: (match) =>
      sampleValueForInequality(match[2] ?? "", (match[3] ?? "").toLowerCase() === "true"),
  })
  collectRuleNotEqualLiteralConstraints({
    constraints,
    pattern: /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*!=\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`)/gi,
    seen,
    text: stripped,
    valueForMatch: (match) => defaultRuleNonMatchingValue(match[2] ?? ""),
  })
  collectRuleReferenceListConstraints({
    constraints,
    includeDirectReferenceLists,
    includeHelperReferenceLists,
    seen,
    text: stripped,
  })
  if (includeHelperPatterns) {
    collectRuleLiteralConstraints({
      constraints,
      pattern: /strings\.contains\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*"((?:\\.|[^"\\])*)"\s*\)/gi,
      seen,
      text: stripped,
      valueForMatch: (match) => unescapeQuotedRuleString(match[3] ?? ""),
    })
    collectRuleLiteralConstraints({
      allowVariation: true,
      constraints,
      pattern: /re\.regex\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")\s*\)/gi,
      seen,
      text: stripped,
      valueForMatch: (match) => sampleValueFromRegexPatternForPath(match[2] ?? "", match[3] ?? ""),
    })
    collectRuleLiteralConstraints({
      allowVariation: true,
      constraints,
      pattern: /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s+regex\s+(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")/gi,
      seen,
      text: stripped,
      valueForMatch: (match) => sampleValueFromRegexPatternForPath(match[2] ?? "", match[3] ?? ""),
    })
    collectRuleLiteralConstraints({
      constraints,
      pattern: /net\.ip_in_range_cidr\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*"((?:\\.|[^"\\])*)"\s*\)/gi,
      seen,
      text: stripped,
      valueForMatch: (match) => sampleIpFromCidr(unescapeQuotedRuleString(match[3] ?? "")),
    })
  }
  collectRuleNumericRangeConstraints({ constraints, seen, text: stripped })
  collectRuleRecentTimestampConstraints({ constraints, seen, text: stripped })
  collectRuleTimestampDeltaConstraints({ constraints, seen, text: stripped })
  collectRulePlaceholderFieldConstraints({
    constraints,
    placeholderValues,
    seen,
    text: stripped,
  })
  collectRuleFieldJoinConstraints({ constraints, seen, text: stripped })
  collectRuleCaptureFieldConstraints({
    constraints,
    placeholderValues,
    seen,
    text: extractRuleSection(stripped, "events"),
  })
  collectRuleReplaceJoinConstraints({
    constraints,
    placeholderValues,
    seen,
    text: stripped,
  })
  if (includeCountSubstringOutcomes) {
    collectRuleCountSubstringOutcomeConstraints({ constraints, seen, text: stripped })
  }
  collectRuleConditionalCountOutcomeConstraints({ constraints, seen, text: stripped })

  return constraints.filter((constraint) => constraint.path !== "metadata.event_timestamp")
}

function collectRuleReferenceListConstraints({
  constraints,
  includeDirectReferenceLists = true,
  includeHelperReferenceLists = true,
  seen,
  text,
}: {
  constraints: RuleDerivedConstraint[]
  includeDirectReferenceLists?: boolean
  includeHelperReferenceLists?: boolean
  seen: Set<string>
  text: string
}) {
  const placeholderFields = extractRulePlaceholderSourceFields(text)
  if (includeDirectReferenceLists) {
    for (const match of text.matchAll(/\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s+in\s+regex\s+%(\w+)(?:\.(\w+))?/gi)) {
      if (isNegatedRuleReferenceListUse(text, match.index)) {
        continue
      }
      addRuleDerivedConstraint({
        allowVariation: true,
        constraints,
        path: normalizeRuleDerivedPath(match[2] ?? ""),
        seen,
        value: sampleValueForReferenceListPath(match[2] ?? "", match[3] ?? "", match[4]),
        variable: match[1] ?? "",
      })
    }
    for (const match of text.matchAll(/\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s+in\s+%(\w+)(?:\.(\w+))?/gi)) {
      if (isNegatedRuleReferenceListUse(text, match.index)) {
        continue
      }
      const variable = match[1]
      const path = normalizeRuleDerivedPath(match[2] ?? "")
      if (!variable || !path) {
        continue
      }
      addRuleDerivedConstraint({
        constraints,
        path,
        seen,
        value: getRuleDerivedConstraintValue(constraints, variable, path) ?? defaultRuleJoinValue(path),
        variable,
      })
    }

    for (const match of text.matchAll(/\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*={1,2}\s*%(\w+)(?:\.(\w+))?/gi)) {
      if (isNegatedRuleReferenceListUse(text, match.index)) {
        continue
      }
      const variable = match[1]
      const path = normalizeRuleDerivedPath(match[2] ?? "")
      const tableName = match[3]
      const columnName = match[4]
      if (!variable || !path || !tableName) {
        continue
      }
      addRuleDerivedConstraint({
        constraints,
        path,
        seen,
        value: sampleValueForReferenceListPath(path, tableName, columnName),
        variable,
      })
    }
  }

  if (includeDirectReferenceLists) {
    for (const match of text.matchAll(/\$(\w+)\s+in\s+%(\w+)(?:\.(\w+))?/gi)) {
      if (isNegatedRuleReferenceListUse(text, match.index)) {
        continue
      }
      const placeholder = match[1]
      const tableName = match[2]
      const columnName = match[3]
      if (!placeholder || !tableName) {
        continue
      }
      for (const field of placeholderFields.get(placeholder) ?? []) {
        addRuleDerivedConstraint({
          constraints,
          path: field.path,
          seen,
          value: sampleValueForReferenceListPath(field.path, tableName, columnName),
          variable: field.variable,
        })
      }
    }
  }

  if (includeHelperReferenceLists) {
    for (const match of text.matchAll(
      /re\.replace\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")\s*,\s*"((?:\\.|[^"\\])*)"\s*\)\s+in\s+%(\w+)(?:\.(\w+))?/gi
    )) {
      if (isNegatedRuleReferenceListUse(text, match.index)) {
        continue
      }
      const variable = match[1]
      const path = normalizeRuleDerivedPath(match[2] ?? "")
      if (!variable || !path) {
        continue
      }
      addRuleDerivedConstraint({
        constraints,
        path,
        seen,
        value: getRuleDerivedConstraintValue(constraints, variable, path) ?? defaultRuleJoinValue(path),
        variable,
      })
    }

    for (const match of text.matchAll(
      /re\.capture\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")(?:\s*,\s*\d+)?\s*\)\s+in\s+%(\w+)(?:\.(\w+))?/gi
    )) {
      if (isNegatedRuleReferenceListUse(text, match.index)) {
        continue
      }
      const variable = match[1]
      const path = normalizeRuleDerivedPath(match[2] ?? "")
      const tableName = match[4]
      const columnName = match[5]
      if (!variable || !path || !tableName) {
        continue
      }
      const capturedValue = sampleValueForCaptureReferenceList(path, tableName, columnName)
      addRuleDerivedConstraint({
        allowVariation: true,
        constraints,
        path,
        seen,
        value: sampleSourceForCapturePattern(match[3] ?? "", capturedValue),
        variable,
      })
    }
  }
}

function sampleValueForReferenceListPath(path: string, tableName: string, columnName?: string) {
  const normalized = `${path}.${tableName}.${columnName ?? ""}`.toLowerCase()
  if (normalized.includes("ntds")) {
    return "ntdsutil"
  }
  if (normalized.includes("hacktool") || normalized.includes("process") || normalized.includes("file")) {
    return "C:\\Tools\\Akagi.exe"
  }
  if (normalized.includes("domain") || normalized.includes("hostname")) {
    return "suspicious.example"
  }
  if (normalized.includes("ip")) {
    return "10.0.4.20"
  }
  return "reference-list-value"
}

function parseRuleDerivedReferenceName(name: string) {
  const [tableName = "", ...columnParts] = name.split(".")
  return {
    columnName: columnParts.length ? columnParts.join(".") : undefined,
    tableName,
  }
}

function sampleValueForCaptureReferenceList(path: string, tableName: string, columnName?: string) {
  return sampleValueForReferenceListPath(path, tableName, columnName).replace(/\.exe$/i, "")
}

function sampleSourceForCapturePattern(pattern: string, capturedValue: string) {
  const source = unwrapRuleRegexPattern(pattern)
  if (/\\+\(\.\*\).*\\?\.exe/i.test(source)) {
    return `C:\\Windows\\System32\\${capturedValue}.exe`
  }
  return sampleValueFromCapturePattern(pattern, capturedValue)
}

function collectRuleCountSubstringOutcomeConstraints({
  constraints,
  seen,
  text,
}: {
  constraints: RuleDerivedConstraint[]
  seen: Set<string>
  text: string
}) {
  const outcomeSection = extractRuleSection(text, "outcome")
  const conditionSection = extractRuleSection(text, "condition")
  const countFields = new Map<string, { path: string; substring: string; variable: string }>()
  const countPattern =
    /\$(\w+)\s*=\s*max\(\s*strings\.count_substrings\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*"((?:\\.|[^"\\])*)"\s*\)\s*\)/gi
  for (const match of outcomeSection.matchAll(countPattern)) {
    const outcome = match[1]
    const variable = match[2]
    const path = normalizeRuleDerivedPath(match[3] ?? "")
    const substring = unescapeQuotedRuleString(match[4] ?? "")
    if (!outcome || !variable || !path || !substring) {
      continue
    }
    countFields.set(outcome, { path, substring, variable })
  }

  const deltaPattern =
    /math\.abs\(\s*\$(\w+)\s*-\s*\$(\w+)\s*\)\s*(?:>|>=)\s*(\d+)/gi
  for (const match of conditionSection.matchAll(deltaPattern)) {
    const left = countFields.get(match[1] ?? "")
    const right = countFields.get(match[2] ?? "")
    const threshold = Number(match[3])
    if (!left || !right || !Number.isInteger(threshold)) {
      continue
    }
    upsertRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: left.path,
      seen,
      value: Array.from({ length: threshold + 2 }, (_, index) => `${left.substring}${index + 1}`).join(" "),
      variable: left.variable,
    })
    upsertRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: right.path,
      seen,
      value: right.substring,
      variable: right.variable,
    })
  }

  const deltaOutcomes = new Map<string, { left: string; right: string }>()
  const deltaOutcomePattern = /\$(\w+)\s*=\s*math\.abs\(\s*\$(\w+)\s*-\s*\$(\w+)\s*\)/gi
  for (const match of outcomeSection.matchAll(deltaOutcomePattern)) {
    const outcome = match[1]
    const left = match[2]
    const right = match[3]
    if (outcome && left && right) {
      deltaOutcomes.set(outcome, { left, right })
    }
  }

  const outcomeThresholdPattern = /\$(\w+)\s*(?:>|>=)\s*(\d+)/gi
  for (const match of conditionSection.matchAll(outcomeThresholdPattern)) {
    const delta = deltaOutcomes.get(match[1] ?? "")
    const threshold = Number(match[2])
    if (!delta || !Number.isInteger(threshold)) {
      continue
    }
    const left = countFields.get(delta.left)
    const right = countFields.get(delta.right)
    if (!left || !right) {
      continue
    }
    upsertRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: left.path,
      seen,
      value: Array.from({ length: threshold + 2 }, (_, index) => `${left.substring}${index + 1}`).join(" "),
      variable: left.variable,
    })
    upsertRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: right.path,
      seen,
      value: right.substring,
      variable: right.variable,
    })
  }
}

function extractRuleDerivedReferenceDataTables(
  ruleText: string,
  constraints: RuleDerivedConstraint[],
  options: RuleDerivedReferenceDataTableOptions = {}
): YaralEvaluationDataTable[] {
  const includeDirectReferenceLists = options.includeDirectReferenceLists ?? true
  const includeHelperReferenceLists = options.includeHelperReferenceLists ?? true
  const stripped = stripYaralComments(ruleText)
  const placeholderFields = extractRulePlaceholderSourceFields(stripped)
  const rows = new Map<string, unknown[]>()

  if (includeHelperReferenceLists) {
    for (const match of stripped.matchAll(
      /re\.replace\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")\s*,\s*"((?:\\.|[^"\\])*)"\s*\)\s+in\s+%(\w+)(?:\.(\w+))?/gi
    )) {
      if (isNegatedRuleReferenceListUse(stripped, match.index)) {
        continue
      }
      const variable = match[1]
      const path = normalizeRuleDerivedPath(match[2] ?? "")
      const tableName = match[5]
      const columnName = match[6]
      if (!variable || !path || !tableName) {
        continue
      }
      const baseValue = getRuleDerivedConstraintValue(constraints, variable, path) ?? defaultRuleJoinValue(path)
      const value = applySimpleRuleDerivedReplace(baseValue, match[3] ?? "", match[4] ?? "")
      addRuleDerivedReferenceRow(rows, tableName, value, columnName)
    }

    for (const match of stripped.matchAll(
      /re\.capture\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")(?:\s*,\s*\d+)?\s*\)\s+in\s+%(\w+)(?:\.(\w+))?/gi
    )) {
      if (isNegatedRuleReferenceListUse(stripped, match.index)) {
        continue
      }
      const tableName = match[4]
      const columnName = match[5]
      if (!tableName) {
        continue
      }
      addRuleDerivedReferenceRow(
        rows,
        tableName,
        sampleValueForCaptureReferenceList(match[2] ?? "", tableName, columnName),
        columnName
      )
    }
  }

  if (includeDirectReferenceLists) {
    for (const match of stripped.matchAll(
      /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s+in\s+regex\s+%(\w+)(?:\.(\w+))?/gi
    )) {
      if (isNegatedRuleReferenceListUse(stripped, match.index)) {
        continue
      }
      const tableName = match[3]
      const columnName = match[4]
      if (!tableName) {
        continue
      }
      addRuleDerivedReferenceRow(rows, tableName, sampleRegexForReferenceList(tableName), columnName)
    }

    for (const match of stripped.matchAll(
      /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s+in\s+%(\w+)(?:\.(\w+))?/gi
    )) {
      if (isNegatedRuleReferenceListUse(stripped, match.index)) {
        continue
      }
      const variable = match[1]
      const path = normalizeRuleDerivedPath(match[2] ?? "")
      const tableName = match[3]
      const columnName = match[4]
      if (!variable || !path || !tableName) {
        continue
      }
      addRuleDerivedReferenceRow(
        rows,
        tableName,
        getRuleDerivedConstraintValue(constraints, variable, path) ?? defaultRuleJoinValue(path),
        columnName
      )
    }

    for (const match of stripped.matchAll(
      /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*={1,2}\s*%(\w+)(?:\.(\w+))?/gi
    )) {
      if (isNegatedRuleReferenceListUse(stripped, match.index)) {
        continue
      }
      const variable = match[1]
      const path = normalizeRuleDerivedPath(match[2] ?? "")
      const tableName = match[3]
      const columnName = match[4]
      if (!variable || !path || !tableName) {
        continue
      }
      addRuleDerivedReferenceRow(
        rows,
        tableName,
        getRuleDerivedConstraintValue(constraints, variable, path) ??
          sampleValueForReferenceListPath(path, tableName, columnName),
        columnName
      )
    }

    for (const match of stripped.matchAll(/\$(\w+)\s+in\s+%(\w+)(?:\.(\w+))?/gi)) {
      if (isNegatedRuleReferenceListUse(stripped, match.index)) {
        continue
      }
      const placeholder = match[1]
      const tableName = match[2]
      const columnName = match[3]
      if (!placeholder || !tableName) {
        continue
      }
      for (const field of placeholderFields.get(placeholder) ?? []) {
        addRuleDerivedReferenceRow(
          rows,
          tableName,
          getRuleDerivedConstraintValue(constraints, field.variable, field.path) ??
            sampleValueForReferenceListPath(field.path, tableName, columnName),
          columnName
        )
      }
    }
  }

  return toRuleDerivedDataTables(rows)
}

function sampleRegexForReferenceList(tableName: string) {
  const normalized = tableName.toLowerCase()
  if (normalized.includes("hacktool")) {
    return "(?i)Akagi\\.exe"
  }
  if (normalized.includes("ntds") || normalized.includes("dit")) {
    return "(?i)ntds\\.dit"
  }
  return "(?i)reference-list-value"
}

function isNegatedRuleReferenceListUse(text: string, matchIndex: number) {
  return /\bnot\s*$/i.test(text.slice(Math.max(0, matchIndex - 16), matchIndex))
}

function addRuleDerivedReferenceRow(
  rows: Map<string, unknown[]>,
  tableName: string,
  value: unknown,
  columnName?: string
) {
  rows.set(tableName, [
    ...(rows.get(tableName) ?? []),
    columnName ? createRuleDerivedReferenceRow(columnName, value) : value,
  ])
}

function createRuleDerivedReferenceRow(columnName: string, value: unknown) {
  const parts = columnName.split(".").filter(Boolean)
  if (!parts.length) {
    return value
  }
  let row: unknown = value
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    row = { [parts[index] ?? "value"]: row }
  }
  return row
}

function applySimpleRuleDerivedReplace(
  value: unknown,
  pattern: string,
  replacement: string
) {
  const text = String(value ?? "")
  const source = unwrapRuleRegexPattern(pattern)
  const unescapedReplacement = unescapeQuotedRuleString(replacement)
  if (source === "@.*$") {
    return text.replace(/@.*$/, unescapedReplacement)
  }
  try {
    return text.replace(new RegExp(source), unescapedReplacement)
  } catch {
    return text
  }
}

function extractRuleEventVariables(ruleText: string) {
  const eventsSection = extractRuleSection(stripYaralComments(ruleText), "events")
  const variables: string[] = []
  const seen = new Set<string>()
  for (const match of eventsSection.matchAll(/\$(\w+)\s*\./g)) {
    const variable = match[1]
    if (!variable || seen.has(variable)) {
      continue
    }
    seen.add(variable)
    variables.push(variable)
  }
  return variables
}

function extractRuleEventCounts(ruleText: string) {
  const counts = new Map<string, number>()
  const stripped = stripYaralComments(ruleText)
  const countPattern = /#(\w+)\s*(>=|>|=|==)\s*(\d+)/g
  for (const match of stripped.matchAll(countPattern)) {
    const variable = match[1]
    const operator = match[2]
    const count = Number(match[3])
    if (!variable || !operator || !Number.isInteger(count) || count <= 0) {
      continue
    }
    counts.set(variable, Math.min(MAX_RULE_DERIVED_EVENTS_PER_VARIABLE, operator === ">" ? count + 1 : count))
  }
  return counts
}

function extractRuleDerivedCountModel(
  ruleText: string,
  options: { includeRawEventCounts?: boolean } = {}
) {
  const stripped = stripYaralComments(ruleText)
  const eventCounts = options.includeRawEventCounts ? extractRuleEventCounts(stripped) : new Map<string, number>()
  const varyingFields = extractRuleVaryingFields(stripped)
  const placeholderFields = extractRulePlaceholderSourceFields(stripped)
  const conditionSection = extractRuleSection(stripped, "condition")
  const matchSection = extractRuleSection(stripped, "match")
  const conditionalCountTargets = selectRuleConditionalCountTargets(stripped)

  for (const match of conditionSection.matchAll(/#(\w+)\s*(>=|>|=|==)\s*(\d+)/g)) {
    const placeholder = match[1]
    const operator = match[2]
    const count = Number(match[3])
    if (!placeholder || !operator || !Number.isInteger(count) || count <= 0) {
      continue
    }
    const requiredCount = Math.min(MAX_RULE_DERIVED_EVENTS_PER_VARIABLE, operator === ">" ? count + 1 : count)
    for (const field of placeholderFields.get(placeholder) ?? []) {
      eventCounts.set(field.variable, Math.max(eventCounts.get(field.variable) ?? 0, requiredCount))
      addVaryingField(varyingFields, field.variable, field.path)
    }
  }

  const outcomeCountFields = extractRuleOutcomeCountDistinctFields(stripped, placeholderFields)
  for (const match of conditionSection.matchAll(/\$(\w+)\s*(>=|>|=|==)\s*(\d+)/g)) {
    const outcome = match[1]
    const operator = match[2]
    const count = Number(match[3])
    const fields = outcome ? outcomeCountFields.get(outcome) : undefined
    if (!fields?.length || !operator || !Number.isInteger(count) || count <= 0) {
      continue
    }
    if ((operator === "=" || operator === "==") && count === 1) {
      for (const field of fields) {
        removeVaryingField(varyingFields, field.variable, field.path)
      }
      continue
    }
    const requiredCount = Math.min(MAX_RULE_DERIVED_EVENTS_PER_VARIABLE, operator === ">" ? count + 1 : count)
    for (const field of fields) {
      eventCounts.set(field.variable, Math.max(eventCounts.get(field.variable) ?? 0, requiredCount))
      addVaryingField(varyingFields, field.variable, field.path)
    }
  }

  for (const target of conditionalCountTargets) {
    eventCounts.set(target.variable, Math.max(eventCounts.get(target.variable) ?? 0, target.requiredCount))
    addVaryingField(varyingFields, target.variable, target.valuePath)
  }

  keepCountedMatchFieldsStable({
    eventCounts,
    matchSection,
    placeholderFields,
    varyingFields,
  })

  return { eventCounts, varyingFields }
}

type RuleConditionalCountOutcome = {
  keyPath: string
  keyPattern: string
  outcome: string
  valuePath: string
  variable: string
}

type RuleConditionalCountTarget = RuleConditionalCountOutcome & {
  requiredCount: number
}

function extractRuleConditionalCountOutcomes(ruleText: string): Map<string, RuleConditionalCountOutcome> {
  const outcomeSection = extractRuleSection(ruleText, "outcome")
  const outcomes = new Map<string, RuleConditionalCountOutcome>()
  const pattern =
    /\$(\w+)\s*=\s*count_distinct\(\s*if\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*={1,2}\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")\s*,\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,/gi
  for (const match of outcomeSection.matchAll(pattern)) {
    const outcome = match[1]
    const variable = match[2]
    const keyPath = normalizeRuleDerivedPath(match[3] ?? "")
    const keyPattern = match[4] ?? ""
    const valueVariable = match[5]
    const valuePath = normalizeRuleDerivedPath(match[6] ?? "")
    if (!outcome || !variable || !keyPath || !keyPattern || valueVariable !== variable || !valuePath) {
      continue
    }
    outcomes.set(outcome, { keyPath, keyPattern, outcome, valuePath, variable })
  }
  return outcomes
}

function selectRuleConditionalCountTargets(ruleText: string): RuleConditionalCountTarget[] {
  const outcomeSection = extractRuleSection(ruleText, "outcome")
  const conditionSection = extractRuleSection(ruleText, "condition")
  const countOutcomes = extractRuleConditionalCountOutcomes(ruleText)
  const targets = new Map<string, RuleConditionalCountTarget>()

  const addTarget = (countOutcome: RuleConditionalCountOutcome | undefined, requiredCount: number) => {
    if (!countOutcome) return
    const key = `${countOutcome.variable}:${countOutcome.keyPath}:${countOutcome.valuePath}`
    const existing = targets.get(key)
    targets.set(key, {
      ...countOutcome,
      requiredCount: Math.max(existing?.requiredCount ?? 0, Math.min(MAX_RULE_DERIVED_EVENTS_PER_VARIABLE, requiredCount)),
    })
  }

  for (const match of outcomeSection.matchAll(/\$(\w+)\s*=\s*\$(\w+)\s*-\s*\$(\w+)/g)) {
    const diffOutcome = match[1]
    const left = countOutcomes.get(match[2] ?? "")
    const right = countOutcomes.get(match[3] ?? "")
    if (!diffOutcome || !left || !right) {
      continue
    }
    const condition = new RegExp(`\\$${escapeRegExp(diffOutcome)}\\s*(>=|>|=|==)\\s*(\\d+)`, "g")
    for (const conditionMatch of conditionSection.matchAll(condition)) {
      const operator = conditionMatch[1]
      const threshold = Number(conditionMatch[2])
      if (!operator || !Number.isInteger(threshold) || threshold <= 0) {
        continue
      }
      addTarget(left, operator === ">" ? threshold + 2 : threshold + 1)
    }
  }

  for (const match of conditionSection.matchAll(/\$(\w+)\s*(>=|>|=|==)\s*(\d+)/g)) {
    const outcome = match[1]
    if (!outcome) continue
    const assignment = findRuleOutcomeAssignment(outcomeSection, outcome)
    if (!assignment) continue
    for (const countOutcome of countOutcomes.values()) {
      if (!assignment.includes(`$${countOutcome.outcome}`)) continue
      const preferredNewCount = /new|added|created/i.test(countOutcome.outcome)
      addTarget(countOutcome, preferredNewCount ? 4 : 1)
    }
  }

  return [...targets.values()]
}

function collectRuleConditionalCountOutcomeConstraints({
  constraints,
  seen,
  text,
}: {
  constraints: RuleDerivedConstraint[]
  seen: Set<string>
  text: string
}) {
  for (const target of selectRuleConditionalCountTargets(text)) {
    upsertRuleDerivedConstraint({
      constraints,
      path: target.keyPath,
      replaceExisting: true,
      seen,
      value: sampleValueFromRegexPattern(target.keyPattern),
      variable: target.variable,
    })
    upsertRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: target.valuePath,
      replaceExisting: true,
      seen,
      value: defaultRuleJoinValue(target.valuePath),
      variable: target.variable,
    })
  }
}

function findRuleOutcomeAssignment(outcomeSection: string, outcome: string) {
  const pattern = new RegExp(`\\$${escapeRegExp(outcome)}\\s*=([^\\n]+(?:\\n\\s*[^\\$\\n][^\\n]*)*)`, "i")
  return outcomeSection.match(pattern)?.[1] ?? ""
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function keepCountedMatchFieldsStable({
  eventCounts,
  matchSection,
  placeholderFields,
  varyingFields,
}: {
  eventCounts: Map<string, number>
  matchSection: string
  placeholderFields: Map<string, RuleDerivedVariableField[]>
  varyingFields: Map<string, Set<string>>
}) {
  for (const match of matchSection.matchAll(/\$(\w+)\b/g)) {
    const placeholder = match[1]
    if (!placeholder) {
      continue
    }
    for (const field of placeholderFields.get(placeholder) ?? []) {
      if ((eventCounts.get(field.variable) ?? 0) <= 1) {
        continue
      }
      const paths = varyingFields.get(field.variable)
      if (!paths) {
        continue
      }
      paths.delete(field.path)
      if (paths.size === 0) {
        varyingFields.delete(field.variable)
      }
    }
  }
}

function extractRulePlaceholderSourceFields(ruleText: string) {
  const fields = new Map<string, RuleDerivedVariableField[]>()
  const patterns = [
    /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*={1,2}\s*\$(\w+)\b/g,
    /\$(\w+)\s*={1,2}\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\b/g,
  ]

  for (const match of ruleText.matchAll(patterns[0])) {
    addRulePlaceholderSourceField(fields, match[3], match[1], match[2])
  }
  for (const match of ruleText.matchAll(patterns[1])) {
    addRulePlaceholderSourceField(fields, match[1], match[2], match[3])
  }
  for (const match of ruleText.matchAll(
    /re\.capture\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(?:\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")(?:\s*,\s*\d+)?\s*\)\s*={1,2}\s*\$(\w+)\b/gi
  )) {
    addRulePlaceholderSourceField(fields, match[3], match[1], match[2])
  }
  for (const match of ruleText.matchAll(
    /\$(\w+)\s*={1,2}\s*re\.capture\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(?:\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")(?:\s*,\s*\d+)?\s*\)/gi
  )) {
    addRulePlaceholderSourceField(fields, match[1], match[2], match[3])
  }
  return fields
}

function addRulePlaceholderSourceField(
  fields: Map<string, RuleDerivedVariableField[]>,
  placeholder: string | undefined,
  variable: string | undefined,
  path: string | undefined
) {
  const normalizedPath = normalizeRuleDerivedPath(path ?? "")
  if (!placeholder || !variable || !normalizedPath || normalizedPath.startsWith("metadata.event_timestamp")) {
    return
  }
  const items = fields.get(placeholder) ?? []
  if (!items.some((item) => item.variable === variable && item.path === normalizedPath)) {
    items.push({ path: normalizedPath, variable })
  }
  fields.set(placeholder, items)
}

function extractRuleOutcomeCountDistinctFields(
  ruleText: string,
  placeholderFields: Map<string, RuleDerivedVariableField[]>
) {
  const fields = new Map<string, RuleDerivedVariableField[]>()
  const outcomeSection = extractRuleSection(ruleText, "outcome")
  const pattern = /\$(\w+)\s*=\s*(?:count_distinct|count)\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*\)/gi
  for (const match of outcomeSection.matchAll(pattern)) {
    const outcome = match[1]
    const variable = match[2]
    const path = normalizeRuleDerivedPath(match[3] ?? "")
    if (!outcome || !variable || !path || path.startsWith("metadata.event_timestamp")) {
      continue
    }
    fields.set(outcome, [{ path, variable }])
  }

  const placeholderPattern = /\$(\w+)\s*=\s*(?:count_distinct|count)\(\s*\$(\w+)\s*\)/gi
  for (const match of outcomeSection.matchAll(placeholderPattern)) {
    const outcome = match[1]
    const placeholder = match[2]
    const sourceFields = placeholder ? placeholderFields.get(placeholder) : undefined
    if (!outcome || !sourceFields?.length) {
      continue
    }
    fields.set(outcome, sourceFields)
  }
  return fields
}

function extractRuleVaryingFields(ruleText: string) {
  const fields = new Map<string, Set<string>>()
  const outcomeSection = extractRuleSection(stripYaralComments(ruleText), "outcome")
  const aggregateFieldPattern =
    /\bcount_distinct\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*\)/gi
  for (const match of outcomeSection.matchAll(aggregateFieldPattern)) {
    const variable = match[1]
    const path = normalizeRuleDerivedPath(match[2] ?? "")
    if (!variable || !path || path.startsWith("metadata.event_timestamp")) {
      continue
    }
    addVaryingField(fields, variable, path)
  }
  return fields
}

function addVaryingField(fields: Map<string, Set<string>>, variable: string, path: string) {
  const paths = fields.get(variable) ?? new Set<string>()
  paths.add(path)
  fields.set(variable, paths)
}

function removeVaryingField(fields: Map<string, Set<string>>, variable: string, path: string) {
  const paths = fields.get(variable)
  if (!paths) {
    return
  }
  paths.delete(path)
  if (paths.size === 0) {
    fields.delete(variable)
  }
}

function extractRuleMatchWindow(ruleText: string): RuleDerivedMatchWindow | null {
  const matchSection = extractRuleSection(stripYaralComments(ruleText), "match")
  const match = matchSection.match(/\b(over|by)\s+(\d+[smhd])(?:\s+(after|before)\s+\$(\w+))?/i)
  if (!match) {
    return null
  }
  const token = match[1]?.toLowerCase()
  const duration = match[2]
  const minutes = duration ? parseYaralDurationMinutes(duration) : null
  if (!token || minutes === null) {
    return null
  }
  const direction = (match[3]?.toLowerCase() as "after" | "before" | undefined) ?? null
  const pivot = match[4] ?? null
  return {
    direction,
    durationMs: Math.max(60_000, minutes * 60_000),
    kind: token === "by" ? "tumbling" : direction && pivot ? "sliding" : "hop",
    pivot,
  }
}

function getRuleDerivedPositiveTimestamp({
  eventIndex,
  matchWindow,
  occurrence,
  startTime,
  variable,
  variableIndex,
}: {
  eventIndex: number
  matchWindow: RuleDerivedMatchWindow | null
  occurrence: number
  startTime: number
  variable: string
  variableIndex: number
}) {
  if (!matchWindow) {
    return startTime + eventIndex * 60_000
  }

  const safeStepMs = Math.max(1_000, Math.min(60_000, Math.floor(matchWindow.durationMs / 6)))
  const offset = Math.min(matchWindow.durationMs - 1_000, (variableIndex + occurrence + 1) * safeStepMs)
  const globalOffset = Math.min(matchWindow.durationMs - 1_000, (eventIndex + 1) * safeStepMs)
  if (matchWindow.kind === "sliding" && matchWindow.pivot) {
    if (matchWindow.direction === "after") {
      return variable === matchWindow.pivot
        ? startTime + occurrence * 1_000
        : startTime + offset
    }
    if (matchWindow.direction === "before") {
      return variable === matchWindow.pivot
        ? startTime + matchWindow.durationMs
        : startTime + Math.max(0, matchWindow.durationMs - offset)
    }
  }

  return startTime + globalOffset
}

function getRuleDerivedNearMissTimestamp({
  index,
  matchWindow,
  startTime,
}: {
  index: number
  matchWindow: RuleDerivedMatchWindow | null
  startTime: number
}) {
  const outsideWindowMs = (matchWindow?.durationMs ?? 5 * 60_000) + 2 * 60_000
  return startTime + outsideWindowMs + index * 60_000
}

function extractRuleSection(ruleText: string, sectionName: string) {
  const pattern = new RegExp(
    `^\\s*${sectionName}\\s*:\\s*([\\s\\S]*?)(?=^\\s*(?:meta|events|match|outcome|condition|options)\\s*:|^\\s*})`,
    "im"
  )
  return ruleText.match(pattern)?.[1] ?? ""
}

function extractRulePlaceholderValues(ruleText: string) {
  const values = new Map<string, string | number | boolean>()

  collectRulePlaceholderValues({
    pattern: /\$(\w+)\s*={1,2}\s*"((?:\\.|[^"\\])*)"/g,
    text: ruleText,
    values,
    valueForMatch: (match) => unescapeQuotedRuleString(match[2] ?? ""),
  })
  collectRulePlaceholderValues({
    pattern: /\$(\w+)\s*={1,2}\s*(-?\d+(?:\.\d+)?)/g,
    text: ruleText,
    values,
    valueForMatch: (match) => Number(match[2]),
  })
  collectRulePlaceholderValues({
    pattern: /\$(\w+)\s*={1,2}\s*(true|false)\b/gi,
    text: ruleText,
    values,
    valueForMatch: (match) => (match[2] ?? "").toLowerCase() === "true",
  })
  collectRulePlaceholderValues({
    pattern: /\$(\w+)\s+regex\s+(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")/gi,
    text: ruleText,
    values,
    valueForMatch: (match) => sampleValueFromRegexPattern(match[2] ?? ""),
  })
  collectRulePlaceholderValues({
    pattern: /\$(\w+)\s*={1,2}\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`)/gi,
    text: ruleText,
    values,
    valueForMatch: (match) => sampleValueFromRegexPattern(match[2] ?? ""),
  })
  collectRulePlaceholderValues({
    pattern: /\$(\w+)\s*={1,2}\s*re\.capture\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")(?:\s*,\s*\d+)?\s*\)/gi,
    text: ruleText,
    values,
    valueForMatch: (match) =>
      hasRuleRegexCapturingGroup(unwrapRuleRegexPattern(match[4] ?? ""))
        ? defaultRulePlaceholderValue(match[1] ?? "")
        : sampleValueFromRegexPatternForPath(match[3] ?? "", match[4] ?? ""),
  })
  collectRulePlaceholderInequalityValues(ruleText, values)

  return values
}

function collectRulePlaceholderInequalityValues(
  ruleText: string,
  values: Map<string, string | number | boolean>
) {
  for (const match of ruleText.matchAll(/\$(\w+)\s*!=\s*\$(\w+)\b/g)) {
    const left = match[1]
    const right = match[2]
    if (!left || !right) {
      continue
    }
    const [leftValue, rightValue] = defaultRuleDistinctValues(left, right)
    values.set(left, maybePrefixEmailDomainPlaceholder(left, leftValue))
    values.set(right, maybePrefixEmailDomainPlaceholder(right, rightValue))
  }
}

function maybePrefixEmailDomainPlaceholder(
  placeholder: string,
  value: string | number | boolean
) {
  if (typeof value !== "string") {
    return value
  }
  const normalized = placeholder.toLowerCase()
  if (normalized.includes("domain") && !value.startsWith("@")) {
    return `@${value}`
  }
  return value
}

function collectRulePlaceholderValues({
  pattern,
  text,
  values,
  valueForMatch,
}: {
  pattern: RegExp
  text: string
  values: Map<string, string | number | boolean>
  valueForMatch: (match: RegExpExecArray) => string | number | boolean
}) {
  for (const match of text.matchAll(pattern)) {
    const placeholder = match[1]
    if (!placeholder || values.has(placeholder)) {
      continue
    }
    values.set(placeholder, valueForMatch(match))
  }
}

function collectRulePlaceholderFieldConstraints({
  constraints,
  placeholderValues,
  seen,
  text,
}: {
  constraints: RuleDerivedConstraint[]
  placeholderValues: Map<string, string | number | boolean>
  seen: Set<string>
  text: string
}) {
  const fieldToPlaceholderPattern = /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*={1,2}\s*\$(\w+)\b/g
  for (const match of text.matchAll(fieldToPlaceholderPattern)) {
    addPlaceholderFieldConstraint({
      constraints,
      path: normalizeRuleDerivedPath(match[2] ?? ""),
      placeholder: match[3],
      placeholderValues,
      seen,
      variable: match[1],
    })
  }

  const placeholderToFieldPattern = /\$(\w+)\s*={1,2}\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\b/g
  for (const match of text.matchAll(placeholderToFieldPattern)) {
    addPlaceholderFieldConstraint({
      constraints,
      path: normalizeRuleDerivedPath(match[3] ?? ""),
      placeholder: match[1],
      placeholderValues,
      seen,
      variable: match[2],
    })
  }
}

function addPlaceholderFieldConstraint({
  constraints,
  path,
  placeholder,
  placeholderValues,
  seen,
  variable,
}: {
  constraints: RuleDerivedConstraint[]
  path: string | undefined
  placeholder: string | undefined
  placeholderValues: Map<string, string | number | boolean>
  seen: Set<string>
  variable: string | undefined
}) {
  if (!variable || !path || !placeholder || path.startsWith("metadata.event_timestamp")) {
    return
  }
  const existingFieldValue = getRuleDerivedConstraintValue(constraints, variable, path)
  const hasExplicitPlaceholderValue = placeholderValues.has(placeholder)
  const value =
    placeholderValues.get(placeholder) ??
    existingFieldValue ??
    defaultRulePlaceholderValueForPath(placeholder, path)
  if (!placeholderValues.has(placeholder)) {
    placeholderValues.set(placeholder, value)
  }
  const key = `${variable}.${path}`
  if (seen.has(key)) {
    const existing = constraints.find((constraint) =>
      constraint.variable === variable && constraint.path === path
    )
    if (existing?.replaceExisting) {
      existing.allowVariation = true
      existing.replaceExisting = false
      existing.value = value
    }
    if (existing && isRuleDerivedDomainLikePath(path)) {
      existing.allowVariation = true
      existing.value = value
    }
    if (
      existing &&
      hasExplicitPlaceholderValue &&
      existingFieldValue !== undefined &&
      existingFieldValue !== value
    ) {
      existing.allowVariation = true
      existing.replaceExisting = false
      existing.value = value
    }
    return
  }
  seen.add(key)
  constraints.push({ allowVariation: true, path, value, variable })
}

function collectRuleFieldJoinConstraints({
  constraints,
  seen,
  text,
}: {
  constraints: RuleDerivedConstraint[]
  seen: Set<string>
  text: string
}) {
  const fieldJoinPattern =
    /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*={1,2}\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\b/g
  for (const match of text.matchAll(fieldJoinPattern)) {
    const leftVariable = match[1]
    const leftPath = normalizeRuleDerivedPath(match[2] ?? "")
    const rightVariable = match[3]
    const rightPath = normalizeRuleDerivedPath(match[4] ?? "")
    if (!leftVariable || !leftPath || !rightVariable || !rightPath) {
      continue
    }
    const value =
      getRuleDerivedConstraintValue(constraints, leftVariable, leftPath) ??
      getRuleDerivedConstraintValue(constraints, rightVariable, rightPath) ??
      defaultRuleJoinValue(leftPath, rightPath)
    addRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: leftPath,
      seen,
      value,
      variable: leftVariable,
    })
    addRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path: rightPath,
      seen,
      value,
      variable: rightVariable,
    })
  }
}

function getRuleDerivedConstraintValue(
  constraints: RuleDerivedConstraint[],
  variable: string,
  path: string
) {
  return constraints.find((constraint) => constraint.variable === variable && constraint.path === path)?.value
}

function addRuleDerivedConstraint({
  allowVariation = false,
  allowDuplicate = false,
  constraints,
  mergeWithExisting = false,
  path,
  replaceExisting = false,
  seen,
  value,
  variable,
}: {
  allowVariation?: boolean
  allowDuplicate?: boolean
  constraints: RuleDerivedConstraint[]
  mergeWithExisting?: boolean
  path: string
  replaceExisting?: boolean
  seen: Set<string>
  value: string | number | boolean
  variable: string
}) {
  if (path.startsWith("metadata.event_timestamp")) {
    return
  }
  if (isImpreciseRuleDerivedMapPath(path)) {
    return
  }
  const key = `${variable}.${path}`
  if (!allowDuplicate && seen.has(key)) {
    const existing = constraints.find((constraint) =>
      constraint.variable === variable && constraint.path === path
    )
    if (existing?.replaceExisting && !replaceExisting && allowVariation) {
      existing.allowVariation = allowVariation
      existing.mergeWithExisting = mergeWithExisting
      existing.replaceExisting = false
      existing.value = value
      return
    }
    if (
      allowVariation &&
      mergeWithExisting &&
      existing?.allowVariation &&
      !existing.replaceExisting &&
      typeof existing.value === "string" &&
      typeof value === "string"
    ) {
      existing.value = mergeRuleDerivedStringConstraintValue(path, existing.value, value)
    }
    if (allowVariation && existing && isRuleDerivedDomainLikePath(path)) {
      existing.value = value
    }
    if (allowVariation) {
      if (existing) {
        existing.allowVariation = true
      }
    }
    return
  }
  seen.add(key)
  constraints.push({
    allowDuplicate,
    allowVariation,
    mergeWithExisting,
    path,
    replaceExisting,
    value,
    variable,
  })
}

function mergeRuleDerivedStringConstraintValue(path: string, current: string, next: string) {
  if (!next || current.includes(next)) {
    return current
  }
  if (!current) {
    return next
  }
  const normalized = path.toLowerCase()
  if (normalized.includes("registry")) {
    const registryValue = mergeRuleDerivedRegistryConstraintValue(current, next)
    if (registryValue) {
      return registryValue
    }
    return current
  }
  if (normalized.includes("url")) {
    return mergeRuleDerivedUrlConstraintValue(current, next)
  }
  if (normalized.includes("file") || normalized.includes("path")) {
    const filePathValue = mergeRuleDerivedFilePathConstraintValue(current, next)
    if (filePathValue) {
      return filePathValue
    }
    return current
  }
  if (normalized.includes("command") || normalized.includes("cmd") || normalized.includes("args")) {
    const commandValue = mergeRuleDerivedCommandConstraintValue(current, next)
    if (commandValue) {
      return commandValue
    }
    return `${current} ${next}`
  }
  return `${current} ${next}`
}

function mergeRuleDerivedFilePathConstraintValue(current: string, next: string) {
  const combined = `${current} ${next}`.toLowerCase()
  if (
    combined.includes("\\appdata\\local\\temp\\") &&
    combined.includes("\\lsass") &&
    combined.includes(".dmp")
  ) {
    return "C:\\Users\\Alice\\AppData\\Local\\Temp\\lsass.dmp"
  }
  if (combined.includes("\\appdata\\local\\temp\\") && combined.includes("\\lsass")) {
    return "C:\\Users\\Alice\\AppData\\Local\\Temp\\lsass"
  }
  if (combined.includes(".lnk") && /\\(?:desktop|documents|start menu)\\/.test(combined)) {
    return "C:\\Users\\Alice\\Desktop\\shortcut.lnk"
  }
  return null
}

function mergeRuleDerivedRegistryConstraintValue(current: string, next: string) {
  const currentLower = current.toLowerCase()
  const nextLower = next.toLowerCase()
  const broadRoots = [
    "\\software\\microsoft\\windows\\currentversion",
    "software\\microsoft\\windows\\currentversion\\explorer\\user shell folders",
    "\\system\\currentcontrolset\\control",
    "system\\currentcontrolset\\control\\session manager",
    "\\control\\terminal server\\",
  ]
  if (!broadRoots.some((root) => currentLower.endsWith(root) || currentLower === root)) {
    return null
  }
  if (!next || currentLower.includes(nextLower)) {
    return current
  }
  const suffix = next.startsWith("\\") ? next : `\\${next}`
  return `${current}${suffix}`
}

function mergeRuleDerivedCommandConstraintValue(current: string, next: string) {
  const currentLower = current.toLowerCase()
  const nextLower = next.toLowerCase()
  if (currentLower.includes("\\cmd.exe\" /c") && nextLower.includes("\\cmd.exe\" /c")) {
    const preferred = nextLower.includes("\\windows\\system32\\cmd.exe") ? next : current
    return /\s\/c\s+\S/i.test(preferred) ? preferred : `${preferred} whoami`
  }
  return null
}

function mergeRuleDerivedUrlConstraintValue(current: string, next: string) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(next) || next.startsWith("/")) {
    return `${current} ${next}`
  }
  if (/^[A-Za-z_][\w-]*(?:=|%3D)/.test(next)) {
    const separator = current.includes("?") ? "&" : "?"
    return `${current}${separator}${next}`
  }
  return `${current}${current.endsWith("/") || next.startsWith("/") ? "" : "/"}${next}`
}

function upsertRuleDerivedConstraint({
  allowVariation = false,
  constraints,
  mergeWithExisting = false,
  path,
  replaceExisting = false,
  seen,
  value,
  variable,
}: {
  allowVariation?: boolean
  constraints: RuleDerivedConstraint[]
  mergeWithExisting?: boolean
  path: string
  replaceExisting?: boolean
  seen: Set<string>
  value: string | number | boolean
  variable: string
}) {
  const existing = constraints.find((constraint) =>
    constraint.variable === variable && constraint.path === path
  )
  if (existing) {
    existing.allowDuplicate = true
    existing.allowVariation = allowVariation
    existing.mergeWithExisting = mergeWithExisting
    existing.replaceExisting = replaceExisting
    existing.value = value
    return
  }
  addRuleDerivedConstraint({
    allowDuplicate: true,
    allowVariation,
    constraints,
    mergeWithExisting,
    path,
    replaceExisting,
    seen,
    value,
    variable,
  })
}

function isImpreciseRuleDerivedMapPath(path: string) {
  return path === "additional.fields" || path.endsWith(".additional.fields") ||
    path === "attribute.labels" || path.endsWith(".attribute.labels")
}

function defaultRuleJoinValue(...paths: string[]) {
  const joined = paths.join(".").toLowerCase()
  if (joined.includes("accesskey")) {
    return "access-key-1"
  }
  if (joined.includes("user")) {
    return "alice"
  }
  if (joined.includes("host")) {
    return "WORKSTATION-1"
  }
  if (joined.includes("ip")) {
    return "10.0.4.20"
  }
  if (joined.includes("domain")) {
    return "suspicious.example"
  }
  if (joined.includes("resource")) {
    return "resource-1"
  }
  if (joined.includes("file")) {
    return "report.pdf"
  }
  return "join-value"
}

function defaultRuleDistinctValues(...paths: string[]): [string | number | boolean, string | number | boolean] {
  const joined = paths.join(".").toLowerCase()
  if (joined.includes("domain")) {
    return ["suspicious.example", "benign.example"]
  }
  if (joined.includes("user")) {
    return ["alice", "bob"]
  }
  if (joined.includes("country")) {
    return ["United States", "Canada"]
  }
  if (joined.includes("state")) {
    return ["California", "Texas"]
  }
  if (joined.includes("city")) {
    return ["Austin", "London"]
  }
  if (paths.some((path) => hasRuleDerivedPathSegment(path, "ip"))) {
    return ["10.0.4.20", "10.0.4.21"]
  }
  if (joined.includes("host")) {
    return ["WORKSTATION-1", "WORKSTATION-2"]
  }
  if (joined.includes("resource") || joined.includes("accesskey")) {
    return ["resource-1", "resource-2"]
  }
  return ["left-value", "right-value"]
}

function sampleValueForInequality(path: string, comparedValue: string | number | boolean) {
  if (typeof comparedValue === "boolean") {
    return !comparedValue
  }
  if (typeof comparedValue === "number") {
    return comparedValue + 1
  }
  if (comparedValue.trim()) {
    return mutateRuleDerivedValue(comparedValue, path)
  }
  const normalized = path.toLowerCase()
  if (normalized.includes("accesskey")) {
    return "access-key-1"
  }
  if (hasRuleDerivedPathSegment(path, "ip")) {
    return "10.0.4.20"
  }
  if (normalized.includes("user")) {
    return "alice"
  }
  if (normalized.includes("host")) {
    return "WORKSTATION-1"
  }
  if (normalized.includes("resource")) {
    return "resource-1"
  }
  return "non-empty-value"
}

function defaultRuleNonMatchingValue(path: string) {
  const normalized = path.toLowerCase()
  if (hasRuleDerivedPathSegment(path, "ip")) {
    return "8.8.8.8"
  }
  if (normalized.includes("organization") || normalized.includes("company")) {
    return "Acme Security"
  }
  if (normalized.includes("domain")) {
    return "example.test"
  }
  if (normalized.includes("email")) {
    return "alice@example.test"
  }
  if (normalized.includes("url")) {
    return "https://example.test/resource"
  }
  return "non-matching-value"
}

function collectRuleReplaceJoinConstraints({
  constraints,
  placeholderValues,
  seen,
  text,
}: {
  constraints: RuleDerivedConstraint[]
  placeholderValues: Map<string, string | number | boolean>
  seen: Set<string>
  text: string
}) {
  const replaceJoinPattern =
    /re\.replace\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")\s*,\s*("(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/(?:\\.|[^/\\])+\/[a-z]*)\s*\)\s*={1,2}\s*\$(\w+)\b/gi
  for (const match of text.matchAll(replaceJoinPattern)) {
    const variable = match[1]
    const path = normalizeRuleDerivedPath(match[2] ?? "")
    const placeholder = match[5]
    if (!variable || !path || !placeholder) {
      continue
    }
    const placeholderValue = placeholderValues.get(placeholder) ?? defaultRulePlaceholderValue(placeholder)
    upsertRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path,
      seen,
      value: inverseSimpleRuleDerivedReplace(match[3] ?? "", match[4] ?? "", placeholderValue),
      variable,
    })
  }
}

function inverseSimpleRuleDerivedReplace(
  pattern: string,
  replacement: string,
  desiredValue: string | number | boolean
) {
  const normalizedPattern = stripRuleDerivedPatternDelimiters(pattern)
  const normalizedReplacement = stripRuleDerivedPatternDelimiters(replacement)
  const value = String(desiredValue)
  if (normalizedReplacement === "" && normalizedPattern === "@.*$") {
    return `${value}@example.test`
  }
  return value
}

function stripRuleDerivedPatternDelimiters(value: string) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("`") && trimmed.endsWith("`")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return unescapeQuotedRuleString(trimmed.slice(1, -1))
  }
  const slashMatch = trimmed.match(/^\/((?:\\.|[^/\\])*)\/[a-z]*$/i)
  if (slashMatch) {
    return slashMatch[1] ? unescapeQuotedRuleString(slashMatch[1]) : ""
  }
  return unescapeQuotedRuleString(trimmed)
}

function collectRuleCaptureFieldConstraints({
  constraints,
  placeholderValues,
  seen,
  text,
}: {
  constraints: RuleDerivedConstraint[]
  placeholderValues: Map<string, string | number | boolean>
  seen: Set<string>
  text: string
}) {
  const capturePatterns = [
    {
      pathIndex: 3,
      pattern: /\$(\w+)\s*={1,2}\s*re\.capture\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")(?:\s*,\s*\d+)?\s*\)/gi,
      patternIndex: 4,
      placeholderIndex: 1,
      variableIndex: 2,
    },
    {
      pathIndex: 3,
      pattern: /\$(\w+)\s*={1,2}\s*[^\n]*?re\.capture\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")(?:\s*,\s*\d+)?\s*\)/gi,
      patternIndex: 4,
      placeholderIndex: 1,
      variableIndex: 2,
    },
    {
      pathIndex: 2,
      pattern: /re\.capture\(\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*,\s*(\/(?:\\.|[^/\\])+\/[a-z]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*")(?:\s*,\s*\d+)?\s*\)\s*={1,2}\s*\$(\w+)\b/gi,
      patternIndex: 3,
      placeholderIndex: 4,
      variableIndex: 1,
    },
  ]
  for (const capturePattern of capturePatterns) {
  for (const match of text.matchAll(capturePattern.pattern)) {
    const placeholder = match[capturePattern.placeholderIndex]
    const variable = match[capturePattern.variableIndex]
    const path = normalizeRuleDerivedPath(match[capturePattern.pathIndex] ?? "")
    if (!placeholder || !variable || !path) {
      continue
    }
    const placeholderValue = placeholderValues.get(placeholder) ?? defaultRulePlaceholderValue(placeholder)
    const key = `${variable}.${path}`
    const value = sampleValueFromCapturePattern(match[capturePattern.patternIndex] ?? "", placeholderValue)
    const existing = constraints.find(
      (constraint) => constraint.variable === variable && constraint.path === path
    )
    if (existing) {
      existing.allowDuplicate = true
      existing.allowVariation = true
      existing.replaceExisting = true
      existing.value = value
      continue
    }
    seen.add(key)
    constraints.push({
      allowDuplicate: true,
      allowVariation: true,
      path,
      replaceExisting: true,
      value,
      variable,
    })
  }
  }
}

function collectRuleNumericRangeConstraints({
  constraints,
  seen,
  text,
}: {
  constraints: RuleDerivedConstraint[]
  seen: Set<string>
  text: string
}) {
  const rangePattern = /\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*(>=|>|<=|<)\s*(-?\d+(?:\.\d+)?)/g
  for (const match of text.matchAll(rangePattern)) {
    const variable = match[1]
    const path = normalizeRuleDerivedPath(match[2] ?? "")
    const operator = match[3]
    const threshold = Number(match[4])
    if (!variable || !path || !operator || !Number.isFinite(threshold)) {
      continue
    }
    const key = `${variable}.${path}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    constraints.push({
      path,
      value: operator.includes(">") ? threshold + 1 : threshold - 1,
      variable,
    })
  }
}

function collectRuleRecentTimestampConstraints({
  constraints,
  seen,
  text,
}: {
  constraints: RuleDerivedConstraint[]
  seen: Set<string>
  text: string
}) {
  const recentWindowPattern =
    /(\d+)\s*>\s*timestamp\.current_seconds\(\s*\)\s*-\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)/gi
  for (const match of text.matchAll(recentWindowPattern)) {
    const threshold = Number(match[1])
    const variable = match[2]
    const path = normalizeRuleDerivedPath(match[3] ?? "")
    if (!Number.isFinite(threshold) || !variable || !path) {
      continue
    }
    upsertRuleDerivedConstraint({
      constraints,
      path,
      replaceExisting: true,
      seen,
      value: Math.floor(Date.now() / 1000) - Math.max(1, Math.floor(threshold / 2)),
      variable,
    })
  }
}

function collectRuleTimestampDeltaConstraints({
  constraints,
  seen,
  text,
}: {
  constraints: RuleDerivedConstraint[]
  seen: Set<string>
  text: string
}) {
  const deltaPattern =
    /(\d+)\s*(<=|<)\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)\s*-\s*\$(\w+)\.([A-Za-z_][\w.\[\]"'-]*)/gi
  for (const match of text.matchAll(deltaPattern)) {
    const threshold = Number(match[1])
    const operator = match[2]
    const leftVariable = match[3]
    const leftPath = normalizeRuleDerivedPath(match[4] ?? "")
    const rightVariable = match[5]
    const rightPath = normalizeRuleDerivedPath(match[6] ?? "")
    if (
      !Number.isFinite(threshold) ||
      !operator ||
      !leftVariable ||
      !leftPath ||
      !rightVariable ||
      !rightPath
    ) {
      continue
    }
    const rightValue = 1
    const leftValue = rightValue + threshold + (operator === "<" ? 1 : 0)
    upsertRuleDerivedConstraint({
      constraints,
      path: leftPath,
      replaceExisting: true,
      seen,
      value: leftValue,
      variable: leftVariable,
    })
    upsertRuleDerivedConstraint({
      constraints,
      path: rightPath,
      replaceExisting: true,
      seen,
      value: rightValue,
      variable: rightVariable,
    })
  }
}

function collectRuleLiteralConstraints({
  allowVariation = false,
  constraints,
  pattern,
  seen,
  text,
  valueForMatch,
}: {
  allowVariation?: boolean
  constraints: RuleDerivedConstraint[]
  pattern: RegExp
  seen: Set<string>
  text: string
  valueForMatch: (match: RegExpExecArray) => string | number | boolean
}) {
  for (const match of text.matchAll(pattern)) {
    const variable = match[1]
    const path = normalizeRuleDerivedPath(match[2] ?? "")
    if (!variable || !path || path.startsWith("metadata.event_timestamp")) {
      continue
    }
    if (isNegatedRuleConstraintUse(text, match.index)) {
      continue
    }
    const value = valueForMatch(match)
    const allowDuplicate = isAnyRepeatedLabelConstraint(text, match.index, path)
    if (!allowVariation) {
      const key = `${variable}.${path}`
      if (!allowDuplicate && seen.has(key)) {
        continue
      }
      seen.add(key)
      constraints.push({ allowDuplicate, allowVariation, path, value, variable })
      continue
    }
    addRuleDerivedConstraint({
      allowDuplicate,
      allowVariation,
      constraints,
      mergeWithExisting: allowVariation,
      path,
      seen,
      value,
      variable,
    })
  }
}

function isNegatedRuleConstraintUse(text: string, matchIndex: number) {
  const before = text.slice(Math.max(0, matchIndex - 20_000), matchIndex)
  if (/\b(?:not|NOT)\s*$/.test(before.slice(-24))) {
    return true
  }
  const negatedGroups = [...before.matchAll(/\bnot\s*\(/gi)]
  const lastNegatedGroup = negatedGroups.at(-1)
  if (!lastNegatedGroup || lastNegatedGroup.index === undefined) {
    return false
  }
  const groupText = before.slice(lastNegatedGroup.index)
  return (groupText.match(/\(/g)?.length ?? 0) > (groupText.match(/\)/g)?.length ?? 0)
}

function collectRuleNotEqualLiteralConstraints({
  constraints,
  pattern,
  seen,
  text,
  valueForMatch,
}: {
  constraints: RuleDerivedConstraint[]
  pattern: RegExp
  seen: Set<string>
  text: string
  valueForMatch: (match: RegExpExecArray) => string | number | boolean
}) {
  for (const match of text.matchAll(pattern)) {
    const variable = match[1]
    const path = normalizeRuleDerivedPath(match[2] ?? "")
    if (!variable || !path || path.startsWith("metadata.event_timestamp")) {
      continue
    }
    addRuleDerivedConstraint({
      allowVariation: true,
      constraints,
      path,
      seen,
      value: valueForMatch(match),
      variable,
    })
  }
}

function isAnyRepeatedLabelConstraint(text: string, matchIndex: number, path: string) {
  if (!path.endsWith(".attribute.labels.value") && !path.endsWith(".attribute.labels.key")) {
    return false
  }
  return /\bany\s*$/.test(text.slice(Math.max(0, matchIndex - 12), matchIndex))
}

function normalizeRuleDerivedPath(path: string) {
  const trimmed = path.trim()
  const openDoubleBracket = trimmed.lastIndexOf("[\"")
  if (openDoubleBracket !== -1 && !trimmed.slice(openDoubleBracket).includes("]")) {
    return `${trimmed}"]`
  }
  const openSingleBracket = trimmed.lastIndexOf("['")
  if (openSingleBracket !== -1 && !trimmed.slice(openSingleBracket).includes("]")) {
    return `${trimmed}']`
  }
  return trimmed
}

function defaultRulePlaceholderValue(placeholder: string) {
  const name = placeholder.toLowerCase()
  if (name.includes("auth") || name.includes("token")) {
    return "Bearer token"
  }
  if (
    name === "t_userid" ||
    name === "target_userid" ||
    name === "target_user" ||
    name.includes("target_user")
  ) {
    return "bob"
  }
  if (name.includes("user")) {
    return "alice"
  }
  if (name.includes("host")) {
    return "WORKSTATION-1"
  }
  if (name.includes("domain")) {
    return "suspicious.example"
  }
  if (name.includes("ip")) {
    return "10.0.4.20"
  }
  if (name.includes("instance")) {
    return "i-0123456789abcdef0"
  }
  if (name.includes("hash")) {
    return "0123456789abcdef0123456789abcdef"
  }
  if (name.includes("process")) {
    return "powershell.exe"
  }
  if (name.includes("resource")) {
    return "resource-1"
  }
  return `${placeholder}_value`
}

function defaultRulePlaceholderValueForPath(placeholder: string, path: string) {
  if (isRuleDerivedDomainLikePath(path)) {
    const name = placeholder.toLowerCase()
    if (name.includes("dns") || name.includes("query")) {
      return "threatpunter.example"
    }
    return "suspicious.example"
  }
  return defaultRulePlaceholderValue(placeholder)
}

function isRuleDerivedDomainLikePath(path: string) {
  const normalized = path.toLowerCase()
  return (
    normalized.includes("target.hostname") ||
    normalized.includes("graph.entity.hostname") ||
    normalized.includes("domain.name") ||
    normalized.includes("dns.questions.name")
  )
}

function hasRuleDerivedPathSegment(path: string, segment: string) {
  return parseRuleDerivedPath(path)
    .map((part) => part.toLowerCase())
    .includes(segment.toLowerCase())
}

function createRuleDerivedEvent({
  fields,
  label,
  occurrence = 0,
  timestamp,
  varyingFields = new Set(),
}: {
  fields: RuleDerivedConstraint[]
  label: string
  occurrence?: number
  timestamp: UdmTimestamp
  varyingFields?: Set<string>
}) {
  const event: Record<string, unknown> = {
    metadata: {
      event_timestamp: timestamp,
      product_name: "Rule-derived test case",
      vendor_name: "RuleLab",
    },
    security_result: {
      action: "ALLOW",
      summary: label,
    },
  }

  for (const field of fields) {
    setRuleDerivedField(event, field.path, field.value)
  }
  for (const path of varyingFields) {
    const existingField = fields.find((field) => field.path === path)
    if (existingField && !existingField.allowVariation && !isRuleDerivedCountDistinctFriendlyPath(path)) {
      continue
    }
    setRuleDerivedField(event, path, createRuleDerivedVaryingValue(path, occurrence, existingField?.value))
  }
  normalizeRuleDerivedEventDefaults(event, timestamp, label)
  return event
}

function isRuleDerivedCountDistinctFriendlyPath(path: string) {
  const normalized = path.toLowerCase()
  return normalized.includes("country") || normalized.includes("state") || normalized.includes("city")
}

function createRuleDerivedNearMissEvent({
  fields,
  label,
  timestamp,
}: {
  fields: RuleDerivedConstraint[]
  label: string
  timestamp: UdmTimestamp
}) {
  const event = createRuleDerivedEvent({ fields, label, timestamp }) as Record<string, unknown>
  const fieldToMutate =
    fields.find((field) => field.path !== "metadata.event_type" && typeof field.value === "string") ??
    fields.find((field) => field.path !== "metadata.event_type")

  if (fieldToMutate) {
    setRuleDerivedField(
      event,
      fieldToMutate.path,
      mutateRuleDerivedValue(fieldToMutate.value, fieldToMutate.path)
    )
  } else {
    setRuleDerivedField(event, "principal.hostname", "NEAR-MISS-HOST")
  }
  setRuleDerivedField(event, "security_result.summary", label)
  return event
}

function createRuleDerivedVaryingValue(
  path: string,
  occurrence: number,
  baseValue?: string | number | boolean
) {
  const normalized = path.toLowerCase()
  const index = occurrence + 1
  if (typeof baseValue === "number") {
    return baseValue + occurrence
  }
  if (typeof baseValue === "boolean") {
    return baseValue
  }
  if (typeof baseValue === "string" && baseValue.trim()) {
    return varyRuleDerivedStringValue(path, baseValue, occurrence)
  }
  if (hasRuleDerivedPathSegment(path, "ip")) {
    return `10.0.4.${20 + occurrence}`
  }
  if (normalized.includes("country")) {
    return ["United States", "Canada", "United Kingdom", "Germany", "Australia"][occurrence % 5]
  }
  if (normalized.includes("state")) {
    return ["California", "Texas", "New York", "Ontario", "Bavaria"][occurrence % 5]
  }
  if (normalized.includes("city")) {
    return ["Austin", "London", "Berlin", "Toronto", "Sydney"][occurrence % 5]
  }
  if (normalized.includes("region") || normalized.includes("location")) {
    return ["us-central1", "us-east1", "europe-west1", "eu-west-1", "ap-southeast-2"][occurrence % 5]
  }
  if (normalized.includes("session")) {
    return `session-${index}`
  }
  if (normalized.includes("user")) {
    return `user${index}`
  }
  if (normalized.includes("host") || normalized.includes("asset")) {
    return `WORKSTATION-${index}`
  }
  if (normalized.includes("domain")) {
    return `domain-${index}.example`
  }
  if (normalized.includes("url")) {
    return `https://example.test/resource-${index}`
  }
  if (normalized.includes("hash") || normalized.includes("sha")) {
    return `${String(index).padStart(2, "0")}23456789abcdef0123456789abcdef`
  }
  if (normalized.includes("resource") || normalized.includes("file") || normalized.includes("object")) {
    return `resource-${index}`
  }
  if (normalized.includes("id")) {
    return `id-${index}`
  }
  if (normalized.includes("bytes") || normalized.includes("count") || normalized.includes("size")) {
    return 100 + occurrence
  }
  return `value-${index}`
}

function varyRuleDerivedStringValue(path: string, baseValue: string, occurrence: number) {
  if (occurrence === 0) {
    return baseValue
  }

  const normalized = path.toLowerCase()
  const index = occurrence + 1
  if (normalized.includes("product_event_type")) {
    return `${baseValue}${index}`
  }
  if (normalized.includes("country")) {
    return ["United States", "Canada", "United Kingdom", "Germany", "Australia"][occurrence % 5]
  }
  if (normalized.includes("state")) {
    return ["California", "Texas", "New York", "Ontario", "Bavaria"][occurrence % 5]
  }
  if (normalized.includes("city")) {
    return ["Austin", "London", "Berlin", "Toronto", "Sydney"][occurrence % 5]
  }
  if (normalized.includes("region") || normalized.includes("location")) {
    return ["us-central1", "us-east1", "europe-west1", "eu-west-1", "ap-southeast-2"][occurrence % 5]
  }
  if (normalized.includes("url")) {
    if (/\/users\/[^/]*(?=\/)/i.test(baseValue)) {
      return baseValue.replace(/\/users\/[^/]*(?=\/)/i, `/users/user-${index}`)
    }
    if (/\/groups\/[^/]*(?=\/)/i.test(baseValue)) {
      return baseValue.replace(/\/groups\/[^/]*(?=\/)/i, `/groups/group-${index}`)
    }
    if (/\/content$/i.test(baseValue)) {
      return baseValue.replace(/\/content$/i, `/fixture-${index}/content`)
    }
    if (/\/[^/?#]+$/i.test(baseValue)) {
      return baseValue.replace(/\/([^/?#]+)$/i, `/fixture-${index}/$1`)
    }
    const separator = baseValue.includes("?") ? "&" : "?"
    return `${baseValue}${separator}fixture=${index}`
  }
  if (normalized.includes("ip")) {
    return `10.0.4.${20 + occurrence}`
  }
  if (normalized.includes("email") && baseValue.includes("@")) {
    const [name, domain] = baseValue.split("@")
    return `${name || "user"}+${index}@${domain || "example.test"}`
  }
  if (normalized.includes("command") || normalized.includes("cmd") || normalized.includes("args")) {
    return `${baseValue} --fixture-${index}`
  }

  const match = baseValue.match(/^(.*?)(\d+)(\D*)$/)
  if (match) {
    const prefix = match[1] ?? ""
    const number = Number(match[2])
    const suffix = match[3] ?? ""
    if (Number.isFinite(number)) {
      return `${prefix}${number + occurrence}${suffix}`
    }
  }
  return `${baseValue}-${index}`
}

function setRuleDerivedField(
  event: Record<string, unknown>,
  path: string,
  value: string | number | boolean
) {
  const segments = parseRuleDerivedPath(path)
  if (!segments.length) {
    return
  }

  if (path === "network.dns.questions.name" || path === "network.dns.questions.type") {
    setDnsQuestionField(event, segments.at(-1) ?? "name", value)
    return
  }

  if (path.endsWith(".attribute.labels.value") || path.endsWith(".attribute.labels.key")) {
    appendRuleDerivedLabelField(event, segments, value)
    return
  }

  if (isRepeatedScalarField(path)) {
    setNestedRuleDerivedValue(event, segments, [value])
    return
  }

  setNestedRuleDerivedValue(event, segments, value)
}

function parseRuleDerivedPath(path: string) {
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
        segments.push(unescapeQuotedRuleString(quoted))
      } else if (/^\d+$/.test(bracketValue)) {
        segments.push(bracketValue)
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

function setDnsQuestionField(
  event: Record<string, unknown>,
  key: string,
  value: string | number | boolean
) {
  const network = ensureRuleDerivedRecord(event, "network")
  const dns = ensureRuleDerivedRecord(network, "dns")
  const questions = Array.isArray(dns.questions) ? dns.questions : []
  const question = isRecord(questions[0]) ? questions[0] : {}
  dns.questions = [{ ...question, [key]: value }]
}

function appendRuleDerivedLabelField(
  event: Record<string, unknown>,
  segments: string[],
  value: string | number | boolean
) {
  const labelsIndex = segments.lastIndexOf("labels")
  const labelField = segments.at(-1)
  if (labelsIndex === -1 || !labelField) {
    setNestedRuleDerivedValue(event, segments, value)
    return
  }

  let current = event
  for (const segment of segments.slice(0, labelsIndex)) {
    current = ensureRuleDerivedRecord(current, segment)
  }
  const existingLabels = Array.isArray(current.labels) ? current.labels : []
  current.labels = [...existingLabels, { [labelField]: value }]
}

function setNestedRuleDerivedValue(
  event: Record<string, unknown>,
  segments: string[],
  value: unknown
) {
  let current: unknown = event
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] ?? ""
    const nextSegment = segments[index + 1]
    if (isRuleDerivedArrayIndex(segment)) {
      if (!Array.isArray(current)) {
        return
      }
      const arrayIndex = Number(segment)
      const existing = current[arrayIndex]
      if (isRecord(existing)) {
        current = existing
        continue
      }
      const next = isRuleDerivedArrayIndex(nextSegment) ? [] : {}
      current[arrayIndex] = next
      current = next
      continue
    }
    if (!isRecord(current)) {
      return
    }
    current = ensureRuleDerivedContainer(current, segment, isRuleDerivedArrayIndex(nextSegment))
  }
  const lastSegment = segments[segments.length - 1] ?? "value"
  if (Array.isArray(current) && isRuleDerivedArrayIndex(lastSegment)) {
    current[Number(lastSegment)] = value
    return
  }
  if (isRecord(current)) {
    current[lastSegment] = value
  }
}

function isRuleDerivedArrayIndex(segment: string | undefined) {
  return Boolean(segment && /^\d+$/.test(segment))
}

function ensureRuleDerivedContainer(
  parent: Record<string, unknown>,
  key: string,
  shouldBeArray: boolean
) {
  const current = parent[key]
  if (shouldBeArray) {
    if (Array.isArray(current)) {
      return current
    }
    const next: unknown[] = []
    parent[key] = next
    return next
  }
  if (isRecord(current) && !Array.isArray(current)) {
    return current
  }
  const next: Record<string, unknown> = {}
  parent[key] = next
  return next
}

function ensureRuleDerivedRecord(parent: Record<string, unknown>, key: string) {
  const current = parent[key]
  if (isRecord(current) && !Array.isArray(current)) {
    return current
  }
  const next: Record<string, unknown> = {}
  parent[key] = next
  return next
}

function normalizeRuleDerivedEventDefaults(
  event: Record<string, unknown>,
  timestamp: UdmTimestamp,
  label: string
) {
  const metadata = ensureRuleDerivedRecord(event, "metadata")
  metadata.id = metadata.id ?? `rule-derived-${timestamp.seconds}-${timestamp.nanos}`
  metadata.event_timestamp = metadata.event_timestamp ?? timestamp
  metadata.event_type = typeof metadata.event_type === "string" && metadata.event_type.trim()
    ? metadata.event_type
    : inferRuleDerivedEventType(event)
  metadata.product_name = metadata.product_name ?? "Rule-derived test case"
  metadata.vendor_name = metadata.vendor_name ?? "RuleLab"

  const principal = ensureRuleDerivedRecord(event, "principal")
  if (!("hostname" in principal)) {
    principal.hostname = "WORKSTATION-1"
  }
  const principalUser = ensureRuleDerivedRecord(principal, "user")
  if (!("userid" in principalUser)) {
    principalUser.userid = "alice"
  }

  const securityResult = event.security_result
  if (Array.isArray(securityResult)) {
    const firstResult = isRecord(securityResult[0]) ? securityResult[0] : {}
    securityResult[0] = {
      ...firstResult,
      action: firstResult.action ?? "ALLOW",
      summary: firstResult.summary ?? label,
    }
  } else {
    const securityResultRecord = ensureRuleDerivedRecord(event, "security_result")
    securityResultRecord.summary = securityResultRecord.summary ?? label
    securityResultRecord.action = securityResultRecord.action ?? "ALLOW"
  }
}

function inferRuleDerivedEventType(event: Record<string, unknown>) {
  if (getNestedValue(event, ["network", "dns"])) {
    return "NETWORK_DNS"
  }
  if (getNestedValue(event, ["principal", "process"]) || getNestedValue(event, ["target", "process"])) {
    return "PROCESS_LAUNCH"
  }
  if (getNestedValue(event, ["principal", "user"]) || getNestedValue(event, ["target", "user"])) {
    return "USER_LOGIN"
  }
  return "GENERIC_EVENT"
}

function isRepeatedScalarField(path: string) {
  return path.endsWith(".ip") || path.endsWith(".email_addresses") || path.endsWith(".asset_id")
}

function mutateRuleDerivedValue(value: string | number | boolean, path?: string) {
  if (typeof value === "string") {
    const allowedValues = path ? getUdmFieldAllowedValues(path) : []
    const alternateAllowedValue =
      allowedValues.find((allowedValue) =>
        allowedValue !== value &&
        !/^UNKNOWN|UNSPECIFIED/.test(allowedValue)
      ) ??
      allowedValues.find((allowedValue) => allowedValue !== value)
    if (alternateAllowedValue) {
      return alternateAllowedValue
    }
    return value.trim() ? `not-${value}` : "near-miss"
  }
  if (typeof value === "number") {
    return value + 1
  }
  return !value
}

function extractRuleName(ruleText: string) {
  return stripYaralComments(ruleText).match(/\brule\s+([A-Za-z_]\w*)/)?.[1] ?? null
}

function stripYaralComments(ruleText: string) {
  return ruleText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

function unescapeQuotedRuleString(value: string) {
  return value.replace(/\\"/g, "\"").replace(/\\\\/g, "\\")
}

function stripRuleStringLiteral(value: string) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return unescapeQuotedRuleString(trimmed.slice(1, -1))
  }
  return unescapeQuotedRuleString(trimmed)
}

function sampleValueFromRegexPattern(pattern: string) {
  const source = chooseRuleRegexAlternative(unwrapRuleRegexPattern(pattern))
  return sampleValueFromRegexSource(source) || "regex-match"
}

function sampleValueFromRegexPatternForPath(path: string, pattern: string) {
  const normalized = path.toLowerCase()
  const source = unwrapRuleRegexPattern(pattern)
  if (normalized.includes("full_path") && /taskmgr\\?\.exe/i.test(source)) {
    return "C:\\Windows\\system32\\taskmgr.exe"
  }
  if (
    (normalized.includes("hostname") || normalized.includes("domain")) &&
    /\\\.|\[\^?\.|[a-z0-9]\]\?\\\./i.test(source)
  ) {
    return "suspicious.example"
  }
  return sampleValueFromRegexPattern(pattern)
}

function sampleValueFromRegexSource(source: string) {
  const escapedBackslashToken = "__RULE_DERIVED_LITERAL_BACKSLASH__"
  const escapedDotToken = "__RULE_DERIVED_LITERAL_DOT__"
  const escapedOpenParenToken = "__RULE_DERIVED_LITERAL_OPEN_PAREN__"
  const escapedCloseParenToken = "__RULE_DERIVED_LITERAL_CLOSE_PAREN__"
  const escapedQuestionToken = "__RULE_DERIVED_LITERAL_QUESTION__"
  const escapedDollarToken = "__RULE_DERIVED_LITERAL_DOLLAR__"
  return source
    .replace(/\\\\/g, escapedBackslashToken)
    .replace(/\\\./g, escapedDotToken)
    .replace(/\\\(/g, escapedOpenParenToken)
    .replace(/\\\)/g, escapedCloseParenToken)
    .replace(/\\\?/g, escapedQuestionToken)
    .replace(/\\\$/g, escapedDollarToken)
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\.\*/g, "")
    .replace(/\.\{(\d+)\}/g, (_match, count: string) => "x".repeat(Math.min(64, Math.max(1, Number(count) || 1))))
    .replace(/\\[dD](?:\{(\d+)(?:,\d*)?\}|[+*?])?/g, (_match, count: string | undefined) =>
      "1".repeat(Math.min(64, Math.max(1, Number(count) || 1)))
    )
    .replace(/\\s(?:\{(\d+)(?:,\d*)?\}|[+*?])?/g, (_match, count: string | undefined) =>
      " ".repeat(Math.min(64, Math.max(1, Number(count) || 1)))
    )
    .replace(/\\S(?:\{(\d+)(?:,\d*)?\}|[+*?])?/g, (_match, count: string | undefined) =>
      "x".repeat(Math.min(64, Math.max(1, Number(count) || 1)))
    )
    .replace(/\\[wWbB]/g, "x")
    .replace(/\\(.)/g, "$1")
    .replace(/\[[^\]]+\]\+?/g, (match) => sampleValueFromRegexCharacterClass(match))
    .replace(/\((?:\?:)?([^()|]+)(?:\|[^()]*)+\)/g, "$1")
    .replace(/\([^)]*\)/g, (match) => match.replace(/[()?:|]/g, ""))
    .replace(/[+*?{}^$]/g, "")
    .replace(/\./g, "x")
    .replaceAll(escapedBackslashToken, "\\")
    .replaceAll(escapedDotToken, ".")
    .replaceAll(escapedOpenParenToken, "(")
    .replaceAll(escapedCloseParenToken, ")")
    .replaceAll(escapedQuestionToken, "?")
    .replaceAll(escapedDollarToken, "$")
}

function sampleValueFromRegexCharacterClass(match: string) {
  if (/^\[\^/.test(match)) {
    return "a"
  }
  if (/\\x2f|\/|\\\//i.test(match)) {
    return "/"
  }
  if (/\\x5c|\\\\/i.test(match)) {
    return "\\"
  }
  if (/0-9|\\d/.test(match)) {
    return "1"
  }
  if (/A-Z|a-z|\\w/i.test(match)) {
    return "a"
  }
  return "a"
}

function chooseRuleRegexAlternative(source: string) {
  let depth = 0
  let inCharacterClass = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass) {
      continue
    }
    if (char === "(") {
      depth += 1
      continue
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (char === "|" && depth === 0) {
      return source.slice(0, index)
    }
  }

  return source
}

function hasRuleRegexCapturingGroup(source: string) {
  let escaped = false
  let inCharacterClass = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (!inCharacterClass && char === "(" && source[index + 1] !== "?") {
      return true
    }
  }
  return false
}

function sampleValueFromCapturePattern(pattern: string, capturedValue: string | number | boolean) {
  const source = chooseRuleRegexAlternative(unwrapRuleRegexPattern(pattern))
  const captureText = String(capturedValue)
  try {
    if (new RegExp(source).test(captureText)) {
      return captureText
    }
  } catch {
    // Fall through to the lightweight pattern sampler.
  }
  const withCapture = replaceFirstRuleRegexCapture(source, captureText)
  const literal = sampleValueFromRegexSource(withCapture).trim()
  return literal || captureText
}

function replaceFirstRuleRegexCapture(source: string, replacement: string) {
  let escaped = false
  let inCharacterClass = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (inCharacterClass || char !== "(" || source[index + 1] === "?") {
      continue
    }

    let depth = 1
    let innerEscaped = false
    let innerCharacterClass = false
    for (let end = index + 1; end < source.length; end += 1) {
      const inner = source[end]
      if (innerEscaped) {
        innerEscaped = false
        continue
      }
      if (inner === "\\") {
        innerEscaped = true
        continue
      }
      if (inner === "[") {
        innerCharacterClass = true
        continue
      }
      if (inner === "]") {
        innerCharacterClass = false
        continue
      }
      if (innerCharacterClass) {
        continue
      }
      if (inner === "(") {
        depth += 1
        continue
      }
      if (inner === ")") {
        depth -= 1
        if (depth === 0) {
          return `${source.slice(0, index)}${replacement}${source.slice(end + 1)}`
        }
      }
    }
  }
  return source
}

function unwrapRuleRegexPattern(pattern: string) {
  if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    return pattern.slice(1, pattern.lastIndexOf("/"))
  }
  if (pattern.startsWith("`") && pattern.endsWith("`")) {
    return pattern.slice(1, -1)
  }
  if (pattern.startsWith("\"") && pattern.endsWith("\"")) {
    return unescapeQuotedRuleString(pattern.slice(1, -1))
  }
  return pattern
}

function sampleIpFromCidr(cidr: string) {
  const [address] = cidr.split("/")
  const octets = address?.split(".").map((part) => Number(part)) ?? []
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return "10.0.0.10"
  }
  const sample = [...octets]
  sample[3] = Math.min(254, Math.max(1, sample[3] + 10))
  return sample.join(".")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function getNestedValue(value: unknown, path: string[]) {
  let current = value
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current ?? null
}
