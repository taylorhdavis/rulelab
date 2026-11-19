import { createDiagnostic, firstToken } from "./diagnostics"
import type {
  YaralAssignmentExpression,
  YaralCountVariableExpression,
  YaralDiagnostic,
  YaralExpression,
  YaralExpressionStatement,
  YaralSourceRange,
  YaralToken,
  YaralVariableExpression,
} from "./types"

const BINARY_PRECEDENCE = new Map([
  ["=", 1],
  ["==", 1],
  ["!=", 1],
  ["<", 1],
  ["<=", 1],
  [">", 1],
  [">=", 1],
  ["in", 1],
  ["in cidr", 1],
  ["in regex", 1],
  ["not in cidr", 1],
  ["not in regex", 1],
  ["regex", 1],
  ["is", 1],
  ["+", 2],
  ["-", 2],
  ["*", 3],
  ["/", 3],
  ["%", 3],
  ["and", 0],
  ["or", -1],
])

const MAX_EXPRESSION_NESTING = 200

export type ParseExpressionOptions = {
  allowDirectFields?: boolean
  preferTopLevelAssignment?: boolean
}

export function parseExpressionStatements(
  tokens: YaralToken[],
  options: ParseExpressionOptions = {}
) {
  const diagnostics: YaralDiagnostic[] = []
  const statements = splitExpressionStatements(tokens).map((statementTokens) => ({
    expression:
      statementTokens.length === 0
        ? null
        : new ExpressionParser(statementTokens, diagnostics, options).parseStatement(),
    tokens: statementTokens,
  })) satisfies YaralExpressionStatement[]

  return { diagnostics, statements }
}

export function splitExpressionStatements(tokens: YaralToken[]) {
  const statements: YaralToken[][] = []
  let current: YaralToken[] = []
  let depth = 0

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.kind === "eof") {
      continue
    }
    if (token.kind === "newline") {
      if (current.length > 0 && depth === 0) {
        const next = nextNonNewlineToken(tokens, index + 1)
        if (continuesExpressionAcrossNewline(current, next)) {
          continue
        }
        statements.push(current)
        current = []
      }
      continue
    }

    current.push(token)
    if (token.value === "(" || token.value === "[" || token.value === "{") {
      depth += 1
    } else if (token.value === ")" || token.value === "]" || token.value === "}") {
      depth = Math.max(0, depth - 1)
    }
  }

  if (current.length > 0) {
    statements.push(current)
  }

  return statements
}

function nextNonNewlineToken(tokens: YaralToken[], start: number) {
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index].kind !== "newline") {
      return tokens[index]
    }
  }
  return null
}

function continuesExpressionAcrossNewline(current: YaralToken[], next: YaralToken | null) {
  const previous = current.at(-1)
  if (!previous || !next) {
    return false
  }
  return isTrailingContinuationToken(previous) || isLeadingContinuationToken(next)
}

function isTrailingContinuationToken(token: YaralToken) {
  return (
    token.kind === "operator" ||
    token.kind === "comma" ||
    isIdentifier(token, "and") ||
    isIdentifier(token, "not") ||
    isIdentifier(token, "or")
  )
}

function isLeadingContinuationToken(token: YaralToken) {
  return isIdentifier(token, "and") || isIdentifier(token, "or")
}

function findTopLevelAssignmentIndex(tokens: YaralToken[]) {
  let depth = 0

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.value === "(" || token.value === "[" || token.value === "{") {
      depth += 1
      continue
    }
    if (token.value === ")" || token.value === "]" || token.value === "}") {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0 && token.kind === "operator" && token.value === "=") {
      return index
    }
  }

  return -1
}

function isTopLevelAssignmentTarget(left: YaralExpression) {
  if (left.kind === "identifier") {
    return true
  }
  return (
    (left.kind === "variable" || left.kind === "countVariable") &&
    left.path.length === 0
  )
}

class ExpressionParser {
  private index = 0
  private expressionDepth = 0

  constructor(
    private tokens: YaralToken[],
    private diagnostics: YaralDiagnostic[],
    private options: ParseExpressionOptions = {}
  ) {}

  parseStatement(): YaralExpression | null {
    if (this.options.preferTopLevelAssignment) {
      const assignment = this.parseTopLevelAssignment()
      if (assignment) {
        return assignment
      }
    }

    const expression = this.parseExpression()
    while (this.peek()) {
      const token = this.take()
      if (token) {
        this.diagnostics.push(diag(token, `Unexpected token \`${token.value}\` after expression.`))
      }
    }
    return expression
  }

