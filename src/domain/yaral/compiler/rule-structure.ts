import { isAssignmentExpression, isSimpleVariableExpression, walkExpression } from "./ast"
import { createDiagnostic, firstSourceRange } from "./diagnostics"
import { parseYaralDurationMinutes } from "./duration"
import type {
  YaralBinaryExpression,
  YaralAssignmentExpression,
  YaralDiagnostic,
  YaralExpression,
  YaralLiteralExpression,
  YaralRuleAst,
  YaralSectionAst,
  YaralSourceRange,
  YaralSymbolTable,
} from "./types"

type ConditionBoundState = "bounded" | "unbounded" | "unknown"

export function validateRuleStructure(
  ast: YaralRuleAst,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[]
) {
  const eventsSection = ast.sections.find((section) => section.name === "events")
  const matchSection = ast.sections.find((section) => section.name === "match")
  const optionsSection = ast.sections.find((section) => section.name === "options")
  const conditionSection = ast.sections.find((section) => section.name === "condition")
  const outcomeCoverage = collectOutcomeEventVariableCoverage(ast, symbols)

  if (symbols.eventVariables.length > 1 && !matchSection) {
    diagnostics.push(
      diag(
        eventsSection?.nameToken ?? firstSourceRange(),
        "Multi-event rules must include `match:` to define the join variables and time window."
      )
    )
  }

  validateSuppressionWindow(matchSection, optionsSection, symbols, diagnostics)
  validateArithmeticJoinExpressions(eventsSection, symbols, diagnostics)

  if (!conditionSection) {
    return
  }

  const conditionVariables = collectSimpleConditionVariables(conditionSection)
  const conditionState = collectConditionBoundStates(conditionSection)
  validateConditionOrUsage(conditionSection, matchSection, symbols, diagnostics)
  validateConditionOfUsage(conditionSection, matchSection, symbols, diagnostics)

  for (const eventVariable of symbols.eventVariables) {
    const isCoveredByPlaceholder = conditionVariables.some((name) => {
      const placeholder = symbols.placeholderVariables.find((symbol) => symbol.name === name)
      return placeholder?.eventVariables.includes(eventVariable.name) ?? false
    })
    const isCoveredByOutcome = conditionVariables.some((name) =>
      outcomeCoverage.get(name)?.has(eventVariable.name)
    )

    if (!conditionVariables.includes(eventVariable.name) && !isCoveredByPlaceholder && !isCoveredByOutcome) {
      diagnostics.push(
        diag(
          conditionSection.nameToken,
          `Event variable $${eventVariable.name} is defined in \`events:\` but not covered by \`condition:\`.`
        )
      )
    }
  }

  if (!matchSection?.match) {
    return
  }

  validateMultiEventJoinCoverage(
    eventsSection,
    matchSection,
    conditionSection,
    conditionVariables,
    conditionState,
    symbols,
    diagnostics
  )

  for (const variable of matchSection.match.variables) {
    if (conditionVariables.includes(variable.name)) {
      diagnostics.push(
        diag(
          conditionSection.nameToken,
          `Match variable $${variable.name} must not be used in \`condition:\`; events are already grouped by that value.`
        )
      )
    }
  }

  for (const matchVariable of matchSection.match.variables) {
    const placeholder = symbols.placeholderVariables.find((symbol) => symbol.name === matchVariable.name)
    const associatedEvents = placeholder?.eventVariables ?? []
    if (
      associatedEvents.length > 0 &&
      associatedEvents.every((eventVariable) => conditionState.get(eventVariable) === "unbounded")
    ) {
      diagnostics.push(
        diag(
          conditionSection.nameToken,
          `At least one event associated with match variable $${matchVariable.name} must have a bounded condition.`
        )
      )
    }
  }

  if (matchSection.match.windowKind === "sliding" && matchSection.match.pivot) {
    const pivotState = conditionState.get(matchSection.match.pivot.name)
    if (pivotState !== "bounded") {
      diagnostics.push(
        diag(
          conditionSection.nameToken,
          `Sliding window pivot event $${matchSection.match.pivot.name} must have a bounded condition.`
        )
      )
    }
  }
}

