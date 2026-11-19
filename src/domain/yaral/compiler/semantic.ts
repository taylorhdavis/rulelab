import { UDM_EVENT_TYPES } from "../../udm"
import { hasUdmFieldAllowedValues } from "../../udm/field-values"
import {
  getUdmFieldLiteralKind,
  isKnownScalarUdmFieldPath,
  isKnownUdmFieldPath,
  isKnownUdmFieldPrefix,
} from "../../udm/fields"
import {
  YARAL_AGGREGATE_FUNCTION_NAMES,
  YARAL_FUNCTIONS,
  getYaralApproximateFunctionMessage,
  getYaralFunctionRuntimeFidelity,
  isYaralUnsupportedRuntimeFunction,
} from "../functions"
import {
  isAssignmentExpression,
  isSimpleVariableExpression,
  isVariableLikeExpression,
  walkExpression,
} from "./ast"
import { createDiagnostic } from "./diagnostics"
import { getYaralDurationBoundsMessage } from "./duration"
import { validateRuleStructure } from "./rule-structure"
import { stripYaralStringQuotes } from "./text"
import type { YaralFunctionArgumentSpec } from "../functions"
import type {
  YaralBinaryExpression,
  YaralAssignmentExpression,
  YaralCallExpression,
  YaralCompileOptions,
  YaralDiagnostic,
  YaralEvaluationDataTable,
  YaralExpression,
  YaralLiteralExpression,
  YaralRuleAst,
  YaralSectionAst,
  YaralSectionName,
  YaralSourceRange,
  YaralSymbolTable,
  YaralUnaryExpression,
} from "./types"

const REQUIRED_SECTIONS = new Set<YaralSectionName>(["meta", "events", "condition"])
const ALLOWED_BARE_IDENTIFIERS = new Set([
  "false",
  "null",
  "today",
  "true",
  "window_end",
  "window_start",
])
const WINDOW_BOUNDARY_IDENTIFIERS = new Set(["window_end", "window_start"])
const UDM_EVENT_TYPE_SET = new Set<string>(UDM_EVENT_TYPES)
const CONFIRMED_REPEATED_OUTCOME_FIELD_PATHS = new Set([
  "about.ip",
  "intermediary.ip",
  "observer.ip",
  "principal.ip",
  "src.ip",
  "target.ip",
])

export function validateYaralSemantics(
  ast: YaralRuleAst | null,
  symbols: YaralSymbolTable,
  options: YaralCompileOptions = {}
) {
  const diagnostics: YaralDiagnostic[] = []
  if (!ast) {
    return diagnostics
  }

  const mode = options.mode ?? "rule"
  validateRequiredSections(ast, diagnostics, mode)
  const typeContext = buildTypeContext(ast, symbols, options)

  for (const section of ast.sections) {
    switch (section.name) {
      case "meta":
        validateMetaSection(section, diagnostics)
        break
      case "events":
        validateEventsSection(section, diagnostics)
        validateEventsDataTableLogicalBlocks(section, diagnostics)
        validateBareIdentifiersInSection(section, diagnostics)
        break
      case "match":
        validateMatchSection(section, symbols, diagnostics, typeContext)
        break
      case "outcome":
        validateOutcomeSection(section, diagnostics)
        validateBareIdentifiersInSection(section, diagnostics, true)
        break
      case "condition":
        validateConditionSection(section, symbols, diagnostics, typeContext)
        validateBareIdentifiersInSection(section, diagnostics)
        break
      case "options":
        validateOptionsSection(section, diagnostics)
        if (mode !== "rule") {
          diagnostics.push(diag(section.nameToken, "`options:` is only supported for YARA-L rules."))
        }
        break
    }

    for (const statement of section.expressions) {
      if (statement.expression) {
        validateExpression(statement.expression, diagnostics, typeContext)
      }
    }
  }

  validateVariableReferences(ast, symbols, diagnostics)
  validateEventsVariableReferences(ast, symbols, diagnostics)
  validateWindowBoundaryUsage(ast, diagnostics)
  validateReferenceListUsageLimits(ast, diagnostics)
  validateOutcomeAggregation(ast, symbols, diagnostics)
  if (mode === "rule") {
    validateRuleStructure(ast, symbols, diagnostics)
  }

  return diagnostics
}

function validateRequiredSections(
  ast: YaralRuleAst,
  diagnostics: YaralDiagnostic[],
  mode: NonNullable<YaralCompileOptions["mode"]>
) {
  const presentSections = new Set(ast.sections.map((section) => section.name))
  const requiredSections =
    mode === "rule" ? REQUIRED_SECTIONS : new Set<YaralSectionName>(["events"])
  for (const section of requiredSections) {
    if (!presentSections.has(section)) {
      diagnostics.push({
        column: 1,
        endColumn: 1,
        endLine: 1,
        line: 1,
        message: `Missing required \`${section}:\` section.`,
        severity: "error",
      })
    }
  }
}

function validateMetaSection(section: YaralSectionAst, diagnostics: YaralDiagnostic[]) {
  if (section.expressions.length === 0) {
    diagnostics.push(diag(section.nameToken, "`meta:` must include at least one key-value entry."))
    return
  }

  for (const statement of section.expressions) {
    const expression = statement.expression
    if (!expression) {
      continue
    }
    if (!isAssignmentExpression(expression)) {
      diagnostics.push(diag(expression.range, "Meta entries must use `key = value`."))
      continue
    }
    if (expression.left.kind !== "identifier") {
      diagnostics.push(diag(expression.left.range, "Meta entries must start with an identifier key."))
      continue
    }
    if (expression.right.kind !== "literal" || expression.right.literalKind !== "string") {
      diagnostics.push(diag(expression.right.range, "Meta values must be quoted strings."))
    }
  }

}

function validateEventsSection(section: YaralSectionAst, diagnostics: YaralDiagnostic[]) {
  if (section.expressions.length === 0) {
    diagnostics.push(diag(section.nameToken, "`events:` must contain at least one predicate."))
  }
}

function validateEventsDataTableLogicalBlocks(
  section: YaralSectionAst,
  diagnostics: YaralDiagnostic[]
) {
  for (const statement of section.expressions) {
    if (statement.expression) {
      validateDataTableLogicalBlock(statement.expression, diagnostics)
    }
  }
}

function validateDataTableLogicalBlock(
  expression: YaralExpression,
  diagnostics: YaralDiagnostic[]
) {
  if (expression.kind === "group") {
    validateDataTableLogicalBlock(expression.expression, diagnostics)
    return
  }

  switch (expression.kind) {
    case "array":
      expression.elements.forEach((element) => validateDataTableLogicalBlock(element, diagnostics))
      break
    case "binary":
      if (expression.operator === "and" || expression.operator === "or") {
        validateGroupedDataTableLogicalBlock(expression, diagnostics)
      }
      validateDataTableLogicalBlock(expression.left, diagnostics)
      validateDataTableLogicalBlock(expression.right, diagnostics)
      break
    case "call":
      expression.args.forEach((arg) => validateDataTableLogicalBlock(arg, diagnostics))
      break
    case "of":
      expression.expressions.forEach((element) => validateDataTableLogicalBlock(element, diagnostics))
      break
    case "repeated":
    case "unary":
      validateDataTableLogicalBlock(expression.argument, diagnostics)
      break
  }
}

function validateGroupedDataTableLogicalBlock(
  expression: YaralExpression,
  diagnostics: YaralDiagnostic[]
) {
  if (!containsLogicalOperator(expression)) {
    return
  }

  const lookupCount = countDataTableLookupComparisons(expression)
  if (lookupCount === 0) {
    return
  }

  const comparisonCount = countComparisonExpressions(expression)
  if (comparisonCount > lookupCount) {
    diagnostics.push(
      diag(
        expression.range,
        "Data table lookups in an `events:` logical block must not be mixed with standard comparisons."
      )
    )
  }

  if (containsDataTableLookupAnd(expression)) {
    diagnostics.push(
      diag(
        expression.range,
        "Data table lookups in an `events:` logical block can only be combined with `or`."
      )
    )
  }
}