  private parseTopLevelAssignment(): YaralExpression | null {
    const assignmentIndex = findTopLevelAssignmentIndex(this.tokens)
    if (assignmentIndex <= 0 || assignmentIndex >= this.tokens.length - 1) {
      return null
    }

    const left = new ExpressionParser(
      this.tokens.slice(0, assignmentIndex),
      this.diagnostics,
      { ...this.options, preferTopLevelAssignment: false }
    ).parseStatement()
    const right = new ExpressionParser(
      this.tokens.slice(assignmentIndex + 1),
      this.diagnostics,
      { ...this.options, preferTopLevelAssignment: false }
    ).parseStatement()

    if (!left || !right) {
      this.index = this.tokens.length
      return null
    }
    if (!isTopLevelAssignmentTarget(left)) {
      return null
    }

    this.index = this.tokens.length
    return {
      kind: "assignment",
      left,
      operator: "=",
      range: mergeRanges(left.range, right.range),
      right,
    } satisfies YaralAssignmentExpression
  }

  parseExpression(minPrecedence = -1): YaralExpression | null {
    if (this.expressionDepth >= MAX_EXPRESSION_NESTING) {
      this.diagnostics.push(
        diag(
          this.peek() ?? this.tokens.at(-1) ?? firstPosition(),
          `Expression nesting exceeds the supported limit of ${MAX_EXPRESSION_NESTING} levels.`
        )
      )
      this.skipNestedExpression()
      return null
    }

    this.expressionDepth += 1
    try {
      const left = this.parsePrefix()
      if (!left) {
        return null
      }

      return this.parseBinaryRhs(left, minPrecedence)
    } finally {
      this.expressionDepth -= 1
    }
  }

  private parseBinaryRhs(left: YaralExpression, minPrecedence: number): YaralExpression {
    let expression = left

    while (true) {
      expression = this.applyPostfixModifiers(expression)
      const operator = this.peek()
      const negatedOperator = this.getNegatedBinaryOperator()
      const compoundOperator = !negatedOperator ? this.getCompoundBinaryOperator() : null
      const precedence = negatedOperator
        ? negatedOperator.precedence
        : compoundOperator
          ? compoundOperator.precedence
          : operator
            ? getBinaryPrecedence(operator)
            : null
      if (precedence === null || precedence < minPrecedence) {
        break
      }

      if (negatedOperator) {
        for (let count = 0; count < negatedOperator.tokenCount; count += 1) {
          this.take()
        }
      } else if (compoundOperator) {
        this.take()
        this.take()
      } else {
        this.take()
      }
      if (isExpressionBoundary(this.peek())) {
        this.diagnostics.push(
          diag(operator, `Expected expression after \`${negatedOperator?.value ?? operator.value}\`.`)
        )
        break
      }
      const rightPrefix = this.parsePrefix()
      if (!rightPrefix) {
        this.diagnostics.push(
          diag(operator, `Expected expression after \`${negatedOperator?.value ?? operator.value}\`.`)
        )
        break
      }

      const nextOperator = this.peek()
      const nextPrecedence = nextOperator ? getBinaryPrecedence(nextOperator) : null
      const right =
        nextPrecedence !== null && nextPrecedence > precedence
          ? this.parseBinaryRhs(rightPrefix, nextPrecedence)
          : rightPrefix

      expression = {
        kind: "binary",
        left: expression,
        operator: negatedOperator?.value ?? compoundOperator?.value ?? operator.value,
        range: mergeRanges(expression.range, right.range),
        right,
      }
    }

    return this.applyPostfixModifiers(expression)
  }

  private applyPostfixModifiers(expression: YaralExpression): YaralExpression {
    let modified = expression

    while (isIdentifier(this.peek(), "nocase")) {
      const token = this.take()
      if (!token) {
        break
      }

      if (modified.kind === "binary" || modified.kind === "call") {
        modified = {
          ...modified,
          nocase: true,
          range: mergeRanges(modified.range, token),
        }
      } else {
        modified = {
          ...modified,
          range: mergeRanges(modified.range, token),
        }
      }
    }

    return modified
  }