function validateArithmeticJoinExpressions(
  eventsSection: YaralSectionAst | undefined,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[]
) {
  if (symbols.eventVariables.length <= 1) {
    return
  }

  const eventVariableNames = new Set(symbols.eventVariables.map((symbol) => symbol.name))
  const placeholderEventSources = collectPlaceholderEventSourceMap(eventsSection, eventVariableNames)
  const multiEventPlaceholderNames = new Set(
    [
      ...symbols.placeholderVariables
        .filter((symbol) => symbol.eventVariables.length > 1)
        .map((symbol) => symbol.name),
      ...[...placeholderEventSources.entries()]
        .filter(([, eventVariables]) => eventVariables.size > 1)
        .map(([name]) => name),
    ]
  )

  for (const statement of eventsSection?.expressions ?? []) {
    if (!statement.expression) {
      continue
    }
    walkExpression(statement.expression, (node) => {
      if (!isEqualityExpression(node)) {
        return
      }
      if (!containsArithmeticOperator(node.left) && !containsArithmeticOperator(node.right)) {
        return
      }

      const leftEventVariables = collectEventFieldVariables(node.left, eventVariableNames)
      const rightEventVariables = collectEventFieldVariables(node.right, eventVariableNames)
      const eventVariables = new Set([...leftEventVariables, ...rightEventVariables])
      const directJoin = leftEventVariables.some((left) =>
        rightEventVariables.some((right) => left !== right)
      )
      const transitiveJoin = [
        ...collectSimpleVariableNames(node.left),
        ...collectSimpleVariableNames(node.right),
      ].some((name) => multiEventPlaceholderNames.has(name))

      if (directJoin || (eventVariables.size > 0 && transitiveJoin) || eventVariables.size > 1) {
        diagnostics.push(
          diag(
            node.range,
            "Arithmetic must not be included in direct or transitive event join expressions."
          )
        )
      }
    })
  }
}

function collectPlaceholderEventSourceMap(
  eventsSection: YaralSectionAst | undefined,
  eventVariableNames: Set<string>
) {
  const sources = new Map<string, Set<string>>()
  const addSource = (placeholder: string, eventVariable: string) => {
    const existing = sources.get(placeholder) ?? new Set<string>()
    existing.add(eventVariable)
    sources.set(placeholder, existing)
  }

  for (const statement of eventsSection?.expressions ?? []) {
    if (!statement.expression) {
      continue
    }
    walkExpression(statement.expression, (node) => {
      if (!isEqualityExpression(node)) {
        return
      }

      const leftEventVariables = collectEventFieldVariables(node.left, eventVariableNames)
      const rightEventVariables = collectEventFieldVariables(node.right, eventVariableNames)
      const leftPlaceholders = collectSimpleVariableNames(node.left)
        .filter((name) => !eventVariableNames.has(name))
      const rightPlaceholders = collectSimpleVariableNames(node.right)
        .filter((name) => !eventVariableNames.has(name))

      for (const placeholder of leftPlaceholders) {
        for (const eventVariable of rightEventVariables) {
          addSource(placeholder, eventVariable)
        }
      }
      for (const placeholder of rightPlaceholders) {
        for (const eventVariable of leftEventVariables) {
          addSource(placeholder, eventVariable)
        }
      }
    })
  }

  return sources
}

function validateMultiEventJoinCoverage(
  eventsSection: YaralSectionAst | undefined,
  matchSection: YaralSectionAst,
  conditionSection: YaralSectionAst,
  conditionVariables: string[],
  conditionState: Map<string, ConditionBoundState>,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[]
) {
  if (symbols.eventVariables.length <= 1 || !matchSection.match) {
    return
  }

  const eventVariableNames = new Set(symbols.eventVariables.map((symbol) => symbol.name))
  const placeholdersByName = new Map(symbols.placeholderVariables.map((symbol) => [symbol.name, symbol]))
  const directJoinEdges = collectDirectEventFieldJoinEdges(eventsSection, eventVariableNames)
  const requiredEventVariables = new Set<string>()

  for (const name of conditionVariables) {
    if (eventVariableNames.has(name)) {
      if (conditionState.get(name) !== "unbounded") {
        requiredEventVariables.add(name)
      }
      continue
    }
    const placeholder = placeholdersByName.get(name)
    for (const eventVariable of placeholder?.eventVariables ?? []) {
      requiredEventVariables.add(eventVariable)
    }
  }

  if (requiredEventVariables.size <= 1) {
    return
  }

  const connectedEventVariables = new Set<string>()
  const queue: string[] = []
  const addConnectedEvent = (eventVariable: string) => {
    if (!connectedEventVariables.has(eventVariable)) {
      connectedEventVariables.add(eventVariable)
      queue.push(eventVariable)
    }
  }

  for (const matchVariable of matchSection.match.variables) {
    const placeholder = placeholdersByName.get(matchVariable.name)
    for (const eventVariable of placeholder?.eventVariables ?? []) {
      addConnectedEvent(eventVariable)
    }
  }

  if (connectedEventVariables.size === 0) {
    return
  }

  while (queue.length > 0) {
    const current = queue.shift()
    for (const placeholder of symbols.placeholderVariables) {
      if (!current || placeholder.eventVariables.length <= 1 || !placeholder.eventVariables.includes(current)) {
        continue
      }
      for (const eventVariable of placeholder.eventVariables) {
        addConnectedEvent(eventVariable)
      }
    }
    for (const [left, right] of directJoinEdges) {
      if (current === left) {
        addConnectedEvent(right)
      } else if (current === right) {
        addConnectedEvent(left)
      }
    }
  }

  for (const eventVariable of requiredEventVariables) {
    if (!connectedEventVariables.has(eventVariable)) {
      diagnostics.push(
        diag(
          conditionSection.nameToken,
          `Event variable $${eventVariable} is required by \`condition:\` but is not joined to the match variables.`
        )
      )
    }
  }
}