function containsLogicalOperator(expression: YaralExpression) {
  return containsBinaryOperator(expression, (operator) => operator === "and" || operator === "or")
}

function containsDataTableLookupAnd(expression: YaralExpression): boolean {
  if (expression.kind !== "binary") {
    return false
  }

  const operator = expression.operator.toLowerCase()
  if (operator === "and" && (containsDataTableLookup(expression.left) || containsDataTableLookup(expression.right))) {
    return true
  }

  return containsDataTableLookupAnd(expression.left) || containsDataTableLookupAnd(expression.right)
}

function countDataTableLookupComparisons(expression: YaralExpression) {
  let count = 0
  walkExpression(expression, (node) => {
    if (node.kind === "binary" && isReferenceListMembershipExpression(node)) {
      count += 1
    }
  })
  return count
}

function countComparisonExpressions(expression: YaralExpression) {
  let count = 0
  walkExpression(expression, (node) => {
    if (node.kind === "binary" && isComparisonOperator(node.operator)) {
      count += 1
    }
  })
  return count
}

function containsDataTableLookup(expression: YaralExpression) {
  let found = false
  walkExpression(expression, (node) => {
    if (node.kind === "binary" && isReferenceListMembershipExpression(node)) {
      found = true
    }
  })
  return found
}

function containsBinaryOperator(
  expression: YaralExpression,
  predicate: (operator: string) => boolean
) {
  let found = false
  walkExpression(expression, (node) => {
    if (node.kind === "binary" && predicate(node.operator.toLowerCase())) {
      found = true
    }
  })
  return found
}

function isReferenceListMembershipExpression(expression: YaralBinaryExpression) {
  const operator = expression.operator.toLowerCase()
  return (
    ["in", "not in", "in regex", "not in regex", "in cidr", "not in cidr"].includes(operator) &&
    expression.right.kind === "referenceList"
  )
}

function validateMatchSection(
  section: YaralSectionAst,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  if (!section.match) {
    return
  }

  if (typeContext.mode !== "rule") {
    if (section.match.windowKind === "sliding") {
      diagnostics.push(
        diag(
          section.match.pivot?.range ?? section.match.windowToken ?? section.nameToken,
          "Sliding match windows are only supported for YARA-L rules."
        )
      )
    }
    return
  }

  const eventVariableNames = new Set(symbols.eventVariables.map((symbol) => symbol.name))
  const placeholderNames = new Set(
    symbols.placeholderVariables
      .filter((placeholder) => placeholder.sources.length > 0)
      .map((placeholder) => placeholder.name)
  )

  for (const variable of section.match.variables) {
    if (eventVariableNames.has(variable.name)) {
      diagnostics.push(
        diag(
          variable.range,
          `Match variable $${variable.name} must be a placeholder defined in \`events:\`, not an event variable.`
        )
      )
    } else if (!placeholderNames.has(variable.name)) {
      diagnostics.push(
        diag(variable.range, `Unknown match variable $${variable.name}. Define it in events first.`)
      )
    }
  }

  if (section.match.pivot && !eventVariableNames.has(section.match.pivot.name)) {
    diagnostics.push(
      diag(
        section.match.pivot.range,
        `Unknown pivot event variable $${section.match.pivot.name}. Define it in events first.`
      )
    )
  }
}

function validateOutcomeSection(section: YaralSectionAst, diagnostics: YaralDiagnostic[]) {
  const seenOutcomeVariables = new Set<string>()
  let outcomeCount = 0

  for (const statement of section.expressions) {
    const expression = statement.expression
    if (!expression) {
      continue
    }

    outcomeCount += 1
    if (!isAssignmentExpression(expression)) {
      diagnostics.push(diag(expression.range, "Outcome entries must use `$name = expression`."))
      continue
    }

    const target = getSimpleAssignmentTarget(expression)
    if (!target) {
      diagnostics.push(diag(expression.left.range, "Outcome entries must assign to a simple variable like `$risk_score`."))
      continue
    }

    if (seenOutcomeVariables.has(target.name)) {
      diagnostics.push(diag(target.range, `Duplicate outcome variable $${target.name}.`))
    }
    seenOutcomeVariables.add(target.name)
  }

  if (outcomeCount > 20) {
    diagnostics.push(diag(section.nameToken, "`outcome:` can define at most 20 outcome variables."))
  }
}

function validateConditionSection(
  section: YaralSectionAst,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  if (section.expressions.length === 0) {
    diagnostics.push(diag(section.nameToken, "`condition:` must contain a boolean expression."))
    return
  }

  if (section.expressions.length > 1) {
    diagnostics.push(
      diag(
        section.expressions[1]?.tokens[0] ?? section.nameToken,
        "`condition:` must contain a single boolean expression."
      )
    )
  }

  const conditionExpression = section.expressions[0]?.expression
  if (
    conditionExpression &&
    inferExpressionType(conditionExpression, typeContext) !== "unknown" &&
    inferExpressionType(conditionExpression, typeContext) !== "boolean"
  ) {
    diagnostics.push(diag(conditionExpression.range, "`condition:` must evaluate to a boolean expression."))
  }

  if (conditionExpression) {
    validateConditionNotUsage(conditionExpression, symbols, diagnostics)
  }
}

function validateConditionNotUsage(
  expression: YaralExpression,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[]
) {
  const eventNames = new Set(symbols.eventVariables.map((symbol) => symbol.name))
  const placeholderNames = new Set(symbols.placeholderVariables.map((symbol) => symbol.name))
  walkExpression(expression, (node) => {
    if (node.kind !== "unary" || node.operator.toLowerCase() !== "not") {
      return
    }
    if (containsConditionEventOrPlaceholder(node.argument, eventNames, placeholderNames)) {
      diagnostics.push(
        diag(
          node.range,
          "`not` is not allowed for event or placeholder conditions; use supported bounded or unbounded condition forms."
        )
      )
    }
  })
}

function containsConditionEventOrPlaceholder(
  expression: YaralExpression,
  eventNames: Set<string>,
  placeholderNames: Set<string>
) {
  let found = false
  walkExpression(expression, (node) => {
    if (
      (node.kind === "variable" || node.kind === "countVariable") &&
      node.path.length === 0 &&
      (eventNames.has(node.name) || placeholderNames.has(node.name))
    ) {
      found = true
    }
  })
  return found
}

function validateBareIdentifiersInSection(
  section: YaralSectionAst,
  diagnostics: YaralDiagnostic[],
  skipAssignmentTargets = false
) {
  for (const statement of section.expressions) {
    const expression = statement.expression
    if (!expression) {
      continue
    }

    if (skipAssignmentTargets && isAssignmentExpression(expression)) {
      validateBareIdentifiers(expression.right, diagnostics)
      continue
    }

    validateBareIdentifiers(expression, diagnostics)
  }
}

function validateBareIdentifiers(expression: YaralExpression, diagnostics: YaralDiagnostic[]) {
  walkExpression(expression, (node) => {
    if (
      node.kind === "identifier" &&
      !ALLOWED_BARE_IDENTIFIERS.has(node.name.toLowerCase())
    ) {
      diagnostics.push(diag(node.range, `Unexpected bare identifier \`${node.name}\`.`))
    }
  })
}