  private getNegatedBinaryOperator() {
    const token = this.peek()
    const next = this.peek(1)
    const third = this.peek(2)
    if (!isIdentifier(token, "not")) {
      return null
    }
    if (isIdentifier(next, "in") && (isIdentifier(third, "regex") || isIdentifier(third, "cidr"))) {
      return {
        precedence: 1,
        tokenCount: 3,
        value: `not in ${third.value.toLowerCase()}`,
      }
    }
    if (!isIdentifier(next, "in") && !isIdentifier(next, "regex")) {
      return null
    }
    return {
      precedence: 1,
      tokenCount: 2,
      value: `not ${next.value.toLowerCase()}`,
    }
  }

  private getCompoundBinaryOperator() {
    const token = this.peek()
    const next = this.peek(1)
    if (isIdentifier(token, "in") && (isIdentifier(next, "regex") || isIdentifier(next, "cidr"))) {
      return {
        precedence: 1,
        value: `in ${next.value.toLowerCase()}`,
      }
    }
    return null
  }

  private parsePrefix(): YaralExpression | null {
    const token = this.take()
    if (!token) {
      return null
    }

    if (token.kind === "operator" && token.value === "!") {
      const argument = this.parseExpression(1)
      if (!argument) {
        this.diagnostics.push(diag(token, "Expected expression after `!`."))
        return null
      }
      return {
        argument,
        kind: "unary",
        operator: token.value,
        range: mergeRanges(token, argument.range),
      }
    }

    if (isIdentifier(token, "not")) {
      const argument = this.parseExpression(1)
      if (!argument) {
        this.diagnostics.push(diag(token, "Expected expression after `not`."))
        return null
      }
      return {
        argument,
        kind: "unary",
        operator: token.value,
        range: mergeRanges(token, argument.range),
      }
    }

    if (
      (token.kind === "number" || isIdentifier(token, "all") || isIdentifier(token, "any")) &&
      isIdentifier(this.peek(), "of")
    ) {
      return this.parseOfExpression(token)
    }

    if (
      (isIdentifier(token, "all") || isIdentifier(token, "any")) &&
      this.peek()?.kind === "variable" &&
      this.peek()?.value.includes(".")
    ) {
      const argument = this.parsePrefix()
      if (!argument || argument.kind !== "variable" || argument.path.length === 0) {
        this.diagnostics.push(diag(token, `Expected repeated field after \`${token.value}\`.`))
        return argument
      }
      return {
        argument,
        kind: "repeated",
        quantifier: token.value.toLowerCase() as "all" | "any",
        range: mergeRanges(token, argument.range),
      }
    }

    if (token.value === "(") {
      if (this.peek()?.value === ")") {
        const close = this.expect(")")
        this.diagnostics.push(diag(token, "Expected expression inside parentheses."))
        return null
      }
      const expression = this.parseExpression()
      const close = this.expect(")")
      if (!expression) {
        this.diagnostics.push(diag(token, "Expected expression inside parentheses."))
        return null
      }
      return {
        expression,
        kind: "group",
        range: mergeRanges(token, close ?? expression.range),
      }
    }

    if (token.value === "[") {
      return this.parseArrayExpression(token)
    }

    if (token.kind === "identifier") {
      if (this.peek()?.value === "(") {
        return this.parseCallExpression(token)
      }
      const lower = token.value.toLowerCase()
      if (lower === "true" || lower === "false") {
        return { kind: "literal", literalKind: "boolean", range: token, value: token.value }
      }
      if (lower === "null") {
        return { kind: "literal", literalKind: "null", range: token, value: token.value }
      }
      if (this.options.allowDirectFields && token.value.includes(".")) {
        return { kind: "variable", name: "", path: token.value, range: token }
      }
      return { kind: "identifier", name: token.value, range: token }
    }

    if (token.kind === "variable" || token.kind === "countVariable") {
      const parsed = parseVariableToken(token)
      if (!parsed) {
        this.diagnostics.push(diag(token, "Invalid variable reference."))
        return null
      }
      return {
        kind: token.kind,
        name: parsed.name,
        path: parsed.path,
        range: token,
      }
    }

    if (token.kind === "referenceList") {
      return { kind: "referenceList", name: token.value.slice(1), range: token }
    }

    if (token.kind === "string") {
      return { kind: "literal", literalKind: "string", range: token, value: token.value }
    }
    if (token.kind === "regex") {
      return { kind: "literal", literalKind: "regex", range: token, value: token.value }
    }
    if (token.kind === "number") {
      return { kind: "literal", literalKind: "number", range: token, value: token.value }
    }
    if (token.kind === "duration") {
      return { kind: "literal", literalKind: "duration", range: token, value: token.value }
    }

    this.diagnostics.push(diag(token, `Unexpected token \`${token.value}\` in expression.`))
    return null
  }

