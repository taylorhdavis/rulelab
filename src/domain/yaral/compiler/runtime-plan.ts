import { collectVariableExpressions, walkExpression } from "./ast"
import { parseYaralDurationMinutes } from "./duration"
import { stripYaralStringQuotes } from "./text"
import { YARAL_AGGREGATE_FUNCTION_NAMES } from "../functions"
import type {
  YaralExpression,
  YaralPlaceholderPlan,
  YaralRuleAst,
  YaralRuntimeOptions,
  YaralRuntimePlan,
  YaralSymbolTable,
} from "./types"

export function buildYaralRuntimePlan(
  ast: YaralRuleAst | null,
  symbols: YaralSymbolTable
): YaralRuntimePlan | null {
  if (!ast) {
    return null
  }

  const metaSection = ast.sections.find((section) => section.name === "meta")
  const eventsSection = ast.sections.find((section) => section.name === "events")
  const matchSection = ast.sections.find((section) => section.name === "match")
  const outcomeSection = ast.sections.find((section) => section.name === "outcome")
  const conditionSection = ast.sections.find((section) => section.name === "condition")
  const optionsSection = ast.sections.find((section) => section.name === "options")

  return {
    condition: conditionSection?.expressions[0]?.expression ?? null,
    eventPredicates: eventsSection?.expressions
      .map((statement) => statement.expression)
      .map(removePlaceholderAssignments)
      .filter((expression): expression is YaralExpression => Boolean(expression))
      .filter((expression) => !getPlaceholderAssignment(expression))
      .map((expression) => ({
        eventVariable: getPrimaryEventVariable(expression),
        expression,
        referencedFields: getReferencedFields(expression),
      })) ?? [],
    joins: symbols.placeholderVariables
      .filter((placeholder) => placeholder.eventVariables.length > 1)
      .map((placeholder) => ({
        eventVariables: placeholder.eventVariables,
        placeholder: placeholder.name,
      })),
    match: matchSection?.match
      ? {
          durationMinutes: matchSection.match.duration
            ? parseYaralDurationMinutes(matchSection.match.duration.value)
            : null,
          durationValue: matchSection.match.duration?.value ?? null,
          kind: matchSection.match.windowKind,
          pivotDirection: matchSection.match.windowDirection,
          pivotEvent: matchSection.match.pivot?.name ?? null,
          variables: matchSection.match.variables.map((variable) => variable.name),
        }
      : null,
    meta: buildMeta(metaSection?.expressions.map((statement) => statement.expression) ?? []),
    options: buildOptions(optionsSection?.expressions.map((statement) => statement.expression) ?? []),
    outcomes: outcomeSection?.expressions
      .map((statement) => getAssignment(statement.expression))
      .filter((assignment): assignment is YaralVariableAssignment =>
        Boolean(
          assignment &&
            assignment.left.kind === "variable" &&
            assignment.left.path.length === 0
        )
      )
      .map((assignment) => ({
        aggregate: containsAggregateFunction(assignment.right),
        expression: assignment.right,
        name: assignment.left.name,
      })) ?? [],
    placeholders: eventsSection?.expressions
      .map((statement) => statement.expression)
      .flatMap(getPlaceholderAssignments) ?? [],
  }
}

type YaralAssignment =
  | (Extract<YaralExpression, { kind: "assignment" }> & { operator: "=" })
  | (Extract<YaralExpression, { kind: "binary" }> & { operator: "=" })

type YaralVariableAssignment = YaralAssignment & {
  left: Extract<YaralExpression, { kind: "variable" }>
}

function buildMeta(expressions: Array<YaralExpression | null>) {
  const meta: Record<string, string> = {}
  for (const expression of expressions) {
    const assignment = getAssignment(expression)
    if (
      assignment?.left.kind === "identifier" &&
      assignment.right.kind === "literal" &&
      assignment.right.literalKind === "string"
    ) {
      meta[assignment.left.name] = stripYaralStringQuotes(assignment.right.value)
    }
  }
  return meta
}