function validateOptionsSection(section: YaralSectionAst, diagnostics: YaralDiagnostic[]) {
  for (const statement of section.expressions) {
    const expression = statement.expression
    if (!expression) {
      continue
    }

    if (!isAssignmentExpression(expression) || expression.left.kind !== "identifier") {
      diagnostics.push(diag(expression.range, "Options entries must use `key = value`."))
      continue
    }

    const optionName = expression.left.name.toLowerCase()
    if (optionName !== "allow_zero_values" && optionName !== "suppression_window") {
      diagnostics.push(diag(expression.left.range, `Unknown option \`${expression.left.name}\`.`))
      continue
    }

    if (
      optionName === "allow_zero_values" &&
      !(
        expression.right.kind === "literal" &&
        expression.right.literalKind === "boolean"
      )
    ) {
      diagnostics.push(diag(expression.right.range, "`allow_zero_values` must be `true` or `false`."))
    }

    if (optionName === "suppression_window") {
      if (expression.right.kind !== "literal" || expression.right.literalKind !== "duration") {
        diagnostics.push(diag(expression.right.range, "`suppression_window` must be a duration like `5m`, `2h`, or `1d`."))
      } else {
        validateDurationBounds(expression.right, diagnostics)
      }
    }
  }
}

function validateVariableReferences(
  ast: YaralRuleAst,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[]
) {
  const baseVariables = new Set([
    ...symbols.eventVariables.map((symbol) => symbol.name),
    ...symbols.placeholderVariables
      .filter((symbol) => symbol.sources.length > 0)
      .map((symbol) => symbol.name),
  ])
  const seenOutcomeVariables = new Set<string>()
  const allOutcomeVariables = new Set(symbols.outcomeVariables.map((symbol) => symbol.name))

  for (const section of ast.sections) {
    if (section.name === "events" || section.name === "match" || section.name === "meta" || section.name === "options") {
      continue
    }

    if (section.name === "outcome") {
      for (const statement of section.expressions) {
        const expression = statement.expression
        if (!expression) {
          continue
        }

        if (isAssignmentExpression(expression)) {
          const target = getSimpleAssignmentTarget(expression)
          validateExpressionVariables(expression.right, baseVariables, seenOutcomeVariables, diagnostics)
          if (target) {
            seenOutcomeVariables.add(target.name)
          }
          continue
        }

        validateExpressionVariables(expression, baseVariables, seenOutcomeVariables, diagnostics)
      }
      continue
    }

    const visibleVariables = new Set([...baseVariables, ...allOutcomeVariables])
    for (const statement of section.expressions) {
      if (statement.expression) {
        validateExpressionVariables(statement.expression, visibleVariables, new Set(), diagnostics)
      }
    }
  }
}

function validateEventsVariableReferences(
  ast: YaralRuleAst,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[]
) {
  const eventsSection = ast.sections.find((section) => section.name === "events")
  if (!eventsSection) {
    return
  }

  const eventVariables = new Set(symbols.eventVariables.map((symbol) => symbol.name))
  const sourcedPlaceholders = new Set(
    symbols.placeholderVariables
      .filter((symbol) => symbol.sources.length > 0)
      .map((symbol) => symbol.name)
  )

  for (const statement of eventsSection.expressions) {
    if (!statement.expression) {
      continue
    }
    walkExpression(statement.expression, (node) => {
      if (!isSimpleVariableExpression(node)) {
        return
      }
      if (eventVariables.has(node.name) || sourcedPlaceholders.has(node.name)) {
        return
      }
      diagnostics.push(
        diag(
          node.range,
          `Unknown variable $${node.name}. Define it from an event field before using it in \`events:\`.`
        )
      )
    })
  }
}

function validateWindowBoundaryUsage(ast: YaralRuleAst, diagnostics: YaralDiagnostic[]) {
  const hasMatchWindow = ast.sections.some((section) => Boolean(section.match?.duration))

  for (const section of ast.sections) {
    for (const statement of section.expressions) {
      if (!statement.expression) {
        continue
      }

      walkExpression(statement.expression, (node) => {
        if (node.kind === "identifier" && WINDOW_BOUNDARY_IDENTIFIERS.has(node.name.toLowerCase())) {
          if (section.name !== "condition" && section.name !== "outcome") {
            diagnostics.push(
              diag(
                node.range,
                `\`${node.name}\` is only valid in \`condition:\` or \`outcome:\` when \`match:\` defines a window.`
              )
            )
            return
          }
          if (!hasMatchWindow) {
            diagnostics.push(diag(node.range, `\`${node.name}\` requires a \`match:\` window.`))
          }
        }

        if (
          isVariableLikeExpression(node) &&
          WINDOW_BOUNDARY_IDENTIFIERS.has(node.name.toLowerCase())
        ) {
          diagnostics.push(
            diag(
              node.range,
              `$${node.name} is reserved and cannot be used as a YARA-L variable.`
            )
          )
        }
      })
    }
  }
}

function validateExpressionVariables(
  expression: YaralExpression,
  baseVariables: Set<string>,
  outcomeVariables: Set<string>,
  diagnostics: YaralDiagnostic[]
) {
  walkExpression(expression, (node) => {
    if (
      isSimpleVariableExpression(node) &&
      !baseVariables.has(node.name) &&
      !outcomeVariables.has(node.name)
    ) {
      diagnostics.push(diag(node.range, `Unknown variable $${node.name}. Define it in events or outcome first.`))
    }
  })
}

function getSimpleAssignmentTarget(expression: YaralAssignmentExpression) {
  return expression.left.kind === "variable" && expression.left.path.length === 0
    ? expression.left
    : null
}

function validateOutcomeAggregation(
  ast: YaralRuleAst,
  symbols: YaralSymbolTable,
  diagnostics: YaralDiagnostic[]
) {
  const hasMatchSection = ast.sections.some((section) => section.name === "match" && section.match)
  const outcomeSection = ast.sections.find((section) => section.name === "outcome")
  if (!outcomeSection) {
    return
  }

  const placeholderNames = new Set(
    symbols.placeholderVariables
      .filter((symbol) => symbol.sources.length > 0)
      .map((symbol) => symbol.name)
  )
  const repeatedPlaceholderNames = new Set(
    symbols.placeholderVariables
      .filter((symbol) => symbol.sources.some((source) => {
        const path = getPlaceholderSourcePath(source)
        return path ? isConfirmedRepeatedOutcomeFieldPath(path) : false
      }))
      .map((symbol) => symbol.name)
  )
  const seenOutcomeVariables = new Set<string>()
  const invalidOutcomeVariables = new Set<string>()
  const invalidRepeatedOutcomeVariables = new Set<string>()

  for (const statement of outcomeSection.expressions) {
    const expression = statement.expression
    if (!expression) {
      continue
    }

    if (isAssignmentExpression(expression)) {
      const target = getSimpleAssignmentTarget(expression)
      if (!hasMatchSection) {
        const hasInvalidRepeatedDependency = validateRepeatedOutcomeAggregationExpression(
          expression.right,
          repeatedPlaceholderNames,
          invalidRepeatedOutcomeVariables,
          diagnostics,
          false
        )
        if (target && hasInvalidRepeatedDependency) {
          invalidRepeatedOutcomeVariables.add(target.name)
        }
        continue
      }

      const hasInvalidDependency = validateOutcomeAggregationExpression(
        expression.right,
        placeholderNames,
        seenOutcomeVariables,
        invalidOutcomeVariables,
        diagnostics,
        false,
        false
      )
      if (target) {
        seenOutcomeVariables.add(target.name)
        if (hasInvalidDependency) {
          invalidOutcomeVariables.add(target.name)
        }
      }
      continue
    }

    if (!hasMatchSection) {
      validateRepeatedOutcomeAggregationExpression(
        expression,
        repeatedPlaceholderNames,
        invalidRepeatedOutcomeVariables,
        diagnostics,
        false
      )
      continue
    }

    validateOutcomeAggregationExpression(
      expression,
      placeholderNames,
      seenOutcomeVariables,
      invalidOutcomeVariables,
      diagnostics,
      false,
      false
    )
  }
}