  private parseCallExpression(callee: YaralToken): YaralExpression {
    this.expect("(")
    const args: YaralExpression[] = []

    while (this.peek() && this.peek()?.value !== ")") {
      if (this.peek()?.kind === "comma") {
        const token = this.take()
        if (token) {
          this.diagnostics.push(diag(token, "Expected expression between function call arguments."))
        }
        continue
      }
      const arg = this.parseExpression()
      if (arg) {
        args.push(arg)
      }
      if (this.peek()?.kind === "comma") {
        this.take()
        continue
      }
      if (this.peek()?.value !== ")") {
        const token = this.peek()
        if (token) {
          this.diagnostics.push(diag(token, "Expected `,` or `)` in function call."))
          this.take()
        }
      }
    }

    const close = this.expect(")")
    return {
      args,
      callee: callee.value,
      kind: "call",
      range: mergeRanges(callee, close ?? args.at(-1)?.range ?? callee),
    }
  }

  private parseArrayExpression(open: YaralToken): YaralExpression {
    const elements: YaralExpression[] = []

    while (this.peek() && this.peek()?.value !== "]") {
      if (this.peek()?.kind === "comma") {
        const token = this.take()
        if (token) {
          this.diagnostics.push(diag(token, "Expected expression between array elements."))
        }
        continue
      }
      const element = this.parseExpression()
      if (element) {
        elements.push(element)
      }
      if (this.peek()?.kind === "comma") {
        this.take()
        continue
      }
      if (this.peek()?.value !== "]") {
        const token = this.peek()
        if (token) {
          this.diagnostics.push(diag(token, "Expected `,` or `]` in array literal."))
          this.take()
        }
      }
    }

    const close = this.expect("]")
    return {
      elements,
      kind: "array",
      range: mergeRanges(open, close ?? elements.at(-1)?.range ?? open),
    }
  }

  private parseOfExpression(quantifierToken: YaralToken): YaralExpression | null {
    this.expect("of")
    const open = this.peek()
    if (open?.value === "[") {
      return this.parseOfExpressionList(quantifierToken, "[", "]")
    }
    if (open?.value === "(") {
      return this.parseLegacyOfVariableList(quantifierToken)
    }

    this.diagnostics.push(diag(open ?? quantifierToken, "Expected `[` after `of`."))
    return {
      expressions: [],
      kind: "of",
      quantifier: parseOfQuantifier(quantifierToken),
      range: mergeRanges(quantifierToken, open ?? quantifierToken),
      variables: [],
    }
  }

  private parseOfExpressionList(
    quantifierToken: YaralToken,
    openValue: string,
    closeValue: string
  ): YaralExpression | null {
    const open = this.expect(openValue)
    const expressions: YaralExpression[] = []

    while (this.peek() && this.peek()?.value !== closeValue) {
      if (this.peek()?.kind === "comma") {
        const token = this.take()
        if (token) {
          this.diagnostics.push(diag(token, "Expected expression between `of` condition elements."))
        }
        continue
      }

      const expression = this.parseExpression()
      if (expression) {
        expressions.push(expression)
      } else {
        const token = this.take()
        if (token) {
          this.diagnostics.push(diag(token, "Expected expression in `of` condition list."))
        }
      }

      if (this.peek()?.kind === "comma") {
        this.take()
        continue
      }
      if (this.peek()?.value !== closeValue) {
        const token = this.peek()
        if (token) {
          this.diagnostics.push(diag(token, `Expected \`,\` or \`${closeValue}\` in \`of\` condition list.`))
          this.take()
        }
      }
    }

    const close = this.expect(closeValue)
    const quantifier = parseOfQuantifier(quantifierToken)
    validateNumericOfQuantifier(quantifierToken, quantifier, this.diagnostics)

    return {
      expressions,
      kind: "of",
      quantifier,
      range: mergeRanges(quantifierToken, close ?? open ?? expressions.at(-1)?.range ?? quantifierToken),
      variables: expressions.filter(isSimpleVariableOrCountExpression),
    }
  }