function collectOutcomeEventVariableCoverage(
  ast: YaralRuleAst,
  symbols: YaralSymbolTable
) {
  const eventVariableNames = new Set(symbols.eventVariables.map((symbol) => symbol.name))
  const coverage = new Map<string, Set<string>>()
  const outcomeSection = ast.sections.find((section) => section.name === "outcome")

  for (const statement of outcomeSection?.expressions ?? []) {
    const expression = statement.expression
    if (
      expression?.kind !== "assignment" ||
      expression.left.kind !== "variable" ||
      expression.left.path.length > 0
    ) {
      continue
    }
    const variables = collectEventFieldVariables(expression.right, eventVariableNames)
    if (variables.length > 0) {
      coverage.set(expression.left.name, new Set(variables))
    }
  }

  return coverage
}

function collectDirectEventFieldJoinEdges(
  eventsSection: YaralSectionAst | undefined,
  eventVariableNames: Set<string>
) {
  const edges: Array<[string, string]> = []
  for (const statement of eventsSection?.expressions ?? []) {
    if (!statement.expression) {
      continue
    }
    walkExpression(statement.expression, (node) => {
      if (node.kind !== "binary" || node.operator !== "=") {
        return
      }
      if (containsArithmeticOperator(node.left) || containsArithmeticOperator(node.right)) {
        return
      }
      const leftVariables = collectEventFieldVariables(node.left, eventVariableNames)
      const rightVariables = collectEventFieldVariables(node.right, eventVariableNames)
      for (const left of leftVariables) {
        for (const right of rightVariables) {
          if (left !== right) {
            edges.push([left, right])
          }
        }
      }
    })
  }
  return edges
}

function isEqualityExpression(
  expression: YaralExpression
): expression is YaralAssignmentExpression | YaralBinaryExpression {
  return (
    isAssignmentExpression(expression) ||
    (expression.kind === "binary" && expression.operator === "=")
  )
}

function containsArithmeticOperator(expression: YaralExpression) {
  let found = false
  walkExpression(expression, (node) => {
    if (
      node.kind === "binary" &&
      ["+", "-", "*", "/", "%"].includes(node.operator)
    ) {
      found = true
    }
  })
  return found
}

function collectSimpleVariableNames(expression: YaralExpression) {
  const names = new Set<string>()
  walkExpression(expression, (node) => {
    if (isSimpleVariableExpression(node)) {
      names.add(node.name)
    }
  })
  return [...names]
}

function collectEventFieldVariables(
  expression: YaralExpression,
  eventVariableNames: Set<string>
) {
  const names = new Set<string>()
  walkExpression(expression, (node) => {
    if (
      node.kind === "variable" &&
      node.path.length > 0 &&
      eventVariableNames.has(node.name)
    ) {
      names.add(node.name)
    }
  })
  return [...names]
}

function validateConditionOrUsage(
  section: YaralSectionAst,
  matchSection: YaralSectionAst | undefined,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[]
) {
  if (symbols.eventVariables.length <= 1) {
    return
  }

  const eventVariableNames = new Set(symbols.eventVariables.map((symbol) => symbol.name))

  for (const statement of section.expressions) {
    if (!statement.expression) {
      continue
    }

    for (const orExpression of collectOrExpressions(statement.expression)) {
      if (matchSection?.match?.windowKind === "tumbling") {
        diagnostics.push(
          diag(
            orExpression.range,
            "Multi-event `or` conditions are not supported with tumbling match windows."
          )
        )
      }

      const operands = flattenOrOperands(orExpression)
      const analyses = operands.map((operand) => analyzeOrOperand(operand, eventVariableNames))
      const eventVariables = new Set(analyses.flatMap((analysis) => [...analysis.eventVariables]))
      const hasNonEventVariables = analyses.some((analysis) => analysis.nonEventVariables.size > 0)

      if (eventVariables.size > 2) {
        diagnostics.push(
          diag(
            orExpression.range,
            "Multi-event `or` in rule conditions can reference at most 2 event variables."
          )
        )
      }

      if (hasNonEventVariables && eventVariables.size > 0) {
        diagnostics.push(
          diag(
            orExpression.range,
            "Multi-event `or` condition branches must not mix event variables with non-event variables."
          )
        )
      }

      if (analyses.some((analysis) => analysis.hasUnboundedEventCondition)) {
        diagnostics.push(
          diag(
            orExpression.range,
            "Multi-event `or` condition branches must be bounded event conditions."
          )
        )
      }
    }
  }
}