function validateRepeatedOutcomeAggregationExpression(
  expression: YaralExpression,
  repeatedPlaceholderNames: Set<string>,
  invalidRepeatedOutcomeVariables: Set<string>,
  diagnostics: YaralDiagnostic[],
  insideAggregate: boolean
): boolean {
  let hasInvalidDependency = false

  switch (expression.kind) {
    case "array":
      expression.elements.forEach((element) => {
        hasInvalidDependency =
          validateRepeatedOutcomeAggregationExpression(
            element,
            repeatedPlaceholderNames,
            invalidRepeatedOutcomeVariables,
            diagnostics,
            insideAggregate
          ) || hasInvalidDependency
      })
      break
    case "binary":
      hasInvalidDependency =
        validateRepeatedOutcomeAggregationExpression(
          expression.left,
          repeatedPlaceholderNames,
          invalidRepeatedOutcomeVariables,
          diagnostics,
          insideAggregate
        ) || hasInvalidDependency
      hasInvalidDependency =
        validateRepeatedOutcomeAggregationExpression(
          expression.right,
          repeatedPlaceholderNames,
          invalidRepeatedOutcomeVariables,
          diagnostics,
          insideAggregate
        ) || hasInvalidDependency
      break
    case "call": {
      const nextInsideAggregate =
        insideAggregate || YARAL_AGGREGATE_FUNCTION_NAMES.has(expression.callee.toLowerCase())
      expression.args.forEach((arg) => {
        hasInvalidDependency =
          validateRepeatedOutcomeAggregationExpression(
            arg,
            repeatedPlaceholderNames,
            invalidRepeatedOutcomeVariables,
            diagnostics,
            nextInsideAggregate
          ) || hasInvalidDependency
      })
      break
    }
    case "group":
      hasInvalidDependency =
        validateRepeatedOutcomeAggregationExpression(
          expression.expression,
          repeatedPlaceholderNames,
          invalidRepeatedOutcomeVariables,
          diagnostics,
          insideAggregate
        ) || hasInvalidDependency
      break
    case "repeated":
      hasInvalidDependency =
        validateRepeatedOutcomeAggregationExpression(
          expression.argument,
          repeatedPlaceholderNames,
          invalidRepeatedOutcomeVariables,
          diagnostics,
          insideAggregate
        ) || hasInvalidDependency
      break
    case "unary":
      hasInvalidDependency =
        validateRepeatedOutcomeAggregationExpression(
          expression.argument,
          repeatedPlaceholderNames,
          invalidRepeatedOutcomeVariables,
          diagnostics,
          insideAggregate
        ) || hasInvalidDependency
      break
    case "variable":
      if (expression.path.length === 0 && invalidRepeatedOutcomeVariables.has(expression.name)) {
        diagnostics.push(
          diag(
            expression.range,
            "Outcome variables that depend on repeated event fields or placeholders must not be used in later outcome assignments."
          )
        )
        hasInvalidDependency = true
      }
      if (
        !insideAggregate &&
        (
          (expression.path.length > 0 && isConfirmedRepeatedOutcomeFieldPath(expression.path)) ||
          (expression.path.length === 0 && repeatedPlaceholderNames.has(expression.name))
        )
      ) {
        diagnostics.push(
          diag(
            expression.range,
            "Repeated event fields and placeholders in `outcome:` must be aggregated."
          )
        )
        hasInvalidDependency = true
      }
      break
  }

  return hasInvalidDependency
}

function isConfirmedRepeatedOutcomeFieldPath(path: string) {
  return CONFIRMED_REPEATED_OUTCOME_FIELD_PATHS.has(path.replace(/\[[^\]]+\]/g, ""))
}

function validateOutcomeAggregationExpression(
  expression: YaralExpression,
  placeholderNames: Set<string>,
  seenOutcomeVariables: Set<string>,
  invalidOutcomeVariables: Set<string>,
  diagnostics: YaralDiagnostic[],
  insideAggregate: boolean,
  insideOutcomeArrayLength: boolean
): boolean {
  let hasInvalidDependency = false

  switch (expression.kind) {
    case "array":
      expression.elements.forEach((element) => {
        hasInvalidDependency =
          validateOutcomeAggregationExpression(
            element,
            placeholderNames,
            seenOutcomeVariables,
            invalidOutcomeVariables,
            diagnostics,
            insideAggregate,
            insideOutcomeArrayLength
          ) || hasInvalidDependency
      })
      break
    case "binary":
      hasInvalidDependency =
        validateOutcomeAggregationExpression(
          expression.left,
          placeholderNames,
          seenOutcomeVariables,
          invalidOutcomeVariables,
          diagnostics,
          insideAggregate,
          insideOutcomeArrayLength
        ) || hasInvalidDependency
      hasInvalidDependency =
        validateOutcomeAggregationExpression(
          expression.right,
          placeholderNames,
          seenOutcomeVariables,
          invalidOutcomeVariables,
          diagnostics,
          insideAggregate,
          insideOutcomeArrayLength
        ) || hasInvalidDependency
      break
    case "call": {
      const callee = expression.callee.toLowerCase()
      const nextInsideAggregate =
        insideAggregate || YARAL_AGGREGATE_FUNCTION_NAMES.has(callee)
      const nextInsideOutcomeArrayLength =
        insideOutcomeArrayLength || callee === "arrays.length"
      expression.args.forEach((arg) => {
        hasInvalidDependency =
          validateOutcomeAggregationExpression(
            arg,
            placeholderNames,
            seenOutcomeVariables,
            invalidOutcomeVariables,
            diagnostics,
            nextInsideAggregate,
            nextInsideOutcomeArrayLength
          ) || hasInvalidDependency
      })
      break
    }
    case "group":
      hasInvalidDependency =
        validateOutcomeAggregationExpression(
          expression.expression,
          placeholderNames,
          seenOutcomeVariables,
          invalidOutcomeVariables,
          diagnostics,
          insideAggregate,
          insideOutcomeArrayLength
        ) || hasInvalidDependency
      break
    case "repeated":
      hasInvalidDependency =
        validateOutcomeAggregationExpression(
          expression.argument,
          placeholderNames,
          seenOutcomeVariables,
          invalidOutcomeVariables,
          diagnostics,
          insideAggregate,
          insideOutcomeArrayLength
        ) || hasInvalidDependency
      break
    case "unary":
      hasInvalidDependency =
        validateOutcomeAggregationExpression(
          expression.argument,
          placeholderNames,
          seenOutcomeVariables,
          invalidOutcomeVariables,
          diagnostics,
          insideAggregate,
          insideOutcomeArrayLength
        ) || hasInvalidDependency
      break
    case "variable":
      if (expression.path.length === 0 && invalidOutcomeVariables.has(expression.name)) {
        diagnostics.push(
          diag(
            expression.range,
            "Outcome variables that depend on unaggregated event fields or placeholders must not be used in later outcome assignments."
          )
        )
        hasInvalidDependency = true
      }
      if (insideAggregate && expression.path.length === 0 && seenOutcomeVariables.has(expression.name)) {
        diagnostics.push(diag(expression.range, "Outcome variables must not be wrapped in aggregation functions."))
      }
      if (insideOutcomeArrayLength && expression.path.length === 0 && seenOutcomeVariables.has(expression.name)) {
        diagnostics.push(
          diag(expression.range, "Outcome variables must not be used in `arrays.length()` outcome assignments.")
        )
      }
      if (
        !insideAggregate &&
        (expression.path.length > 0 || (expression.path.length === 0 && placeholderNames.has(expression.name)))
      ) {
        diagnostics.push(
          diag(
            expression.range,
            "Outcome expressions in rules with `match:` must aggregate event fields and placeholders."
          )
        )
        hasInvalidDependency = true
      }
      break
  }

  return hasInvalidDependency
}

