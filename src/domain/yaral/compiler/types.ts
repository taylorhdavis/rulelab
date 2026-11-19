export type YaralDiagnosticSeverity = "error" | "warning"
export type YaralDiagnosticSource = "lexer" | "parser" | "semantic" | "runtime" | "validation"

export type YaralDiagnostic = {
  code?: string
  column: number
  endColumn: number
  endLine: number
  line: number
  message: string
  severity: YaralDiagnosticSeverity
  source?: YaralDiagnosticSource
}

export type YaralRuleType = "single_event" | "multi_event" | "unknown"
export type YaralMatchWindowType = "hop" | "sliding" | "tumbling"

export type YaralSectionName =
  | "meta"
  | "events"
  | "match"
  | "outcome"
  | "condition"
  | "options"

export type YaralTokenKind =
  | "identifier"
  | "variable"
  | "countVariable"
  | "string"
  | "regex"
  | "number"
  | "duration"
  | "referenceList"
  | "operator"
  | "brace"
  | "paren"
  | "bracket"
  | "comma"
  | "colon"
  | "newline"
  | "eof"
  | "unknown"

export type YaralSourceRange = {
  column: number
  endColumn: number
  endLine: number
  line: number
}

export type YaralToken = YaralSourceRange & {
  kind: YaralTokenKind
  value: string
}

export type YaralSectionAst = {
  expressions: YaralExpressionStatement[]
  match: YaralMatchAst | null
  name: YaralSectionName
  nameToken: YaralToken
  tokens: YaralToken[]
}

export type YaralMatchWindowKind = "hop" | "sliding" | "tumbling"

export type YaralMatchAst = YaralExpressionBase & {
  duration: YaralToken | null
  kind: "match"
  pivot: YaralVariableExpression | null
  variables: YaralVariableExpression[]
  windowDirection: "after" | "before" | null
  windowKind: YaralMatchWindowKind | null
  windowToken: YaralToken | null
}

export type YaralExpressionStatement = {
  expression: YaralExpression | null
  tokens: YaralToken[]
}

export type YaralExpression =
  | YaralArrayExpression
  | YaralBinaryExpression
  | YaralAssignmentExpression
  | YaralCallExpression
  | YaralCountVariableExpression
  | YaralGroupedExpression
  | YaralIdentifierExpression
  | YaralLiteralExpression
  | YaralOfExpression
  | YaralReferenceListExpression
  | YaralRepeatedFieldExpression
  | YaralUnaryExpression
  | YaralVariableExpression

export type YaralExpressionBase = {
  range: YaralSourceRange
}

export type YaralLiteralExpression = YaralExpressionBase & {
  kind: "literal"
  literalKind: "boolean" | "duration" | "null" | "number" | "regex" | "string"
  value: string
}

export type YaralIdentifierExpression = YaralExpressionBase & {
  kind: "identifier"
  name: string
}

export type YaralVariableExpression = YaralExpressionBase & {
  kind: "variable"
  name: string
  path: string
}

export type YaralCountVariableExpression = YaralExpressionBase & {
  kind: "countVariable"
  name: string
  path: string
}

export type YaralReferenceListExpression = YaralExpressionBase & {
  kind: "referenceList"
  name: string
}

export type YaralRepeatedFieldExpression = YaralExpressionBase & {
  argument: YaralVariableExpression
  kind: "repeated"
  quantifier: "all" | "any"
}

export type YaralUnaryExpression = YaralExpressionBase & {
  argument: YaralExpression
  kind: "unary"
  operator: string
}

export type YaralBinaryExpression = YaralExpressionBase & {
  kind: "binary"
  left: YaralExpression
  nocase?: boolean
  operator: string
  right: YaralExpression
}

export type YaralAssignmentExpression = YaralExpressionBase & {
  kind: "assignment"
  left: YaralExpression
  nocase?: boolean
  operator: "="
  right: YaralExpression
}

export type YaralCallExpression = YaralExpressionBase & {
  args: YaralExpression[]
  callee: string
  kind: "call"
  nocase?: boolean
}

export type YaralGroupedExpression = YaralExpressionBase & {
  expression: YaralExpression
  kind: "group"
}

export type YaralArrayExpression = YaralExpressionBase & {
  elements: YaralExpression[]
  kind: "array"
}

export type YaralOfExpression = YaralExpressionBase & {
  expressions: YaralExpression[]
  kind: "of"
  quantifier: "all" | "any" | number
  variables: Array<YaralVariableExpression | YaralCountVariableExpression>
}