function validateConditionOfUsage(
  section: YaralSectionAst,
  matchSection: YaralSectionAst | undefined,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[]
) {
  if (symbols.eventVariables.length <= 1) {
    return
  }

  const eventVariableNames = new Set(symbols.eventVariables.map((symbol) => symbol.name))

  for (const statement of section.expressions) {
    if (!statement.expression) {
      continue
    }

    for (const ofExpression of collectOfExpressions(statement.expression)) {
      if (matchSection?.match?.windowKind === "tumbling") {
        diagnostics.push(
          diag(
            ofExpression.range,
            "Multi-event `of` conditions are not supported with tumbling match windows."
          )
        )
      }

      const analyses = ofExpression.expressions.map((operand) =>
        analyzeOrOperand(operand, eventVariableNames)
      )

      if (analyses.some((analysis) => analysis.hasUnboundedEventCondition)) {
        diagnostics.push(
          diag(
            ofExpression.range,
            "Multi-event `of` condition branches must be bounded event conditions."
          )
        )
      }
    }
  }
}

function collectOrExpressions(expression: YaralExpression) {
  const expressions: YaralBinaryExpression[] = []

  function visit(node: YaralExpression) {
    if (node.kind === "binary" && node.operator.toLowerCase() === "or") {
      expressions.push(node)
      return
    }
    switch (node.kind) {
      case "array":
        node.elements.forEach(visit)
        break
      case "binary":
        visit(node.left)
        visit(node.right)
        break
      case "call":
        node.args.forEach(visit)
        break
      case "group":
        visit(node.expression)
        break
      case "of":
        node.expressions.forEach(visit)
        break
      case "repeated":
      case "unary":
        visit(node.argument)
        break
    }
  }

  visit(expression)
  return expressions
}

function collectOfExpressions(expression: YaralExpression) {
  const expressions: Extract<YaralExpression, { kind: "of" }>[] = []

  function visit(node: YaralExpression) {
    if (node.kind === "of") {
      expressions.push(node)
    }
    switch (node.kind) {
      case "array":
        node.elements.forEach(visit)
        break
      case "binary":
        visit(node.left)
        visit(node.right)
        break
      case "call":
        node.args.forEach(visit)
        break
      case "group":
        visit(node.expression)
        break
      case "of":
        node.expressions.forEach(visit)
        break
      case "repeated":
      case "unary":
        visit(node.argument)
        break
    }
  }

  visit(expression)
  return expressions
}

function flattenOrOperands(expression: YaralExpression): YaralExpression[] {
  if (expression.kind === "binary" && expression.operator.toLowerCase() === "or") {
    return [
      ...flattenOrOperands(expression.left),
      ...flattenOrOperands(expression.right),
    ]
  }
  return [expression]
}

function analyzeOrOperand(
  expression: YaralExpression,
  eventVariableNames: Set<string>
) {
  const eventVariables = new Set<string>()
  const nonEventVariables = new Set<string>()
  const states = new Map<string, ConditionBoundState>()

  collectExpressionBoundStates(expression, states)
  walkExpression(expression, (node) => {
    if (!isSimpleVariableExpression(node)) {
      return
    }
    if (eventVariableNames.has(node.name)) {
      eventVariables.add(node.name)
    } else {
      nonEventVariables.add(node.name)
    }
  })

  const hasUnboundedEventCondition = [...eventVariables].some((eventVariable) => {
    const state = states.get(eventVariable)
    return state !== "bounded"
  })

  return { eventVariables, hasUnboundedEventCondition, nonEventVariables }
}