function validateDurationBounds(token: YaralLiteralExpression, diagnostics: YaralDiagnostic[]) {
  const message = getYaralDurationBoundsMessage(token.value, 48 * 60)
  if (message) {
    diagnostics.push(diag(token.range, message))
  }
}

function validateExpression(
  expression: YaralExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  walkExpression(expression, (node) => {
    if (isVariableLikeExpression(node)) {
      if (isAdditionalFieldsTypoPath(node.path)) {
        diagnostics.push(
          diag(
            node.range,
            "UDM dynamic fields use `additional.fields[...]`, not `additional_fields[...]`."
          )
        )
      }
      if (
        typeContext.experimentalDiagnostics &&
        node.path.length > 0 &&
        !isKnownUdmFieldPath(node.path)
      ) {
        const prefixHint = isKnownUdmFieldPrefix(node.path)
          ? " This looks like a parent object; compare against a concrete child field."
          : ""
        diagnostics.push(
          diag(
            node.range,
            `UDM field path \`${node.path}\` is not a valid UDM field.${prefixHint}`,
            "warning"
          )
        )
      }
    }

    if (node.kind === "call") {
      validateFunctionCall(node, diagnostics, typeContext)
    }

    if (node.kind === "referenceList") {
      validateReferenceList(node, diagnostics, typeContext)
    }

    if (node.kind === "repeated") {
      validateRepeatedFieldModifier(node, diagnostics)
    }

    if (node.kind === "literal") {
      validateLiteral(node, diagnostics)
    }

    if (node.kind === "binary" || node.kind === "assignment") {
      const binary = node.kind === "binary"
        ? node
        : ({ ...node, kind: "binary", operator: "=" } as YaralBinaryExpression)
      validateArithmeticOperandTypes(binary, diagnostics, typeContext)
      validateLogicalOperandTypes(binary, diagnostics, typeContext)
      validateLiteralComparison(binary, diagnostics)
      validateKnownTypeComparison(binary, diagnostics, typeContext)
      validateMembershipOperatorTypes(binary, diagnostics, typeContext)
      validateRegexOperatorTypes(binary, diagnostics, typeContext)
      validateNocaseEnumeratedFieldComparison(binary, diagnostics)
      validateNocaseKnownScalarComparison(binary, diagnostics, typeContext)
      validateEventTypeComparison(binary, diagnostics)
      validateUdmTypeComparison(binary, diagnostics)
    }

    if (node.kind === "unary") {
      validateLogicalNegationOperandType(node, diagnostics, typeContext)
    }
  })
}

function isAdditionalFieldsTypoPath(path: string) {
  return (
    path === "additional_fields" ||
    path.startsWith("additional_fields.") ||
    path.startsWith("additional_fields[")
  )
}

function validateRepeatedFieldModifier(
  expression: Extract<YaralExpression, { kind: "repeated" }>,
  diagnostics: YaralDiagnostic[]
) {
  if (
    expression.argument.kind === "variable" &&
    expression.argument.path.length > 0 &&
    isKnownScalarUdmFieldPath(expression.argument.path)
  ) {
    diagnostics.push(
      diag(
        expression.range,
        `\`${expression.quantifier}\` can only be used with repeated UDM fields.`
      )
    )
  }
}

function validateLiteral(expression: YaralLiteralExpression, diagnostics: YaralDiagnostic[]) {
  if (expression.literalKind === "number" && !/^\d+(?:\.\d+)?$/.test(expression.value)) {
    diagnostics.push(diag(expression.range, "Number literals must be valid decimals."))
  }
}

function validateArithmeticOperandTypes(
  expression: YaralBinaryExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  if (!["+", "-", "*", "/", "%"].includes(expression.operator)) {
    return
  }

  for (const operand of [expression.left, expression.right]) {
    const type = inferExpressionType(operand, typeContext)
    if (type !== "unknown" && type !== "number") {
      diagnostics.push(diag(operand.range, "Arithmetic operands must be numbers."))
    }
  }
}

function validateLogicalOperandTypes(
  expression: YaralBinaryExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  const operator = expression.operator.toLowerCase()
  if (operator !== "and" && operator !== "or") {
    return
  }

  for (const operand of [expression.left, expression.right]) {
    const type = inferExpressionType(operand, typeContext)
    if (!isBooleanCompatibleType(type)) {
      diagnostics.push(diag(operand.range, "Logical operators need boolean-compatible operands."))
    }
  }
}

function validateLogicalNegationOperandType(
  expression: YaralUnaryExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  const operator = expression.operator.toLowerCase()
  if (operator !== "!" && operator !== "not") {
    return
  }

  const type = inferExpressionType(expression.argument, typeContext)
  if (!isBooleanCompatibleType(type)) {
    diagnostics.push(diag(expression.argument.range, "Logical negation needs a boolean-compatible operand."))
  }
}

function isBooleanCompatibleType(type: YaralExpressionType) {
  return type === "unknown" || type === "boolean" || type === "number"
}

function validateFunctionCall(
  expression: YaralCallExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  const callee = expression.callee.toLowerCase()
  const signature = YARAL_FUNCTIONS.get(callee)
  if (!signature) {
    if (isYaralUnsupportedRuntimeFunction(expression.callee)) {
      return
    }
    diagnostics.push(diag(expression.range, `Unknown YARA-L function \`${expression.callee}\`.`))
    return
  }

  validateApproximateLocalHelper(expression, diagnostics, typeContext)
  validateExperimentalWindowHelper(expression, diagnostics, typeContext)

  if (expression.args.length < signature.min || expression.args.length > signature.max) {
    diagnostics.push(
      diag(
        expression.range,
        `Function \`${expression.callee}\` expects ${formatArity(signature.min, signature.max)}, got ${expression.args.length}.`
      )
    )
  }

  validateFunctionArgumentTypes(expression, diagnostics, typeContext)
  validateFunctionProductMode(expression, diagnostics, typeContext)
  validateArrayContainsElementType(expression, diagnostics, typeContext)
  validateArrayNumericElementType(expression, diagnostics, typeContext)
}

function validateExperimentalWindowHelper(
  expression: YaralCallExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  if (!typeContext.experimentalDiagnostics || !expression.callee.toLowerCase().startsWith("window.")) {
    return
  }

  diagnostics.push(
    diag(
      expression.range,
      `RuleLab has not fully confirmed \`window.*\` helper legal contexts against Google SecOps; treat local guidance for \`${expression.callee}\` as experimental.`,
      "warning"
    )
  )
}

function validateApproximateLocalHelper(
  expression: YaralCallExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  if (!typeContext.approximateHelperDiagnostics) {
    return
  }

  const callee = expression.callee.toLowerCase()
  if (getYaralFunctionRuntimeFidelity(callee) === "approximate") {
    diagnostics.push(
      diag(
        expression.range,
        getYaralApproximateFunctionMessage(callee),
        "warning"
      )
    )
  }
}

function validateFunctionProductMode(
  expression: YaralCallExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  const callee = expression.callee.toLowerCase()
  const supportedModes = getSupportedFunctionModes(callee)
  if (!supportedModes || supportedModes.has(typeContext.mode)) {
    return
  }

  diagnostics.push(
    diag(
      expression.range,
      `Function \`${expression.callee}\` is not supported in YARA-L ${typeContext.mode} queries.`
    )
  )
}

function getSupportedFunctionModes(callee: string) {
  if (!callee.startsWith("window.")) {
    return null
  }
  if (callee === "window.range") {
    return new Set<NonNullable<YaralCompileOptions["mode"]>>(["rule", "search"])
  }
  return new Set<NonNullable<YaralCompileOptions["mode"]>>(["rule"])
}