export type YaralRuleAst = {
  closeBrace: YaralToken | null
  name: string | null
  nameToken: YaralToken | null
  openBrace: YaralToken | null
  ruleToken: YaralToken | null
  sections: YaralSectionAst[]
}

export type YaralRuntimePlan = {
  condition: YaralExpression | null
  eventPredicates: YaralEventPredicatePlan[]
  joins: YaralJoinPlan[]
  match: YaralMatchPlan | null
  meta: Record<string, string>
  options: YaralRuntimeOptions
  outcomes: YaralOutcomePlan[]
  placeholders: YaralPlaceholderPlan[]
}

export type YaralEventPredicatePlan = {
  eventVariable: string | null
  expression: YaralExpression
  referencedFields: string[]
}

export type YaralPlaceholderPlan = {
  eventVariables: string[]
  expression: YaralExpression
  name: string
  sourceFields: string[]
}

export type YaralJoinPlan = {
  eventVariables: string[]
  placeholder: string
}

export type YaralMatchPlan = {
  durationMinutes: number | null
  durationValue: string | null
  kind: YaralMatchWindowKind | null
  pivotDirection: "after" | "before" | null
  pivotEvent: string | null
  variables: string[]
}

export type YaralOutcomePlan = {
  aggregate: boolean
  expression: YaralExpression
  name: string
}

export type YaralRuntimeOptions = {
  allowZeroValues: boolean
  suppressionWindowMinutes: number | null
  suppressionWindowValue: string | null
}

export type YaralEvaluationEvent = Record<string, unknown>

export type YaralEvaluationDataTable = {
  name: string
  rows: unknown[]
}

export type YaralCompileOptions = {
  approximateHelperDiagnostics?: boolean
  dataTables?: YaralEvaluationDataTable[]
  experimentalDiagnostics?: boolean
  mode?: "dashboard" | "rule" | "search"
}

export type YaralEvaluationResult = {
  diagnostics: YaralDiagnostic[]
  matched: boolean
  matches: YaralEvaluationMatch[]
  matchedEvents: Record<string, YaralEvaluationEvent[]>
  outcomes: Record<string, unknown>
  placeholders: Record<string, unknown>
  traces: YaralEvaluationTrace[]
}

export type YaralEvaluationMatch = {
  matchedEvents: Record<string, YaralEvaluationEvent[]>
  outcomes: Record<string, unknown>
  placeholders: Record<string, unknown>
}

export type YaralEvaluationTrace = {
  expression: YaralExpression
  expressionKind: YaralExpression["kind"]
  id: string
  label: string
  passed: boolean | null
  section: YaralSectionName | "runtime"
  sourceRange: YaralSourceRange
  value: unknown
}

export type YaralCompiledRule = {
  ast: YaralRuleAst | null
  diagnostics: YaralDiagnostic[]
  plan: YaralRuntimePlan | null
  summary: YaralCompileSummary
  symbols: YaralSymbolTable
}

export type YaralCompileResult = {
  ast: YaralRuleAst | null
  diagnostics: YaralDiagnostic[]
  plan: YaralRuntimePlan | null
  summary: YaralCompileSummary
  symbols: YaralSymbolTable
  tokens: YaralToken[]
}

export type YaralCompileFileResult = {
  diagnostics: YaralDiagnostic[]
  rules: YaralCompiledRule[]
  tokens: YaralToken[]
}

export type YaralCompileSummary = {
  eventFilters: number
  matchWindow: string | null
  matchWindowType: YaralMatchWindowType | null
  ruleName: string | null
  ruleType: YaralRuleType
  sections: Array<{ name: YaralSectionName; present: boolean }>
}

export type YaralSymbolTable = {
  eventVariables: YaralEventSymbol[]
  functions: YaralSymbol[]
  outcomeVariables: YaralSymbol[]
  placeholderVariables: YaralPlaceholderSymbol[]
  referencedFields: string[]
}

export type YaralSymbol = {
  name: string
  references: YaralSourceRange[]
}

export type YaralEventSymbol = YaralSymbol & {
  eventTypes: string[]
  fields: string[]
  filterCount: number
  logTypes: string[]
}

export type YaralPlaceholderSymbol = YaralSymbol & {
  eventVariable: string | null
  eventVariables: string[]
  isJoin: boolean
  source: string
  sources: string[]
}
