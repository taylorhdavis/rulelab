import type { YaralAssignmentExpression, YaralExpression } from "./types"

export type YaralVariableLikeExpression = Extract<
  YaralExpression,
  { kind: "countVariable" | "variable" }
>

export function walkExpression(
  expression: YaralExpression,
  visit: (expression: YaralExpression) => void
) {
  visit(expression)

  switch (expression.kind) {
    case "assignment":
      walkExpression(expression.left, visit)
      walkExpression(expression.right, visit)
      break
    case "array":
      expression.elements.forEach((element) => walkExpression(element, visit))
      break
    case "binary":
      walkExpression(expression.left, visit)
      walkExpression(expression.right, visit)
      break
    case "call":
      expression.args.forEach((arg) => walkExpression(arg, visit))
      break
    case "group":
      walkExpression(expression.expression, visit)
      break
    case "of":
      expression.expressions.forEach((element) => walkExpression(element, visit))
      break
    case "repeated":
      walkExpression(expression.argument, visit)
      break
    case "unary":
      walkExpression(expression.argument, visit)
      break
  }
}

export function collectVariableExpressions(expression: YaralExpression) {
  return collectExpressions(expression, isVariableLikeExpression)
}

export function collectBinaryExpressions(expression: YaralExpression) {
  return collectExpressions(
    expression,
    (node): node is Extract<YaralExpression, { kind: "binary" }> =>
      node.kind === "binary"
  )
}

export function collectCallExpressions(expression: YaralExpression) {
  return collectExpressions(
    expression,
    (node): node is Extract<YaralExpression, { kind: "call" }> =>
      node.kind === "call"
  )
}

export function collectExpressions<T extends YaralExpression>(
  expression: YaralExpression,
  predicate: (expression: YaralExpression) => expression is T
) {
  const matches: T[] = []

  walkExpression(expression, (node) => {
    if (predicate(node)) {
      matches.push(node)
    }
  })

  return matches
}

export function collectReferenceListExpressions(expression: YaralExpression) {
  return collectExpressions(
    expression,
    (node): node is Extract<YaralExpression, { kind: "referenceList" }> =>
      node.kind === "referenceList"
  )
}

export function isSimpleVariableExpression(
  expression: YaralExpression
): expression is YaralVariableLikeExpression {
  return isVariableLikeExpression(expression) && expression.path.length === 0
}

export function isAssignmentExpression(
  expression: YaralExpression
): expression is YaralAssignmentExpression {
  return expression.kind === "assignment"
}

export function isVariableLikeExpression(
  expression: YaralExpression
): expression is YaralVariableLikeExpression {
  return expression.kind === "variable" || expression.kind === "countVariable"
}