type YaralExpressionType =
  | "array"
  | "array:boolean"
  | "array:number"
  | "array:regex"
  | "array:string"
  | "boolean"
  | "duration"
  | "null"
  | "number"
  | "regex"
  | "string"
  | "unknown"

type YaralArrayElementType = "boolean" | "number" | "regex" | "string"

type YaralTypeContext = {
  approximateHelperDiagnostics: boolean
  dataTables: Map<string, YaralExpressionType>
  dataTablesProvided: boolean
  experimentalDiagnostics: boolean
  mode: NonNullable<YaralCompileOptions["mode"]>
  variables: Map<string, YaralExpressionType>
}

const EMPTY_TYPE_CONTEXT: YaralTypeContext = {
  approximateHelperDiagnostics: false,
  dataTables: new Map(),
  dataTablesProvided: false,
  experimentalDiagnostics: false,
  mode: "rule",
  variables: new Map(),
}

function buildTypeContext(
  ast: YaralRuleAst,
  symbols: YaralSymbolTable,
  options: YaralCompileOptions
): YaralTypeContext {
  const dataTables = buildDataTableTypeContext(options.dataTables ?? [])
  const variables = new Map<string, YaralExpressionType>()

  for (const placeholder of symbols.placeholderVariables) {
    const sourceTypes = [
      ...new Set(
        placeholder.sources
          .map(getPlaceholderSourcePath)
          .map((path) => (path ? getUdmFieldLiteralKind(path) ?? "unknown" : "unknown"))
      ),
    ]
    if (sourceTypes.length === 1 && sourceTypes[0]) {
      variables.set(placeholder.name, sourceTypes[0])
    }
  }

  const context = {
    approximateHelperDiagnostics: options.approximateHelperDiagnostics === true,
    dataTables,
    dataTablesProvided: options.dataTables !== undefined,
    experimentalDiagnostics: options.experimentalDiagnostics === true,
    mode: options.mode ?? "rule",
    variables,
  }
  const placeholderNames = new Set(symbols.placeholderVariables.map((placeholder) => placeholder.name))
  const eventsSection = ast.sections.find((section) => section.name === "events")
  for (const statement of eventsSection?.expressions ?? []) {
    const expression = statement.expression
    if (!expression || !isAssignmentExpression(expression)) {
      continue
    }

    const target = getSimpleAssignmentTarget(expression)
    if (target && placeholderNames.has(target.name)) {
      variables.set(target.name, inferExpressionType(expression.right, context))
    }
  }

  const outcomeSection = ast.sections.find((section) => section.name === "outcome")
  for (const statement of outcomeSection?.expressions ?? []) {
    const expression = statement.expression
    if (!expression || !isAssignmentExpression(expression)) {
      continue
    }

    const target = getSimpleAssignmentTarget(expression)
    if (target) {
      variables.set(target.name, inferExpressionType(expression.right, context))
    }
  }

  return context
}

function validateReferenceList(
  expression: Extract<YaralExpression, { kind: "referenceList" }>,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  if (typeContext.experimentalDiagnostics) {
    diagnostics.push(
      diag(
        expression.range,
        `RuleLab local data-table evaluation is conservative for richer row shapes; verify \`%${expression.name}\` behavior in Google SecOps when precision matters.`,
        "warning"
      )
    )
  }

  if (!typeContext.dataTablesProvided || typeContext.dataTables.has(expression.name)) {
    return
  }

  diagnostics.push(
    diag(
      expression.range,
      `Data table reference \`${expression.name}\` does not match a saved data table or column.`,
      "warning"
    )
  )
}

function validateReferenceListUsageLimits(ast: YaralRuleAst, diagnostics: YaralDiagnostic[]) {
  const counts = {
    cidr: 0,
    regex: 0,
    string: 0,
  }
  const firstRanges: Partial<Record<keyof typeof counts, YaralSourceRange>> = {}

  for (const section of ast.sections) {
    if (section.name !== "events" && section.name !== "outcome") {
      continue
    }

    for (const statement of section.expressions) {
      if (!statement.expression) {
        continue
      }
      walkExpression(statement.expression, (node) => {
        if (node.kind !== "binary" || node.right.kind !== "referenceList") {
          return
        }

        const operator = node.operator.toLowerCase()
        if (operator === "in cidr" || operator === "not in cidr") {
          counts.cidr += 1
          firstRanges.cidr ??= node.range
          if (node.nocase) {
            diagnostics.push(
              diag(
                node.range,
                "`nocase` is supported only for string and regex reference-list or data-table lookups."
              )
            )
          }
          return
        }

        if (operator === "in regex" || operator === "not in regex") {
          counts.regex += 1
          firstRanges.regex ??= node.range
          return
        }

        if (operator === "in" || operator === "not in") {
          counts.string += 1
          firstRanges.string ??= node.range
        }
      })
    }
  }

  if (counts.string > 10 && firstRanges.string) {
    diagnostics.push(
      diag(
        firstRanges.string,
        "Rules, searches, and dashboards can use at most 10 string reference-list or data-table `in` lookups."
      )
    )
  }
  if (counts.regex > 5 && firstRanges.regex) {
    diagnostics.push(
      diag(
        firstRanges.regex,
        "Rules, searches, and dashboards can use at most 5 regex reference-list or data-table lookups."
      )
    )
  }
  if (counts.cidr > 5 && firstRanges.cidr) {
    diagnostics.push(
      diag(
        firstRanges.cidr,
        "Rules, searches, and dashboards can use at most 5 CIDR reference-list or data-table lookups."
      )
    )
  }
}

function buildDataTableTypeContext(dataTables: YaralEvaluationDataTable[]) {
  const dataTableTypes = new Map<string, YaralExpressionType>()
  for (const table of dataTables) {
    dataTableTypes.set(table.name, inferDataTableRowsType(table.rows))
    for (const column of getDataTableColumns(table.rows)) {
      dataTableTypes.set(`${table.name}.${column}`, inferDataTableColumnType(table.rows, column))
    }
  }
  return dataTableTypes
}

function inferDataTableRowsType(rows: unknown[]): YaralExpressionType {
  const elementTypes = new Set<YaralArrayElementType>()
  for (const row of rows) {
    for (const value of extractDataTableLookupValues(row)) {
      const type = inferRuntimeValueType(value)
      if (isSupportedArrayElementType(type)) {
        elementTypes.add(type)
      }
    }
  }
  return elementTypes.size === 1 ? `array:${[...elementTypes][0]}` : "array"
}

function inferDataTableColumnType(rows: unknown[], column: string): YaralExpressionType {
  const elementTypes = new Set<YaralArrayElementType>()
  for (const row of rows) {
    for (const value of extractDataTableColumnValues(row, column)) {
      const type = inferRuntimeValueType(value)
      if (isSupportedArrayElementType(type)) {
        elementTypes.add(type)
      }
    }
  }
  return elementTypes.size === 1 ? `array:${[...elementTypes][0]}` : "array"
}

function extractDataTableLookupValues(row: unknown): unknown[] {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return [row]
  }

  return collectDataTableScalarValues(row)
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

function inferRuntimeValueType(value: unknown): YaralExpressionType {
  switch (typeof value) {
    case "boolean":
      return "boolean"
    case "number":
      return "number"
    case "string":
      return "string"
    default:
      return "unknown"
  }
}

function getPlaceholderSourcePath(source: string) {
  return source.match(/^\$[^.]+\.(.+)$/)?.[1] ?? null
}