function validateSuppressionWindow(
  matchSection: YaralSectionAst | undefined,
  optionsSection: YaralSectionAst | undefined,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[]
) {
  if (!matchSection?.match?.duration || !optionsSection || symbols.eventVariables.length <= 1) {
    return
  }

  const suppressionWindow = findOptionDuration(optionsSection, "suppression_window")
  if (!suppressionWindow) {
    return
  }

  const suppressionMinutes = parseYaralDurationMinutes(suppressionWindow.value)
  const matchMinutes = parseYaralDurationMinutes(matchSection.match.duration.value)
  if (
    suppressionMinutes !== null &&
    matchMinutes !== null &&
    suppressionMinutes <= matchMinutes
  ) {
    diagnostics.push(
      diag(
        suppressionWindow.range,
        "`suppression_window` must be greater than the `match:` window for multi-event rules."
      )
    )
  }
}

function findOptionDuration(section: YaralSectionAst, name: string): YaralLiteralExpression | null {
  for (const statement of section.expressions) {
    const expression = statement.expression
    if (
      expression?.kind === "assignment" &&
      expression.left.kind === "identifier" &&
      expression.left.name.toLowerCase() === name &&
      expression.right.kind === "literal" &&
      expression.right.literalKind === "duration"
    ) {
      return expression.right
    }
  }
  return null
}

function collectSimpleConditionVariables(section: YaralSectionAst) {
  const names = new Set<string>()
  for (const statement of section.expressions) {
    if (!statement.expression) {
      continue
    }
    walkExpression(statement.expression, (node) => {
      if (isSimpleVariableExpression(node)) {
        names.add(node.name)
      }
    })
  }
  return [...names]
}

function collectConditionBoundStates(section: YaralSectionAst) {
  const states = new Map<string, ConditionBoundState>()
  for (const statement of section.expressions) {
    if (statement.expression) {
      collectExpressionBoundStates(statement.expression, states)
    }
  }
  return states
}

function collectExpressionBoundStates(
  expression: YaralExpression,
  states: Map<string, ConditionBoundState>
) {
  switch (expression.kind) {
    case "array":
      expression.elements.forEach((element) => collectExpressionBoundStates(element, states))
      break
    case "binary":
      collectCountComparisonState(expression, states)
      collectExpressionBoundStates(expression.left, states)
      collectExpressionBoundStates(expression.right, states)
      break
    case "call":
      expression.args.forEach((arg) => collectExpressionBoundStates(arg, states))
      break
    case "countVariable":
      if (expression.path.length === 0) {
        mergeConditionState(states, expression.name, "unknown")
      }
      break
    case "group":
      collectExpressionBoundStates(expression.expression, states)
      break
    case "of":
      expression.expressions.forEach((element) => collectExpressionBoundStates(element, states))
      break
    case "repeated":
      collectExpressionBoundStates(expression.argument, states)
      break
    case "unary":
      if (
        expression.operator === "!" &&
        expression.argument.kind === "variable" &&
        expression.argument.path.length === 0
      ) {
        mergeConditionState(states, expression.argument.name, "unbounded")
        break
      }
      collectExpressionBoundStates(expression.argument, states)
      break
    case "variable":
      if (expression.path.length === 0) {
        mergeConditionState(states, expression.name, "bounded")
      }
      break
  }
}

function collectCountComparisonState(
  expression: YaralBinaryExpression,
  states: Map<string, ConditionBoundState>
) {
  if (expression.left.kind !== "countVariable" || expression.left.path.length > 0) {
    return
  }
  if (expression.right.kind !== "literal" || expression.right.literalKind !== "number") {
    return
  }

  mergeConditionState(
    states,
    expression.left.name,
    getCountComparisonState(expression.operator, expression.right)
  )
}

function getCountComparisonState(
  operator: string,
  value: YaralLiteralExpression
): ConditionBoundState {
  const numericValue = Number(value.value)
  if (!Number.isFinite(numericValue)) {
    return "unknown"
  }

  if ((operator === ">" && numericValue >= 0) || (operator === ">=" && numericValue > 0)) {
    return "bounded"
  }
  if (
    (operator === "=" && numericValue === 0) ||
    (operator === "==" && numericValue === 0) ||
    (operator === "<" && numericValue > 0) ||
    (operator === "<=" && numericValue >= 0)
  ) {
    return "unbounded"
  }

  return "unknown"
}

function mergeConditionState(
  states: Map<string, ConditionBoundState>,
  name: string,
  state: ConditionBoundState
) {
  const current = states.get(name)
  if (!current || current === "unknown" || state === "bounded") {
    states.set(name, state)
  }
}

function diag(
  range: YaralSourceRange,
  message: string,
  severity: YaralDiagnostic["severity"] = "error"
) {
  return createDiagnostic(range, message, severity)
}