  private parseLegacyOfVariableList(quantifierToken: YaralToken): YaralExpression | null {
    const open = this.expect("(")
    const variables: Array<YaralVariableExpression | YaralCountVariableExpression> = []

    while (this.peek() && this.peek()?.value !== ")") {
      const token = this.take()
      if (!token) {
        break
      }
      if (token.kind === "comma") {
        continue
      }
      if (token.kind !== "variable" && token.kind !== "countVariable") {
        this.diagnostics.push(diag(token, "`of` conditions must list event or placeholder variables."))
        continue
      }
      const parsed = parseVariableToken(token)
      if (!parsed || parsed.path.length > 0) {
        this.diagnostics.push(diag(token, "`of` conditions must list simple event or placeholder variables."))
        continue
      }
      variables.push({
        kind: token.kind,
        name: parsed.name,
        path: parsed.path,
        range: token,
      })
    }

    const close = this.expect(")")
    const quantifier = parseOfQuantifier(quantifierToken)
    validateNumericOfQuantifier(quantifierToken, quantifier, this.diagnostics)

    return {
      expressions: variables,
      kind: "of",
      quantifier,
      range: mergeRanges(quantifierToken, close ?? open ?? variables.at(-1)?.range ?? quantifierToken),
      variables,
    }
  }

  private expect(value: string) {
    const token = this.peek()
    if (token?.value === value || (token?.kind === "identifier" && token.value.toLowerCase() === value)) {
      return this.take()
    }
    this.diagnostics.push(diag(token ?? this.tokens.at(-1) ?? firstPosition(), `Expected \`${value}\`.`))
    return null
  }

  private peek(offset = 0) {
    return this.tokens[this.index + offset] ?? null
  }

  private take() {
    return this.tokens[this.index++] ?? null
  }

  private skipNestedExpression() {
    let depth = 0
    while (this.peek()) {
      const token = this.take()
      if (!token) {
        break
      }
      if (token.value === "(" || token.value === "[" || token.value === "{") {
        depth += 1
      } else if (token.value === ")" || token.value === "]" || token.value === "}") {
        if (depth === 0) {
          break
        }
        depth -= 1
      }
    }
  }
}

function getBinaryPrecedence(token: YaralToken) {
  if (token.kind !== "operator" && token.kind !== "identifier") {
    return null
  }
  return BINARY_PRECEDENCE.get(token.value.toLowerCase()) ?? null
}

function parseVariableToken(token: YaralToken) {
  const match = token.value.match(/^[$#]([A-Za-z_][A-Za-z0-9_]*)(?:\.(.+))?$/)
  if (!match) {
    return null
  }
  return {
    name: match[1],
    path: match[2] ?? "",
  }
}

function parseOfQuantifier(token: YaralToken) {
  return token.kind === "number"
    ? Number(token.value)
    : token.value.toLowerCase() === "all"
      ? "all"
      : "any"
}

function validateNumericOfQuantifier(
  token: YaralToken,
  quantifier: "all" | "any" | number,
  diagnostics: YaralDiagnostic[]
) {
  if (typeof quantifier === "number" && !Number.isInteger(quantifier)) {
    diagnostics.push(diag(token, "`of` quantifier must be an integer."))
  }
}

function isSimpleVariableOrCountExpression(
  expression: YaralExpression
): expression is YaralVariableExpression | YaralCountVariableExpression {
  return (
    (expression.kind === "variable" || expression.kind === "countVariable") &&
    expression.path.length === 0
  )
}

function isIdentifier(token: YaralToken | null | undefined, value: string) {
  return token?.kind === "identifier" && token.value.toLowerCase() === value
}

function isExpressionBoundary(token: YaralToken | null | undefined) {
  return token?.kind === "comma" || token?.value === ")" || token?.value === "]" || token?.value === "}"
}

function mergeRanges(left: YaralSourceRange, right: YaralSourceRange): YaralSourceRange {
  return {
    column: left.column,
    endColumn: right.endColumn,
    endLine: right.endLine,
    line: left.line,
  }
}

function diag(token: YaralToken, message: string): YaralDiagnostic {
  return createDiagnostic(token, message)
}

function firstPosition(): YaralToken {
  return firstToken()
}