function validateFunctionArgumentTypes(
  expression: YaralCallExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  const signature = YARAL_FUNCTIONS.get(expression.callee.toLowerCase())
  for (const spec of signature?.args ?? []) {
    const argumentIndexes = spec.repeat
      ? expression.args.slice(spec.index).map((_, offset) => spec.index + offset)
      : [spec.index]
    for (const index of argumentIndexes) {
      const argument = expression.args[index]
      if (!argument) {
        continue
      }

      if (!isFunctionArgumentTypeCompatible(spec.types, inferExpressionType(argument, typeContext))) {
        diagnostics.push(diag(argument.range, formatArgumentTypeMessage(expression.callee, spec)))
      }
    }
  }
}

function validateArrayContainsElementType(
  expression: YaralCallExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  if (expression.callee.toLowerCase() !== "arrays.contains") {
    return
  }
  const arrayType = getArrayElementType(inferExpressionType(expression.args[0], typeContext))
  const value = expression.args[1]
  if (!arrayType || !value) {
    return
  }
  const valueType = inferExpressionType(value, typeContext)
  if (valueType !== "unknown" && valueType !== arrayType) {
    diagnostics.push(
      diag(value.range, "Function `arrays.contains` value should match the array element type.")
    )
  }
}

function validateArrayNumericElementType(
  expression: YaralCallExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  const callee = expression.callee.toLowerCase()
  if (callee !== "arrays.max" && callee !== "arrays.min") {
    return
  }
  const arrayArgument = expression.args[0]
  if (!arrayArgument) {
    return
  }
  const arrayType = getArrayElementType(inferExpressionType(arrayArgument, typeContext))
  if (arrayType && arrayType !== "number") {
    diagnostics.push(
      diag(arrayArgument.range, `Function \`${expression.callee}\` expects an array of number values.`)
    )
  }
}

function formatArgumentTypeMessage(callee: string, spec: YaralFunctionArgumentSpec) {
  return spec.message?.replace("{callee}", callee) ?? `Function \`${callee}\` argument ${spec.index + 1} has an incompatible type.`
}

function inferExpressionType(
  expression: YaralExpression,
  typeContext: YaralTypeContext = EMPTY_TYPE_CONTEXT
): YaralExpressionType {
  switch (expression.kind) {
    case "array":
      return inferArrayExpressionType(expression, typeContext)
    case "binary":
      if (["and", "or", "=", "==", "!=", "<", "<=", ">", ">=", "in", "in regex", "not in", "not in regex", "regex", "not regex", "is"].includes(expression.operator.toLowerCase())) {
        return "boolean"
      }
      return "number"
    case "assignment":
      return inferExpressionType(expression.right, typeContext)
    case "call":
      return inferFunctionReturnType(expression, typeContext)
    case "countVariable":
      return "number"
    case "group":
      return inferExpressionType(expression.expression, typeContext)
    case "identifier":
      return ["false", "true"].includes(expression.name.toLowerCase()) ? "boolean" : "unknown"
    case "literal":
      return expression.literalKind
    case "of":
      return "boolean"
    case "referenceList":
      return typeContext.dataTables.get(expression.name) ?? "array"
    case "repeated":
      return inferExpressionType(expression.argument, typeContext)
    case "unary":
      return expression.operator === "!" || expression.operator.toLowerCase() === "not"
        ? "boolean"
        : inferExpressionType(expression.argument, typeContext)
    case "variable":
      return expression.path.length === 0
        ? typeContext.variables.get(expression.name) ?? "unknown"
        : getUdmFieldLiteralKind(expression.path) ?? "unknown"
  }
}

function inferArrayExpressionType(
  expression: Extract<YaralExpression, { kind: "array" }>,
  typeContext: YaralTypeContext
): YaralExpressionType {
  const elementTypes = [
    ...new Set(
      expression.elements
        .map((element) => inferExpressionType(element, typeContext))
        .filter(isSupportedArrayElementType)
    ),
  ]
  return elementTypes.length === 1 ? `array:${elementTypes[0]}` : "array"
}

function isSupportedArrayElementType(
  type: YaralExpressionType
): type is YaralArrayElementType {
  return type === "boolean" || type === "number" || type === "regex" || type === "string"
}

function getArrayElementType(type: YaralExpressionType) {
  const match = type.match(/^array:(boolean|number|regex|string)$/)
  return match?.[1] as YaralArrayElementType | undefined
}

function isFunctionArgumentTypeCompatible(
  expectedTypes: readonly YaralFunctionArgumentSpec["types"][number][],
  actualType: YaralExpressionType
) {
  return expectedTypes.some((expectedType) =>
    expectedType === "array" ? actualType === "array" || actualType.startsWith("array:") : expectedType === actualType
  )
}

function inferFunctionReturnType(
  expression: YaralCallExpression,
  typeContext: YaralTypeContext
): YaralExpressionType {
  const callee = expression.callee.toLowerCase()
  if (callee === "if") {
    return inferConditionalReturnType(expression, typeContext)
  }
  if (callee === "array" || callee === "array_distinct") {
    return inferArrayFunctionReturnType(expression, typeContext)
  }
  if (callee === "arrays.concat" || callee === "group") {
    return inferArrayFunctionReturnType(expression, typeContext)
  }
  if (callee === "cidr" || callee === "strings.split") {
    return "array:string"
  }
  if (callee === "window.first" || callee === "window.last") {
    return expression.args[1] ? inferExpressionType(expression.args[1], typeContext) : "unknown"
  }
  if (callee === "window.mode") {
    return expression.args[0] ? inferExpressionType(expression.args[0], typeContext) : "unknown"
  }
  if (isYaralUnsupportedRuntimeFunction(expression.callee)) {
    return "unknown"
  }
  return YARAL_FUNCTIONS.get(callee)?.returnType ?? "unknown"
}

function inferArrayFunctionReturnType(
  expression: YaralCallExpression,
  typeContext: YaralTypeContext
): YaralExpressionType {
  const elementTypes = [
    ...new Set(
      expression.args
        .map((argument) => getArrayElementCandidateType(inferExpressionType(argument, typeContext)))
        .filter(isSupportedArrayElementType)
    ),
  ]
  return elementTypes.length === 1 ? `array:${elementTypes[0]}` : "array"
}

function getArrayElementCandidateType(type: YaralExpressionType) {
  return getArrayElementType(type) ?? type
}

function inferConditionalReturnType(
  expression: YaralCallExpression,
  typeContext: YaralTypeContext
): YaralExpressionType {
  const whenTrue = expression.args[1]
  const whenFalse = expression.args[2]
  if (!whenTrue || !whenFalse) {
    return "unknown"
  }

  const trueType = inferExpressionType(whenTrue, typeContext)
  const falseType = inferExpressionType(whenFalse, typeContext)
  if (trueType === falseType) {
    return trueType
  }
  if (trueType === "unknown") {
    return falseType
  }
  if (falseType === "unknown") {
    return trueType
  }
  return "unknown"
}

function validateLiteralComparison(
  expression: YaralBinaryExpression,
  diagnostics: YaralDiagnostic[]
) {
  if (
    !isComparisonOperator(expression.operator) ||
    expression.left.kind !== "literal" ||
    expression.right.kind !== "literal"
  ) {
    return
  }

  diagnostics.push(
    diag(expression.range, "Comparison expressions must not compare two literal values.")
  )
}

function validateKnownTypeComparison(
  expression: YaralBinaryExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  if (!isEqualityOperator(expression.operator)) {
    return
  }
  if (isDirectUdmLiteralComparison(expression.left, expression.right)) {
    return
  }

  const leftType = inferExpressionType(expression.left, typeContext)
  const rightType = inferExpressionType(expression.right, typeContext)
  if (
    leftType === "unknown" ||
    rightType === "unknown" ||
    leftType === rightType ||
    leftType.startsWith("array") ||
    rightType.startsWith("array")
  ) {
    return
  }

  if (isStrictScalarType(leftType) && isStrictScalarType(rightType)) {
    diagnostics.push(diag(expression.range, `Cannot compare ${leftType} and ${rightType} values.`))
  }
}