function buildOptions(expressions: Array<YaralExpression | null>): YaralRuntimeOptions {
  const options: YaralRuntimeOptions = {
    allowZeroValues: false,
    suppressionWindowMinutes: null,
    suppressionWindowValue: null,
  }

  for (const expression of expressions) {
    const assignment = getAssignment(expression)
    if (assignment?.left.kind !== "identifier") {
      continue
    }
    const name = assignment.left.name.toLowerCase()
    if (
      name === "allow_zero_values" &&
      assignment.right.kind === "literal" &&
      assignment.right.literalKind === "boolean"
    ) {
      options.allowZeroValues = assignment.right.value.toLowerCase() === "true"
    }
    if (
      name === "suppression_window" &&
      assignment.right.kind === "literal" &&
      assignment.right.literalKind === "duration"
    ) {
      options.suppressionWindowValue = assignment.right.value
      options.suppressionWindowMinutes = parseYaralDurationMinutes(assignment.right.value)
    }
  }

  return options
}

function getPlaceholderAssignment(expression: YaralExpression | null) {
  const assignment = getAssignment(expression)
  if (!assignment) {
    return null
  }
  const placeholder =
    assignment.left.kind === "variable" && assignment.left.path.length === 0
      ? assignment.left
      : assignment.right.kind === "variable" && assignment.right.path.length === 0
        ? assignment.right
        : null
  const sourceExpression =
    placeholder === assignment.left ? assignment.right : placeholder === assignment.right ? assignment.left : null

  if (!placeholder || !sourceExpression) {
    return null
  }

  const sourceVariables = collectVariableExpressions(sourceExpression).filter(
    (variable) => variable.path.length > 0
  )
  if (sourceVariables.length === 0) {
    return null
  }

  return {
    eventVariables: [...new Set(sourceVariables.map((variable) => variable.name))].sort(),
    expression: sourceExpression,
    name: placeholder.name,
    sourceFields: [...new Set(sourceVariables.map((variable) => variable.path))].sort(),
  }
}

function getPlaceholderAssignments(expression: YaralExpression | null): YaralPlaceholderPlan[] {
  const assignment = getPlaceholderAssignment(expression)
  if (assignment) {
    return [assignment]
  }
  if (expression?.kind === "group") {
    return getPlaceholderAssignments(expression.expression)
  }
  if (expression?.kind === "binary" && ["and", "or"].includes(expression.operator.toLowerCase())) {
    return [
      ...getPlaceholderAssignments(expression.left),
      ...getPlaceholderAssignments(expression.right),
    ]
  }
  return []
}

function removePlaceholderAssignments(expression: YaralExpression | null): YaralExpression | null {
  if (!expression || getPlaceholderAssignment(expression)) {
    return null
  }
  if (expression.kind === "group") {
    const inner = removePlaceholderAssignments(expression.expression)
    return inner ? { ...expression, expression: inner } : null
  }
  if (expression.kind === "binary" && expression.operator.toLowerCase() === "and") {
    const left = removePlaceholderAssignments(expression.left)
    const right = removePlaceholderAssignments(expression.right)
    if (left && right) {
      return { ...expression, left, right }
    }
    return left ?? right
  }
  return expression
}

function getAssignment(expression: YaralExpression | null): YaralAssignment | null {
  if (!expression) {
    return null
  }
  if (expression.kind === "assignment" && expression.operator === "=") {
    return expression as YaralAssignment
  }
  if (expression.kind === "binary" && expression.operator.toLowerCase() === "=") {
    return expression as YaralAssignment
  }
  return null
}

function getPrimaryEventVariable(expression: YaralExpression) {
  const variable = collectVariableExpressions(expression).find((item) => item.path.length > 0)
  return variable?.name ?? null
}

function getReferencedFields(expression: YaralExpression) {
  return [
    ...new Set(
      collectVariableExpressions(expression)
        .filter((variable) => variable.path.length > 0)
        .map((variable) => variable.path)
    ),
  ].sort()
}

function containsAggregateFunction(expression: YaralExpression) {
  let aggregate = false
  walkExpression(expression, (node) => {
    if (
      node.kind === "call" &&
      YARAL_AGGREGATE_FUNCTION_NAMES.has(node.callee.toLowerCase())
    ) {
      aggregate = true
    }
  })
  return aggregate
}