function isStrictScalarType(type: YaralExpressionType) {
  return type === "boolean" || type === "number" || type === "string"
}

function isDirectUdmLiteralComparison(left: YaralExpression, right: YaralExpression) {
  return (
    (left.kind === "variable" && left.path.length > 0 && right.kind === "literal") ||
    (right.kind === "variable" && right.path.length > 0 && left.kind === "literal")
  )
}

function validateMembershipOperatorTypes(
  expression: YaralBinaryExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  const operator = expression.operator.toLowerCase()
  if (operator !== "in" && operator !== "not in" && operator !== "in cidr" && operator !== "not in cidr") {
    return
  }

  const leftType = inferExpressionType(expression.left, typeContext)
  const rightType = inferExpressionType(expression.right, typeContext)
  if (
    rightType !== "unknown" &&
    rightType !== "array" &&
    !rightType.startsWith("array:")
  ) {
    diagnostics.push(diag(expression.right.range, "Membership comparisons need an array or reference list on the right."))
    return
  }

  const arrayType = getArrayElementType(rightType)
  if (
    arrayType &&
    leftType !== "unknown" &&
    leftType !== arrayType &&
    !leftType.startsWith("array:")
  ) {
    diagnostics.push(diag(expression.range, `Cannot check ${leftType} membership in an array of ${arrayType} values.`))
  }
}

function validateRegexOperatorTypes(
  expression: YaralBinaryExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  const operator = expression.operator.toLowerCase()
  if (operator !== "regex" && operator !== "not regex" && operator !== "in regex" && operator !== "not in regex") {
    return
  }

  const leftType = inferExpressionType(expression.left, typeContext)
  const rightType = inferExpressionType(expression.right, typeContext)
  if (leftType !== "unknown" && leftType !== "string") {
    diagnostics.push(diag(expression.left.range, "Regex comparisons need a string-like value on the left."))
  }

  if (
    (operator === "regex" || operator === "not regex") &&
    rightType !== "unknown" &&
    rightType !== "regex" &&
    rightType !== "string"
  ) {
    diagnostics.push(diag(expression.right.range, "Regex comparisons need a regex or string pattern."))
  }

  if (
    (operator === "in regex" || operator === "not in regex") &&
    rightType !== "unknown" &&
    rightType !== "array" &&
    rightType !== "array:regex" &&
    rightType !== "array:string"
  ) {
    diagnostics.push(diag(expression.right.range, "Regex-list comparisons need an array or reference list of patterns."))
  }
}

function validateNocaseEnumeratedFieldComparison(
  expression: YaralBinaryExpression,
  diagnostics: YaralDiagnostic[]
) {
  if (!expression.nocase || !isComparisonOperator(expression.operator)) {
    return
  }

  const enumField = getComparedEnumeratedFieldPath(expression)
  if (!enumField) {
    return
  }

  diagnostics.push(
    diag(expression.range, `\`nocase\` is not supported for enumerated UDM fields such as \`${enumField}\`.`)
  )
}

function getComparedEnumeratedFieldPath(expression: YaralBinaryExpression) {
  for (const side of [expression.left, expression.right]) {
    if (side.kind === "variable" && side.path.length > 0 && hasUdmFieldAllowedValues(side.path)) {
      return side.path
    }
  }
  return null
}

function validateNocaseKnownScalarComparison(
  expression: YaralBinaryExpression,
  diagnostics: YaralDiagnostic[],
  typeContext: YaralTypeContext
) {
  if (!expression.nocase) {
    return
  }

  if (getComparedEnumeratedFieldPath(expression)) {
    return
  }

  const operator = expression.operator.toLowerCase()
  if (!isEqualityOperator(operator)) {
    return
  }
  if (operator === "regex" || operator === "not regex" || operator === "in regex" || operator === "not in regex") {
    return
  }

  const leftType = inferExpressionType(expression.left, typeContext)
  const rightType = inferExpressionType(expression.right, typeContext)
  const knownTypes = [leftType, rightType].filter((type) => type !== "unknown" && !type.startsWith("array"))

  if (knownTypes.length === 0 || knownTypes.every((type) => type === "string" || type === "regex")) {
    return
  }

  diagnostics.push(diag(expression.range, "`nocase` can only be used with string or regular expression comparisons."))
}

function validateEventTypeComparison(
  expression: YaralBinaryExpression,
  diagnostics: YaralDiagnostic[]
) {
  if (
    !isEventTypeComparisonOperator(expression.operator) ||
    expression.left.kind !== "variable" ||
    expression.left.path !== "metadata.event_type" ||
    expression.right.kind !== "literal" ||
    expression.right.literalKind !== "string"
  ) {
    return
  }

  const eventType = stripYaralStringQuotes(expression.right.value)
  if (!UDM_EVENT_TYPE_SET.has(eventType)) {
    diagnostics.push(diag(expression.right.range, `Unknown UDM event type ${expression.right.value}.`))
  }
}

function isEventTypeComparisonOperator(operator: string) {
  return ["=", "==", "!=", "<", "<=", ">", ">="].includes(operator.toLowerCase())
}

function validateUdmTypeComparison(
  expression: YaralBinaryExpression,
  diagnostics: YaralDiagnostic[]
) {
  if (!isComparisonOperator(expression.operator)) {
    return
  }

  validateUdmLiteralCompatibility(expression.left, expression.right, diagnostics)
  validateUdmLiteralCompatibility(expression.right, expression.left, diagnostics)
}

function validateUdmLiteralCompatibility(
  fieldExpression: YaralExpression,
  literalExpression: YaralExpression,
  diagnostics: YaralDiagnostic[]
) {
  if (
    fieldExpression.kind !== "variable" ||
    fieldExpression.path.length === 0 ||
    literalExpression.kind !== "literal"
  ) {
    return
  }

  const fieldKind = getUdmFieldLiteralKind(fieldExpression.path)
  if (!fieldKind || fieldKind === literalExpression.literalKind) {
    return
  }

  if (
    fieldKind === "number" &&
    literalExpression.literalKind === "string" &&
    !Number.isFinite(Number(stripYaralStringQuotes(literalExpression.value)))
  ) {
    diagnostics.push(
      diag(
        literalExpression.range,
        `UDM field \`${fieldExpression.path}\` is numeric and cannot be compared to a string literal.`
      )
    )
  }

  if (
    fieldKind === "boolean" &&
    literalExpression.literalKind !== "boolean" &&
    literalExpression.literalKind !== "null"
  ) {
    diagnostics.push(
      diag(
        literalExpression.range,
        `UDM field \`${fieldExpression.path}\` is boolean and must be compared to \`true\`, \`false\`, or \`null\`.`
      )
    )
  }
}

function isComparisonOperator(operator: string) {
  return ["=", "==", "!=", "<", "<=", ">", ">=", "in", "in cidr", "in regex", "not in", "not in cidr", "not in regex", "regex", "not regex"].includes(operator.toLowerCase())
}

function isEqualityOperator(operator: string) {
  return ["=", "==", "!="].includes(operator.toLowerCase())
}

function formatArity(min: number, max: number) {
  if (max === Number.POSITIVE_INFINITY) {
    return `${min} or more arguments`
  }
  if (min === max) {
    return `${min} argument${min === 1 ? "" : "s"}`
  }
  return `${min}-${max} arguments`
}

function diag(
  range: YaralSourceRange,
  message: string,
  severity: YaralDiagnostic["severity"] = "error"
): YaralDiagnostic {
  return createDiagnostic(range, message, severity)
}
